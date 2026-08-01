import { discoverProviderPapers } from "./paper-providers.ts";
import type { EnabledPaperProvider, PaperCandidate, PaperResearcher } from "./paper-providers.ts";

const MAX_RESEARCHERS_PER_RUN = 16;
const PROVIDER_PAUSE_MS = 300;

type AcademicTrigger = "cron" | "manual" | "test";
type ProviderRow = { id: EnabledPaperProvider };
type AcademicSyncSummary = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  researchersChecked: number;
  candidatesFound: number;
  papersInserted: number;
  failedCount: number;
};

export async function syncAcademicPapers(
  db: D1Database,
  options: { trigger: AcademicTrigger; fetcher?: typeof fetch; now?: () => Date },
): Promise<AcademicSyncSummary> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const runId = crypto.randomUUID();
  const startedAt = now().toISOString();
  await db.prepare(`INSERT INTO academic_sync_runs (id, trigger, status, started_at) VALUES (?, ?, 'running', ?)`).bind(runId, options.trigger, startedAt).run();
  console.log(JSON.stringify({ event: "radar.academic_sync.started", runId, trigger: options.trigger, startedAt }));

  try {
    const [providersResult, researchersResult] = await Promise.all([
      db.prepare(
        `SELECT id FROM paper_providers WHERE enabled = 1 AND discovery_enabled = 1 AND status = 'active'
         ORDER BY priority, id`,
      ).all<ProviderRow>(),
      db.prepare(
        `SELECT id, name FROM researchers WHERE published = 1
         ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, id LIMIT ?`,
      ).bind(MAX_RESEARCHERS_PER_RUN).all<PaperResearcher>(),
    ]);

    let candidatesFound = 0;
    let papersInserted = 0;
    let failedCount = 0;
    const allErrors: string[] = [];

    for (const provider of providersResult.results) {
      const providerStartedAt = now().toISOString();
      let providerCandidates = 0;
      let providerInserted = 0;
      const providerErrors: string[] = [];

      for (const researcher of researchersResult.results) {
        try {
          const candidates = await discoverProviderPapers(provider.id, researcher, fetcher, now());
          for (const candidate of candidates) {
            providerCandidates += 1;
            const inserted = await upsertPaperCandidate(db, runId, researcher, candidate, providerStartedAt);
            if (inserted) providerInserted += 1;
          }
        } catch (error) {
          const message = `${researcher.id}: ${errorMessage(error)}`;
          providerErrors.push(message);
          await db.prepare(
            `INSERT INTO academic_events (id, run_id, researcher_id, event_type, message, payload_json)
             VALUES (?, ?, ?, 'sync_failed', ?, ?)`,
          ).bind(crypto.randomUUID(), runId, researcher.id, message, JSON.stringify({ provider: provider.id })).run();
        }
        await pause(PROVIDER_PAUSE_MS);
      }

      const providerFinishedAt = now().toISOString();
      const providerStatus = statusFromFailures(providerErrors.length, researchersResult.results.length);
      await db.prepare(
        `INSERT INTO paper_provider_sync_logs
         (id, run_id, provider_id, status, started_at, finished_at, researchers_checked, candidates_found, papers_inserted, failed_count, error_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), runId, provider.id, providerStatus, providerStartedAt, providerFinishedAt,
        researchersResult.results.length, providerCandidates, providerInserted, providerErrors.length,
        providerErrors.slice(0, 10).join("\n") || null,
      ).run();
      await db.prepare(
        `UPDATE paper_providers SET last_sync_at = ?, last_sync_status = ?,
         consecutive_failures = CASE WHEN ? = 'failed' THEN consecutive_failures + 1 ELSE 0 END,
         last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(providerFinishedAt, providerStatus, providerStatus, providerErrors.slice(0, 3).join("\n") || null, provider.id).run();

      candidatesFound += providerCandidates;
      papersInserted += providerInserted;
      failedCount += providerErrors.length;
      allErrors.push(...providerErrors.map((message) => `${provider.id}/${message}`));
    }

    const checks = providersResult.results.length * researchersResult.results.length;
    const status = statusFromFailures(failedCount, checks);
    const finishedAt = now().toISOString();
    await db.prepare(
      `UPDATE academic_sync_runs SET status = ?, finished_at = ?, researchers_checked = ?, candidates_found = ?,
       papers_inserted = ?, failed_count = ?, error_summary = ? WHERE id = ?`,
    ).bind(status, finishedAt, checks, candidatesFound, papersInserted, failedCount, allErrors.slice(0, 10).join("\n") || null, runId).run();
    const summary: AcademicSyncSummary = { runId, status, researchersChecked: checks, candidatesFound, papersInserted, failedCount };
    console.log(JSON.stringify({ event: "radar.academic_sync.finished", ...summary, providers: providersResult.results.length, finishedAt }));
    return summary;
  } catch (error) {
    const message = errorMessage(error);
    const finishedAt = now().toISOString();
    await db.prepare(`UPDATE academic_sync_runs SET status = 'failed', finished_at = ?, error_summary = ? WHERE id = ?`).bind(finishedAt, message, runId).run();
    console.error(JSON.stringify({ event: "radar.academic_sync.failed", runId, error: message, finishedAt }));
    throw error;
  }
}

