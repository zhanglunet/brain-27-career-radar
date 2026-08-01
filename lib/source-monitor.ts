import { processSourceDocument } from "./p1/pipeline.ts";

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
    const query = await db.prepare(
      `SELECT id, name, source_type, url, adapter_key, discovery_enabled, auto_merge_low_risk,
              etag, last_modified, content_hash, final_url, consecutive_failures
       FROM sources
       WHERE enabled = 1
       ORDER BY id`,
    ).all<SourceRow>();
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
    const status = failed.length === 0 ? "succeeded" : failed.length === results.length ? "failed" : "partial";
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

    if (source.discovery_enabled === 1 && source.adapter_key) {
      try {
        const p1 = await processSourceDocument(db, {
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
        console.log(JSON.stringify({ event: "radar.p1.extracted", runId, sourceId: source.id, ...p1 }));
      } catch (error) {
        const message = errorMessage(error);
        await createReviewItem(db, source.id, runId, "parse_conflict", { error: message, adapterKey: source.adapter_key });
        console.error(JSON.stringify({ event: "radar.p1.failed", runId, sourceId: source.id, error: message }));
      }
    }

    if (changed) {
      await createReviewItem(db, source.id, runId, "content_changed", {
        previousHash: source.content_hash,
        contentHash,
        previousUrl: source.final_url,
        finalUrl,
        truncated: body.truncated,
      });
    }

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
