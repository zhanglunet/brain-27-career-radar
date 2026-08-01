type CheckLogRow = {
  id: string;
  run_id: string;
  source_id: string;
  source_name: string;
  coverage: "phd" | "campus" | "mixed";
  regions_json: string;
  checked_at: string;
  outcome: "unchanged" | "changed" | "not_modified" | "failed";
  status_code: number | null;
  final_url: string | null;
  error_summary: string | null;
  candidates_count: number;
  evidence_count: number;
  change_sets_count: number;
  applied_count: number;
  trigger: "cron" | "manual" | "test";
};

type CountRow = {
  total: number;
  succeeded: number;
  failed: number;
  changed: number;
  candidates: number;
  evidence: number;
  decisions: number;
  published: number;
};

type RunRow = {
  id: string;
  trigger: "cron" | "manual" | "test";
  status: "running" | "succeeded" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  checked_count: number;
  changed_count: number;
  failed_count: number;
};

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");

    const url = new URL(request.url);
    const query = clean(url.searchParams.get("q"), 80);
    const outcome = enumValue(url.searchParams.get("outcome"), ["unchanged", "changed", "not_modified", "failed"] as const);
    const trigger = enumValue(url.searchParams.get("trigger"), ["cron", "manual", "test"] as const);
    const coverage = enumValue(url.searchParams.get("coverage"), ["phd", "campus", "mixed"] as const);
    const region = enumValue(url.searchParams.get("region"), ["CN", "HK", "UK", "IE"] as const);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "") ? url.searchParams.get("date") : null;
    const page = boundedNumber(url.searchParams.get("page"), 1, 10_000, 1);
    const pageSize = boundedNumber(url.searchParams.get("pageSize"), 10, 50, 25);
    const offset = (page - 1) * pageSize;
    const clauses: string[] = [];
    const bindings: Array<string | number> = [];

    if (query) {
      clauses.push("(s.name LIKE ? OR s.id LIKE ? OR scl.error_summary LIKE ?)");
      const pattern = `%${query}%`;
      bindings.push(pattern, pattern, pattern);
    }
    if (outcome) {
      clauses.push("scl.outcome = ?");
      bindings.push(outcome);
    }
    if (trigger) {
      clauses.push("sr.trigger = ?");
      bindings.push(trigger);
    }
    if (coverage) {
      clauses.push("s.coverage = ?");
      bindings.push(coverage);
    }
    if (region) {
      clauses.push("s.regions_json LIKE ?");
      bindings.push(`%\"${region}\"%`);
    }
    if (date) {
      clauses.push("substr(scl.checked_at, 1, 10) = ?");
      bindings.push(date);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const join = "FROM source_check_logs scl JOIN sources s ON s.id = scl.source_id JOIN sync_runs sr ON sr.id = scl.run_id";

    const listStatement = env.DB.prepare(
      `SELECT scl.id, scl.run_id, scl.source_id, s.name AS source_name, s.coverage, s.regions_json,
              scl.checked_at, scl.outcome, scl.status_code, scl.final_url, scl.error_summary,
              scl.candidates_count, scl.evidence_count, scl.change_sets_count, scl.applied_count, sr.trigger
       ${join} ${where}
       ORDER BY scl.checked_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...bindings, pageSize, offset);
    const countStatement = env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN scl.ok = 1 THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN scl.ok = 0 THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN scl.changed = 1 THEN 1 ELSE 0 END) AS changed,
              SUM(scl.candidates_count) AS candidates,
              SUM(scl.evidence_count) AS evidence,
              SUM(scl.change_sets_count) AS decisions,
              SUM(scl.applied_count) AS published
       ${join} ${where}`,
    ).bind(...bindings);
    const runsStatement = env.DB.prepare(
      `SELECT id, trigger, status, started_at, finished_at, checked_count, changed_count, failed_count
       FROM sync_runs
       ORDER BY started_at DESC LIMIT 30`,
    );
    const [items, counts, runs] = await Promise.all([
      listStatement.all<CheckLogRow>(),
      countStatement.first<CountRow>(),
      runsStatement.all<RunRow>(),
    ]);

    return Response.json({
      generatedAt: new Date().toISOString(),
      page,
      pageSize,
      total: number(counts?.total),
      summary: {
        succeeded: number(counts?.succeeded),
        failed: number(counts?.failed),
        changed: number(counts?.changed),
        candidates: number(counts?.candidates),
        evidence: number(counts?.evidence),
        decisions: number(counts?.decisions),
        published: number(counts?.published),
      },
      runs: runs.results,
      checks: items.results.map((row) => ({
        id: row.id,
        runId: row.run_id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        coverage: row.coverage,
        regions: parseStringArray(row.regions_json),
        checkedAt: row.checked_at,
        outcome: row.outcome,
        statusCode: row.status_code,
        finalUrl: row.final_url,
        errorSummary: row.error_summary,
        candidatesCount: row.candidates_count,
        evidenceCount: row.evidence_count,
        changeSetsCount: row.change_sets_count,
        appliedCount: row.applied_count,
        trigger: row.trigger,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.logs_api.failed", error: errorMessage(error) }));
    return Response.json({ error: "collection logs are temporarily unavailable" }, { status: 503 });
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function clean(value: string | null, maxLength: number): string | null {
  const cleaned = value?.trim().slice(0, maxLength);
  return cleaned || null;
}

function boundedNumber(value: string | null, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function enumValue<const T extends readonly string[]>(value: string | null, allowed: T): T[number] | null {
  return value && allowed.includes(value) ? value as T[number] : null;
}

function number(value: number | undefined | null): number {
  return Number(value ?? 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
