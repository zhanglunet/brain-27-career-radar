import { processSourceDocument } from "./p1/pipeline.ts";
import type { P1PipelineSummary } from "./p1/pipeline.ts";

const MAX_BODY_BYTES = 512 * 1024;
const MAX_EXCERPT_CHARS = 1_500;
const REQUEST_TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;

type SourceRow = {
  id: string;
  name: string;
  source_type: "detail" | "listing" | "api" | "rss";
  url: string;
  adapter_key: string | null;
  discovery_enabled: number;
  auto_merge_low_risk: number;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
  final_url: string | null;
  consecutive_failures: number;
};

type MonitorTrigger = "cron" | "manual" | "test";

type MonitorOptions = {
  trigger: MonitorTrigger;
  fetcher?: typeof fetch;
  now?: () => Date;
};

type SourceResult = {
  sourceId: string;
  ok: boolean;
  changed: boolean;
  statusCode: number | null;
  error?: string;
};

export type MonitorSummary = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  checkedCount: number;
  changedCount: number;
  failedCount: number;
};

export async function monitorSources(
  db: D1Database,
  options: MonitorOptions,
): Promise<MonitorSummary> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const runId = crypto.randomUUID();
  const startedAt = now().toISOString();

  await db.prepare(
    `INSERT INTO sync_runs (id, trigger, status, started_at)
     VALUES (?, ?, 'running', ?)`,
  ).bind(runId, options.trigger, startedAt).run();

  console.log(JSON.stringify({ event: "radar.sync.started", runId, trigger: options.trigger, startedAt }));

  try {
    const sourceQuery = db.prepare(
      `SELECT id, name, source_type, url, adapter_key, discovery_enabled, auto_merge_low_risk,
              etag, last_modified, content_hash, final_url, consecutive_failures
       FROM sources
       WHERE enabled = 1
         ${options.trigger === "cron" ? "AND (last_checked_at IS NULL OR datetime(last_checked_at) <= datetime(?, '-' || check_interval_hours || ' hours'))" : ""}
       ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, id`,
    );
    const query = await (options.trigger === "cron" ? sourceQuery.bind(startedAt) : sourceQuery).all<SourceRow>();
    const sources = query.results;
    const results: SourceResult[] = [];

    for (let offset = 0; offset < sources.length; offset += CONCURRENCY) {
      const batch = sources.slice(offset, offset + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((source) => checkSource(db, runId, source, fetcher, now)),
      );
      results.push(...batchResults);
    }

    const changedCount = results.filter((result) => result.changed).length;
    const failed = results.filter((result) => !result.ok);
    const status = failed.length === 0 ? "succeeded" : failed.length === results.length && results.length > 0 ? "failed" : "partial";
    const finishedAt = now().toISOString();
    const errorSummary = failed.slice(0, 10).map((result) => `${result.sourceId}: ${result.error ?? "unknown error"}`).join("\n");

    await db.prepare(
      `UPDATE sync_runs
       SET status = ?, finished_at = ?, checked_count = ?, changed_count = ?, failed_count = ?, error_summary = ?
       WHERE id = ?`,
    ).bind(status, finishedAt, results.length, changedCount, failed.length, errorSummary || null, runId).run();

    const summary: MonitorSummary = {
      runId,
      status,
      checkedCount: results.length,
      changedCount,
      failedCount: failed.length,
    };
    console.log(JSON.stringify({ event: "radar.sync.finished", ...summary, finishedAt }));
    return summary;
  } catch (error) {
    const message = errorMessage(error);
    const finishedAt = now().toISOString();
    await db.prepare(
      `UPDATE sync_runs SET status = 'failed', finished_at = ?, error_summary = ? WHERE id = ?`,
    ).bind(finishedAt, message, runId).run();
    console.error(JSON.stringify({ event: "radar.sync.failed", runId, finishedAt, error: message }));
    throw error;
  }
}

