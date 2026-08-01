type Row = {
  id: string; doi: string | null; pmid: string | null; pmcid: string | null; arxiv_id: string | null; title: string; title_zh: string | null;
  abstract: string; abstract_zh: string | null; translation_status: string; translated_at: string | null; venue: string; publication_date: string | null; paper_type: string;
  version_status: string; source_url: string; source_provider: string; topics_json: string; takeaway: string; relevance_score: number;
  review_status: string; source_verified_at: string | null; authors: string | null; researcher_ids: string | null; providers: string | null;
};

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    const url = new URL(request.url);
    const q = clean(url.searchParams.get("q"), 80);
    const researcher = clean(url.searchParams.get("researcher"), 80);
    const status = allowed(url.searchParams.get("status"), ["verified", "candidate"]);
    const clauses = ["p.review_status != 'rejected'"];
    const bindings: string[] = [];
    if (q) { clauses.push("(p.title LIKE ? OR p.title_zh LIKE ? OR p.abstract LIKE ? OR p.abstract_zh LIKE ? OR p.venue LIKE ? OR p.topics_json LIKE ?)"); const pattern = `%${q}%`; bindings.push(pattern, pattern, pattern, pattern, pattern, pattern); }
    if (researcher) { clauses.push("EXISTS (SELECT 1 FROM paper_authors pa2 JOIN researchers r2 ON r2.id = pa2.researcher_id WHERE pa2.paper_id = p.id AND r2.slug = ?)"); bindings.push(researcher); }
    if (status) { clauses.push("p.review_status = ?"); bindings.push(status); }
    const statement = env.DB.prepare(
      `SELECT p.*, GROUP_CONCAT(pa.author_name, '、') AS authors, GROUP_CONCAT(pa.researcher_id) AS researcher_ids,
        (SELECT GROUP_CONCAT(provider_id) FROM paper_provider_records WHERE paper_id = p.id) AS providers
       FROM papers p LEFT JOIN paper_authors pa ON pa.paper_id = p.id
       WHERE ${clauses.join(" AND ")} GROUP BY p.id
       ORDER BY COALESCE(p.publication_date, p.created_at) DESC, p.relevance_score DESC LIMIT 100`,
    );
    const result = await (bindings.length ? statement.bind(...bindings) : statement).all<Row>();
    const latestRun = await env.DB.prepare(
      `SELECT id, status, started_at, finished_at, researchers_checked, candidates_found, papers_inserted, failed_count
       FROM academic_sync_runs ORDER BY started_at DESC LIMIT 1`,
    ).first();
    return Response.json({ generatedAt: new Date().toISOString(), total: result.results.length, latestRun: latestRun ?? null,
      papers: result.results.map((row) => ({ id: row.id, doi: row.doi, pmid: row.pmid, pmcid: row.pmcid, arxivId: row.arxiv_id,
        title: row.title, titleZh: row.title_zh, abstract: row.abstract, abstractZh: row.abstract_zh,
        translationStatus: row.translation_status, translatedAt: row.translated_at, venue: row.venue,
        publicationDate: row.publication_date, paperType: row.paper_type, versionStatus: row.version_status,
        sourceUrl: row.source_url, topics: array(row.topics_json), takeaway: row.takeaway,
        relevanceScore: row.relevance_score, reviewStatus: row.review_status, sourceVerifiedAt: row.source_verified_at,
        authors: row.authors?.split("、") ?? [], researcherIds: row.researcher_ids?.split(",").filter(Boolean) ?? [],
        providers: row.providers?.split(",").filter(Boolean) ?? [row.source_provider] }))
    }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.papers_api.failed", error: message(error) }));
    return Response.json({ error: "paper radar is temporarily unavailable" }, { status: 503 });
  }
}

function array(value: string): string[] { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []; } catch { return []; } }
function clean(value: string | null, max: number) { const result = value?.trim().slice(0, max); return result || null; }
function allowed<T extends string>(value: string | null, values: readonly T[]): T | null { return value && values.includes(value as T) ? value as T : null; }
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500); }
