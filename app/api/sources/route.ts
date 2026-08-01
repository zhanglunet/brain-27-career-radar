type SourceRow = {
  id: string;
  name: string;
  source_type: string;
  coverage: "phd" | "campus" | "mixed";
  organization_type: "university" | "research" | "company" | "platform";
  regions_json: string;
  topics_json: string;
  description: string;
  url: string;
  enabled: number;
  adapter_key: string | null;
  discovery_enabled: number;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_status_code: number | null;
  consecutive_failures: number;
  final_url: string | null;
  snapshot_count: number;
  check_count: number;
};

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");

    const url = new URL(request.url);
    const query = clean(url.searchParams.get("q"), 80);
    const coverage = enumValue(url.searchParams.get("coverage"), ["phd", "campus", "mixed"] as const);
    const region = enumValue(url.searchParams.get("region"), ["CN", "HK", "UK", "IE"] as const);
    const state = enumValue(url.searchParams.get("state"), ["active", "manual", "failing"] as const);
    const clauses: string[] = [];
    const bindings: Array<string | number> = [];

    if (query) {
      clauses.push("(s.name LIKE ? OR s.id LIKE ? OR s.description LIKE ? OR s.topics_json LIKE ?)");
      const pattern = `%${query}%`;
      bindings.push(pattern, pattern, pattern, pattern);
    }
    if (coverage) {
      clauses.push("s.coverage = ?");
      bindings.push(coverage);
    }
    if (region) {
      clauses.push("s.regions_json LIKE ?");
      bindings.push(`%\"${region}\"%`);
    }
    if (state === "active") clauses.push("s.enabled = 1 AND s.consecutive_failures = 0");
    if (state === "manual") clauses.push("s.enabled = 0");
    if (state === "failing") clauses.push("s.enabled = 1 AND s.consecutive_failures > 0");

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const statement = env.DB.prepare(
      `SELECT s.id, s.name, s.source_type, s.coverage, s.organization_type, s.regions_json,
              s.topics_json, s.description, s.url, s.enabled, s.adapter_key, s.discovery_enabled,
              s.last_checked_at, s.last_success_at, s.last_status_code, s.consecutive_failures,
              s.final_url,
              (SELECT COUNT(*) FROM source_snapshots ss WHERE ss.source_id = s.id) AS snapshot_count,
              (SELECT COUNT(*) FROM source_check_logs scl WHERE scl.source_id = s.id) AS check_count
       FROM sources s
       ${where}
       ORDER BY s.enabled DESC, s.coverage, s.name
       LIMIT 200`,
    );
    const result = await (bindings.length ? statement.bind(...bindings) : statement).all<SourceRow>();

    return Response.json({
      generatedAt: new Date().toISOString(),
      total: result.results.length,
      sources: result.results.map((row) => ({
        id: row.id,
        name: row.name,
        sourceType: row.source_type,
        coverage: row.coverage,
        organizationType: row.organization_type,
        regions: parseStringArray(row.regions_json),
        topics: parseStringArray(row.topics_json),
        description: row.description,
        url: row.url,
        finalUrl: row.final_url,
        enabled: row.enabled === 1,
        extractionPilot: row.discovery_enabled === 1 && row.adapter_key !== null,
        lastCheckedAt: row.last_checked_at,
        lastSuccessAt: row.last_success_at,
        lastStatusCode: row.last_status_code,
        consecutiveFailures: row.consecutive_failures,
        snapshotCount: Number(row.snapshot_count ?? 0),
        checkCount: Number(row.check_count ?? 0),
        health: sourceHealth(row),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.sources_api.failed", error: errorMessage(error) }));
    return Response.json({ error: "source directory is temporarily unavailable" }, { status: 503 });
  }
}

function sourceHealth(row: SourceRow): "healthy" | "failing" | "waiting" | "manual" {
  if (row.enabled !== 1) return "manual";
  if (row.consecutive_failures > 0) return "failing";
  if (!row.last_success_at) return "waiting";
  return "healthy";
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

function enumValue<const T extends readonly string[]>(value: string | null, allowed: T): T[number] | null {
  return value && allowed.includes(value) ? value as T[number] : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