async function checkSource(
  db: D1Database,
  runId: string,
  source: SourceRow,
  fetcher: typeof fetch,
  now: () => Date,
): Promise<SourceResult> {
  const checkedAt = now().toISOString();
  const headers = new Headers({
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
    "User-Agent": "Brain27CareerRadar/0.2 (+source-monitor; contact via project repository)",
  });
  if (source.etag) headers.set("If-None-Match", source.etag);
  if (source.last_modified) headers.set("If-Modified-Since", source.last_modified);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("source request timed out"), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(source.url, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.status === 304) {
      await markSuccess(db, source.id, checkedAt, 304, source.final_url ?? source.url, source.etag, source.last_modified, source.content_hash);
      await markLinkedRecordsVerified(db, source.id, checkedAt);
      if (source.content_hash) await resolveStableAutomaticReviews(db, source.id, source.content_hash, checkedAt);
      await writeSourceCheckLog(db, {
        sourceId: source.id,
        runId,
        checkedAt,
        outcome: "not_modified",
        ok: true,
        changed: false,
        statusCode: 304,
        finalUrl: source.final_url ?? source.url,
      });
      logSourceResult(runId, source.id, true, false, 304);
      return { sourceId: source.id, ok: true, changed: false, statusCode: 304 };
    }
    if (!response.ok) {
      throw new SourceHttpError(response.status);
    }

    const body = await readBoundedBody(response, MAX_BODY_BYTES);
    const normalizedContent = normalizeSourceText(body.text);
    const contentHash = await sha256(normalizedContent);
    const isBaseline = source.content_hash === null;
    const changed = !isBaseline && source.content_hash !== contentHash;
    const finalUrl = response.url || source.url;
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");

    const proposedSnapshotId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO source_snapshots
       (id, source_id, run_id, content_hash, status_code, final_url, excerpt, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, content_hash) DO NOTHING`,
    ).bind(
      proposedSnapshotId,
      source.id,
      runId,
      contentHash,
      response.status,
      finalUrl,
      normalizedContent.slice(0, MAX_EXCERPT_CHARS),
      checkedAt,
    ).run();

    const snapshot = await db.prepare(
      "SELECT id FROM source_snapshots WHERE source_id = ? AND content_hash = ? LIMIT 1",
    ).bind(source.id, contentHash).first<{ id: string }>();
    if (!snapshot) throw new Error(`source snapshot was not persisted for ${source.id}`);

    await markSuccess(db, source.id, checkedAt, response.status, finalUrl, etag, lastModified, contentHash);
    await markLinkedRecordsVerified(db, source.id, checkedAt);

    let p1Summary: P1PipelineSummary | undefined;
    if (source.discovery_enabled === 1 && source.adapter_key) {
      try {
        p1Summary = await processSourceDocument(db, {
          source: {
            id: source.id,
            name: source.name,
            url: source.url,
            source_type: source.source_type,
            adapter_key: source.adapter_key,
            auto_merge_low_risk: source.auto_merge_low_risk,
          },
          runId,
          snapshotId: snapshot.id,
          html: body.text,
          finalUrl,
          capturedAt: checkedAt,
        });
        console.log(JSON.stringify({ event: "radar.p1.extracted", runId, sourceId: source.id, ...p1Summary }));
      } catch (error) {
        const message = errorMessage(error);
        await createReviewItem(db, source.id, runId, "parse_conflict", { error: message, adapterKey: source.adapter_key });
        console.error(JSON.stringify({ event: "radar.p1.failed", runId, sourceId: source.id, error: message }));
      }
    }

    if (changed) {
      await supersedeAutomaticObservations(db, source.id, checkedAt);
      await createAutomaticObservation(db, source.id, runId, {
        previousHash: source.content_hash,
        contentHash,
        previousUrl: source.final_url,
        finalUrl,
        truncated: body.truncated,
      });
    } else if (!isBaseline) {
      await resolveStableAutomaticReviews(db, source.id, contentHash, checkedAt);
    }

    await writeSourceCheckLog(db, {
      sourceId: source.id,
      runId,
      checkedAt,
      outcome: changed ? "changed" : "unchanged",
      ok: true,
      changed,
      statusCode: response.status,
      finalUrl,
      p1Summary,
    });

    logSourceResult(runId, source.id, true, changed, response.status, { truncated: body.truncated, finalUrl });
    return { sourceId: source.id, ok: true, changed, statusCode: response.status };
  } catch (error) {
    const message = errorMessage(error);
    const statusCode = error instanceof SourceHttpError ? error.statusCode : null;
    const failures = source.consecutive_failures + 1;

    await db.prepare(
      `UPDATE sources
       SET last_checked_at = ?, last_status_code = ?, consecutive_failures = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(checkedAt, statusCode, failures, source.id).run();

    if (failures === 3) {
      await createReviewItem(db, source.id, runId, "repeated_failure", {
        consecutiveFailures: failures,
        error: message,
        statusCode,
      });
    }

    await writeSourceCheckLog(db, {
      sourceId: source.id,
      runId,
      checkedAt,
      outcome: "failed",
      ok: false,
      changed: false,
      statusCode,
      finalUrl: source.final_url ?? source.url,
      errorSummary: message,
    });

    console.error(JSON.stringify({
      event: "radar.source.failed",
      runId,
      sourceId: source.id,
      statusCode,
      consecutiveFailures: failures,
      error: message,
    }));
    return { sourceId: source.id, ok: false, changed: false, statusCode, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeSourceCheckLog(
  db: D1Database,
  input: {
    sourceId: string;
    runId: string;
    checkedAt: string;
    outcome: "unchanged" | "changed" | "not_modified" | "failed";
    ok: boolean;
    changed: boolean;
    statusCode: number | null;
    finalUrl: string | null;
    errorSummary?: string;
    p1Summary?: P1PipelineSummary;
  },
) {
  await db.prepare(
    `INSERT INTO source_check_logs
     (id, source_id, run_id, checked_at, outcome, ok, changed, status_code, final_url, error_summary,
      candidates_count, evidence_count, change_sets_count, applied_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, source_id) DO UPDATE SET
       checked_at = excluded.checked_at,
       outcome = excluded.outcome,
       ok = excluded.ok,
       changed = excluded.changed,
       status_code = excluded.status_code,
       final_url = excluded.final_url,
       error_summary = excluded.error_summary,
       candidates_count = excluded.candidates_count,
       evidence_count = excluded.evidence_count,
       change_sets_count = excluded.change_sets_count,
       applied_count = excluded.applied_count`,
  ).bind(
    crypto.randomUUID(),
    input.sourceId,
    input.runId,
    input.checkedAt,
    input.outcome,
    input.ok ? 1 : 0,
    input.changed ? 1 : 0,
    input.statusCode,
    input.finalUrl,
    input.errorSummary?.slice(0, 500) ?? null,
    input.p1Summary?.discoveredCount ?? 0,
    input.p1Summary?.evidenceCount ?? 0,
    input.p1Summary?.changeSetCount ?? 0,
    input.p1Summary?.appliedCount ?? 0,
  ).run();
}

async function markSuccess(
  db: D1Database,
  sourceId: string,
  checkedAt: string,
  statusCode: number,
  finalUrl: string,
  etag: string | null,
  lastModified: string | null,
  contentHash: string | null,
) {
  await db.prepare(
    `UPDATE sources
     SET last_checked_at = ?, last_success_at = ?, last_status_code = ?, final_url = ?, etag = ?,
         last_modified = ?, content_hash = ?, consecutive_failures = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(checkedAt, checkedAt, statusCode, finalUrl, etag, lastModified, contentHash, sourceId).run();
}

async function createReviewItem(
  db: D1Database,
  sourceId: string,
  runId: string,
  reason: "content_changed" | "repeated_failure" | "new_source" | "parse_conflict",
  payload: Record<string, unknown>,
) {
  await db.prepare(
    `INSERT INTO review_queue (id, source_id, run_id, reason, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), sourceId, runId, reason, JSON.stringify(payload)).run();
}

async function createAutomaticObservation(
  db: D1Database,
  sourceId: string,
  runId: string,
  payload: Record<string, unknown>,
) {
  await db.prepare(
    `INSERT INTO review_queue
     (id, source_id, run_id, reason, status, review_mode, payload_json, resolution_note)
     VALUES (?, ?, ?, 'content_changed', 'observing', 'automatic', ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    sourceId,
    runId,
    JSON.stringify(payload),
    "等待下一次相同内容哈希确认稳定；不会自动修改公开语义字段。",
  ).run();
}

async function supersedeAutomaticObservations(db: D1Database, sourceId: string, resolvedAt: string) {
  await db.prepare(
    `UPDATE review_queue
     SET status = 'rejected', resolved_at = ?, resolution_code = 'superseded_by_new_change',
         resolution_note = '观察期间再次变化，旧观察项由新内容哈希取代。', resolved_by = 'automatic-policy-v1'
     WHERE source_id = ? AND reason = 'content_changed' AND status = 'observing' AND review_mode = 'automatic'`,
  ).bind(resolvedAt, sourceId).run();
}

async function resolveStableAutomaticReviews(
  db: D1Database,
  sourceId: string,
  contentHash: string,
  resolvedAt: string,
) {
  const pending = await db.prepare(
    `SELECT id, payload_json FROM review_queue
     WHERE source_id = ? AND reason = 'content_changed' AND status = 'observing' AND review_mode = 'automatic'`,
  ).bind(sourceId).all<{ id: string; payload_json: string }>();

  for (const item of pending.results) {
    const payload = parseObject(item.payload_json);
    if (payload.contentHash !== contentHash) continue;
    await db.prepare(
      `UPDATE review_queue
       SET status = 'approved', resolved_at = ?, resolution_code = 'stable_on_repeat',
           resolution_note = '连续两轮内容哈希一致，自动确认页面已稳定；未自动发布语义字段。',
           resolved_by = 'automatic-policy-v1'
       WHERE id = ? AND status = 'observing'`,
    ).bind(resolvedAt, item.id).run();
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function markLinkedRecordsVerified(db: D1Database, sourceId: string, checkedAt: string) {
  await db.prepare("UPDATE opportunities SET source_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE source_id = ?")
    .bind(checkedAt, sourceId).run();
  await db.prepare("UPDATE institutions SET source_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE source_id = ?")
    .bind(checkedAt, sourceId).run();
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - bytesRead;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    bytesRead += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    if (chunk.byteLength < value.byteLength) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  text += decoder.decode();
  return { text, truncated };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSourceText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function logSourceResult(
  runId: string,
  sourceId: string,
  ok: boolean,
  changed: boolean,
  statusCode: number,
  extra: Record<string, unknown> = {},
) {
  console.log(JSON.stringify({ event: "radar.source.checked", runId, sourceId, ok, changed, statusCode, ...extra }));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

class SourceHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`source returned HTTP ${statusCode}`);
    this.statusCode = statusCode;
  }
}