async function upsertPaperCandidate(
  db: D1Database,
  runId: string,
  researcher: PaperResearcher,
  candidate: PaperCandidate,
  seenAt: string,
): Promise<boolean> {
  const existing = await db.prepare(
    `SELECT id FROM papers WHERE (? IS NOT NULL AND doi = ?) OR (? IS NOT NULL AND pmid = ?) LIMIT 1`,
  ).bind(candidate.doi, candidate.doi, candidate.pmid, candidate.pmid).first<{ id: string }>();
  const paperId = existing?.id ?? paperIdFor(candidate);

  if (existing) {
    await db.prepare(
      `UPDATE papers SET doi = COALESCE(doi, ?), pmid = COALESCE(pmid, ?), arxiv_id = COALESCE(arxiv_id, ?),
       title = ?, abstract = CASE WHEN length(?) > length(abstract) THEN ? ELSE abstract END,
       venue = CASE WHEN venue = '' THEN ? ELSE venue END, publication_date = COALESCE(publication_date, ?),
       open_access_url = COALESCE(open_access_url, ?), relevance_score = MAX(relevance_score, ?),
       source_verified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(
      candidate.doi, candidate.pmid, candidate.arxivId, candidate.title, candidate.abstract, candidate.abstract,
      candidate.venue, candidate.publicationDate, candidate.openAccessUrl, candidate.confidence, seenAt, paperId,
    ).run();
  } else {
    await db.prepare(
      `INSERT INTO papers
       (id, doi, pmid, arxiv_id, title, abstract, venue, publication_date, paper_type, version_status,
        open_access_url, source_url, source_provider, topics_json, takeaway, relevance_score, review_status, published, source_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', 0, ?)`,
    ).bind(
      paperId, candidate.doi, candidate.pmid, candidate.arxivId, candidate.title, candidate.abstract, candidate.venue,
      candidate.publicationDate, candidate.paperType, candidate.versionStatus, candidate.openAccessUrl,
      candidate.sourceUrl, candidate.provider, JSON.stringify(candidate.topics), candidate.takeaway, candidate.confidence, seenAt,
    ).run();
  }

  await db.prepare(
    `INSERT INTO paper_authors (paper_id, researcher_id, author_name, author_order, corresponding)
     VALUES (?, ?, ?, 0, 0)
     ON CONFLICT(paper_id, author_order) DO UPDATE SET researcher_id = excluded.researcher_id, author_name = excluded.author_name`,
  ).bind(paperId, researcher.id, researcher.name).run();
  await db.prepare(
    `INSERT INTO paper_provider_records (id, provider_id, paper_id, external_id, source_url, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id, external_id) DO UPDATE SET paper_id = excluded.paper_id, source_url = excluded.source_url,
       last_seen_at = excluded.last_seen_at, updated_at = CURRENT_TIMESTAMP`,
  ).bind(recordIdFor(candidate), candidate.provider, paperId, candidate.externalId, candidate.sourceUrl, seenAt, seenAt).run();
  await db.prepare(
    `INSERT INTO academic_events (id, run_id, researcher_id, paper_id, event_type, confidence, message, payload_json)
     VALUES (?, ?, ?, ?, 'paper_candidate', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), runId, researcher.id, paperId, candidate.confidence,
    `${candidate.provider} 发现 ${researcher.name} 的论文候选`,
    JSON.stringify({ provider: candidate.provider, externalId: candidate.externalId, doi: candidate.doi, pmid: candidate.pmid, title: candidate.title }),
  ).run();
  return !existing;
}

function paperIdFor(candidate: PaperCandidate): string {
  return `${candidate.provider}-${safeId(candidate.doi ?? candidate.pmid ?? candidate.arxivId ?? candidate.externalId)}`;
}
function recordIdFor(candidate: PaperCandidate): string { return `${candidate.provider}-${safeId(candidate.externalId)}`; }
function safeId(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 150); }
function statusFromFailures(failed: number, total: number): AcademicSyncSummary["status"] { return failed === 0 ? "succeeded" : failed >= total && total > 0 ? "failed" : "partial"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500); }
function pause(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
