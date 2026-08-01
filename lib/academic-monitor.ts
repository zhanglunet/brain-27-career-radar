const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESEARCHERS_PER_RUN = 16;
const MAX_WORKS_PER_RESEARCHER = 5;
const CROSSREF_ROWS_PER_QUERY = 20;

type AcademicTrigger = "cron" | "manual" | "test";

type ResearcherRow = {
  id: string;
  name: string;
  external_id: string;
};

type CrossrefAuthor = { given?: string; family?: string; name?: string };
type CrossrefWork = {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  published?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  type?: string;
  URL?: string;
  abstract?: string;
};

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
  await db.prepare(
    `INSERT INTO academic_sync_runs (id, trigger, status, started_at) VALUES (?, ?, 'running', ?)`,
  ).bind(runId, options.trigger, startedAt).run();

  console.log(JSON.stringify({ event: "radar.academic_sync.started", runId, trigger: options.trigger, startedAt }));

  const rows = await db.prepare(
    `SELECT r.id, r.name, ri.external_id
     FROM researchers r
     JOIN researcher_identities ri ON ri.researcher_id = r.id AND ri.provider = 'crossref'
     WHERE r.published = 1
     ORDER BY CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, r.id
     LIMIT ?`,
  ).bind(MAX_RESEARCHERS_PER_RUN).all<ResearcherRow>();

  let candidatesFound = 0;
  let papersInserted = 0;
  const failures: string[] = [];

  for (const researcher of rows.results) {
    try {
      const works = await fetchCrossrefWorks(fetcher, researcher.external_id, now());
      let acceptedForResearcher = 0;
      for (const work of works) {
        if (acceptedForResearcher >= MAX_WORKS_PER_RESEARCHER) break;
        const candidate = normalizeCandidate(work, researcher);
        if (!candidate) continue;
        acceptedForResearcher += 1;
        candidatesFound += 1;
        const paperId = `doi-${candidate.doi.replace(/[^a-z0-9]+/gi, "-").slice(0, 120)}`;
        const existingBefore = await db.prepare("SELECT id FROM papers WHERE doi = ?").bind(candidate.doi).first<{ id: string }>();
        await db.prepare(
          `INSERT INTO papers
           (id, doi, title, abstract, venue, publication_date, paper_type, version_status,
            source_url, source_provider, topics_json, takeaway, relevance_score, review_status,
            published, source_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, 'crossref', ?, ?, ?, 'candidate', 0, ?)
           ON CONFLICT(doi) DO UPDATE SET
             title = excluded.title, abstract = excluded.abstract, venue = excluded.venue,
             publication_date = excluded.publication_date, source_url = excluded.source_url,
             relevance_score = MAX(papers.relevance_score, excluded.relevance_score),
             source_verified_at = excluded.source_verified_at, updated_at = CURRENT_TIMESTAMP`,
        ).bind(
          paperId, candidate.doi, candidate.title, candidate.abstract, candidate.venue,
          candidate.publicationDate, candidate.paperType, candidate.sourceUrl,
          JSON.stringify(candidate.topics), candidate.takeaway, candidate.confidence, startedAt,
        ).run();
        if (!existingBefore) papersInserted += 1;

        const existing = await db.prepare("SELECT id FROM papers WHERE doi = ?").bind(candidate.doi).first<{ id: string }>();
        const resolvedPaperId = existing?.id ?? paperId;
        await db.prepare(
          `INSERT INTO paper_authors (paper_id, researcher_id, author_name, author_order, corresponding)
           VALUES (?, ?, ?, 0, 0) ON CONFLICT(paper_id, author_order) DO UPDATE SET researcher_id = excluded.researcher_id, author_name = excluded.author_name`,
        ).bind(resolvedPaperId, researcher.id, researcher.name).run();
        await db.prepare(
          `INSERT INTO academic_events (id, run_id, researcher_id, paper_id, event_type, confidence, message, payload_json)
           VALUES (?, ?, ?, ?, 'paper_candidate', ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), runId, researcher.id, resolvedPaperId, candidate.confidence,
          `发现 ${researcher.name} 的论文候选`, JSON.stringify({ doi: candidate.doi, title: candidate.title }),
        ).run();
      }
    } catch (error) {
      const message = errorMessage(error);
      failures.push(`${researcher.id}: ${message}`);
      await db.prepare(
        `INSERT INTO academic_events (id, run_id, researcher_id, event_type, message)
         VALUES (?, ?, ?, 'sync_failed', ?)`,
      ).bind(crypto.randomUUID(), runId, researcher.id, message).run();
    }
    await pause(400);
  }

  const status: AcademicSyncSummary["status"] = failures.length === 0 ? "succeeded" : failures.length === rows.results.length ? "failed" : "partial";
  const finishedAt = now().toISOString();
  await db.prepare(
    `UPDATE academic_sync_runs SET status = ?, finished_at = ?, researchers_checked = ?,
      candidates_found = ?, papers_inserted = ?, failed_count = ?, error_summary = ? WHERE id = ?`,
  ).bind(status, finishedAt, rows.results.length, candidatesFound, papersInserted, failures.length, failures.slice(0, 10).join("\n") || null, runId).run();

  const summary = { runId, status, researchersChecked: rows.results.length, candidatesFound, papersInserted, failedCount: failures.length };
  console.log(JSON.stringify({ event: "radar.academic_sync.finished", ...summary, finishedAt }));
  return summary;
}

async function fetchCrossrefWorks(fetcher: typeof fetch, author: string, now: Date): Promise<CrossrefWork[]> {
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - 18);
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.author", author);
  url.searchParams.set("query.bibliographic", "brain neural cognition neuroscience memory learning decision intelligence interface");
  url.searchParams.set("filter", `from-pub-date:${from.toISOString().slice(0, 10)}`);
  url.searchParams.set("select", "DOI,title,author,published,published-online,published-print,container-title,type,URL,abstract");
  url.searchParams.set("sort", "published");
  url.searchParams.set("order", "desc");
  url.searchParams.set("rows", String(CROSSREF_ROWS_PER_QUERY));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Crossref request timed out"), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "Brain27CareerRadar/0.3 (+https://radar.openagent.hk)" },
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfter = Math.min(3_000, Math.max(1_250, Number(response.headers.get("retry-after") ?? 0) * 1_000));
      await pause(retryAfter);
      const retry = await fetcher(url, {
        headers: { Accept: "application/json", "User-Agent": "Brain27CareerRadar/0.3 (+https://radar.openagent.hk)" },
        signal: controller.signal,
      });
      if (!retry.ok) throw new Error(`Crossref HTTP ${retry.status} after retry`);
      const payload = await retry.json() as { message?: { items?: CrossrefWork[] } };
      return payload.message?.items?.slice(0, CROSSREF_ROWS_PER_QUERY) ?? [];
    }
    if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
    const payload = await response.json() as { message?: { items?: CrossrefWork[] } };
    return payload.message?.items?.slice(0, CROSSREF_ROWS_PER_QUERY) ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCandidate(work: CrossrefWork, researcher: ResearcherRow) {
  const doi = work.DOI?.trim().toLowerCase();
  const title = work.title?.[0]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!doi || !title || !hasMatchingAuthor(work.author ?? [], researcher.name)) return null;
  const topicKeywords = ["brain", "neural", "neuron", "cognit", "memory", "learning", "decision", "intelligence", "interface", "hippocamp", "cort", "synap"];
  const matches = topicKeywords.filter((keyword) => title.toLowerCase().includes(keyword));
  const confidence = Math.min(95, 72 + matches.length * 6);
  if (confidence < 84) return null;
  const dateParts = work.published?.["date-parts"]?.[0] ?? work["published-online"]?.["date-parts"]?.[0] ?? work["published-print"]?.["date-parts"]?.[0];
  const publicationDate = dateParts ? dateParts.map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-") : null;
  const abstract = (work.abstract ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4_000);
  return {
    doi, title, abstract, publicationDate,
    venue: work["container-title"]?.[0] ?? "",
    paperType: crossrefType(work.type),
    sourceUrl: work.URL ?? `https://doi.org/${doi}`,
    topics: matches,
    confidence,
    takeaway: `Crossref 自动发现的近期论文候选；作者身份与主题相关性置信度 ${confidence}%，待进一步核验。`,
  };
}

function hasMatchingAuthor(authors: CrossrefAuthor[], expected: string): boolean {
  const normalizedExpected = normalizeName(expected);
  const expectedParts = normalizedExpected.split(" ");
  return authors.some((author) => {
    const value = author.name ?? [author.given, author.family].filter(Boolean).join(" ");
    const normalized = normalizeName(value);
    if (normalized === normalizedExpected || expectedParts.every((part) => normalized.includes(part))) return true;
    const actualParts = normalized.split(" ");
    const expectedFirst = expectedParts[0] ?? "";
    const expectedFamily = expectedParts.at(-1) ?? "";
    const actualFirst = actualParts[0] ?? "";
    const actualFamily = actualParts.at(-1) ?? "";
    return expectedFamily.length > 1 && actualFamily === expectedFamily && actualFirst[0] === expectedFirst[0];
  });
}

function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function crossrefType(value?: string): "journal" | "conference" | "preprint" | "review" | "other" {
  if (value === "journal-article") return "journal";
  if (value === "proceedings-article") return "conference";
  if (value === "posted-content") return "preprint";
  return "other";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
