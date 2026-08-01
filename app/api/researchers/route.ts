type Row = {
  id: string; slug: string; name: string; name_zh: string | null; institution: string; department: string;
  role: string; region: string; city: string; profile_url: string; lab_url: string | null; topics_json: string;
  methods_json: string; summary: string; application_value: string; recruitment_status: string; priority: string;
  source_verified_at: string | null; paper_count: number;
};

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    const url = new URL(request.url);
    const q = clean(url.searchParams.get("q"), 80);
    const region = allowed(url.searchParams.get("region"), ["CN", "HK", "UK", "US", "EU", "OTHER"]);
    const priority = allowed(url.searchParams.get("priority"), ["normal", "high", "critical"]);
    const clauses = ["r.published = 1"];
    const bindings: string[] = [];
    if (q) {
      clauses.push("(r.name LIKE ? OR r.name_zh LIKE ? OR r.institution LIKE ? OR r.topics_json LIKE ? OR r.methods_json LIKE ?)");
      const pattern = `%${q}%`;
      bindings.push(pattern, pattern, pattern, pattern, pattern);
    }
    if (region) { clauses.push("r.region = ?"); bindings.push(region); }
    if (priority) { clauses.push("r.priority = ?"); bindings.push(priority); }
    const statement = env.DB.prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM paper_authors pa JOIN papers p ON p.id = pa.paper_id
        WHERE pa.researcher_id = r.id AND p.review_status != 'rejected') AS paper_count
       FROM researchers r WHERE ${clauses.join(" AND ")}
       ORDER BY CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, r.region, r.name LIMIT 100`,
    );
    const result = await (bindings.length ? statement.bind(...bindings) : statement).all<Row>();
    return Response.json({ generatedAt: new Date().toISOString(), total: result.results.length, researchers: result.results.map((row) => ({
      id: row.id, slug: row.slug, name: row.name, nameZh: row.name_zh, institution: row.institution,
      department: row.department, role: row.role, region: row.region, city: row.city, profileUrl: row.profile_url,
      labUrl: row.lab_url, topics: array(row.topics_json), methods: array(row.methods_json), summary: row.summary,
      applicationValue: row.application_value, recruitmentStatus: row.recruitment_status, priority: row.priority,
      sourceVerifiedAt: row.source_verified_at, paperCount: Number(row.paper_count ?? 0),
    })) }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.researchers_api.failed", error: message(error) }));
    return Response.json({ error: "researcher radar is temporarily unavailable" }, { status: 503 });
  }
}

function array(value: string): string[] { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []; } catch { return []; } }
function clean(value: string | null, max: number) { const result = value?.trim().slice(0, max); return result || null; }
function allowed<T extends string>(value: string | null, values: readonly T[]): T | null { return value && values.includes(value as T) ? value as T : null; }
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500); }
