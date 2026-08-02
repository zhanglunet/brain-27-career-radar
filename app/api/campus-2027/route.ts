type Row = {
  id: string;
  source_id: string | null;
  name: string;
  org: string;
  kind: string;
  status: string;
  fit: string;
  location: string;
  deadline: string;
  deadline_status: string;
  opens_at: string | null;
  masters_eligible: number;
  eligibility_details: string;
  phd_bridge_details: string | null;
  why: string;
  action: string;
  tags_json: string;
  url: string;
  source_verified_at: string | null;
  source_name: string | null;
  source_last_success_at: string | null;
  source_last_checked_at: string | null;
  source_consecutive_failures: number | null;
};

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");

    const rows = await env.DB.prepare(`
      SELECT o.id,o.source_id,o.name,o.org,o.kind,o.status,o.fit,o.location,o.deadline,
        o.deadline_status,o.opens_at,o.masters_eligible,o.eligibility_details,o.phd_bridge_details,
        o.why,o.action,o.tags_json,o.url,o.source_verified_at,
        s.name AS source_name,s.last_success_at AS source_last_success_at,
        s.last_checked_at AS source_last_checked_at,s.consecutive_failures AS source_consecutive_failures
      FROM opportunities o
      LEFT JOIN sources s ON s.id=o.source_id
      WHERE o.published=1 AND o.tags_json LIKE '%2027校招专题%'
      ORDER BY CASE o.status WHEN '立即行动' THEN 0 WHEN '持续关注' THEN 1 ELSE 2 END,
        CASE o.kind WHEN '校招' THEN 0 WHEN '实习' THEN 1 ELSE 2 END,o.org,o.name
    `).all<Row>();

    const opportunities = rows.results.map(format);
    const trackSet = new Set(opportunities.flatMap((item) => item.tracks));
    return Response.json({
      generatedAt: new Date().toISOString(),
      counts: {
        total: opportunities.length,
        confirmed2027: opportunities.filter((item) => item.verification === "已确认 2027 届").length,
        china: opportunities.filter((item) => item.regions.includes("中国")).length,
        uk: opportunities.filter((item) => item.regions.includes("英国")).length,
        immediate: opportunities.filter((item) => item.status === "立即行动").length,
      },
      tracks: [...trackSet].sort(),
      opportunities,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.campus_2027.failed", error: message(error) }));
    return Response.json({ error: "2027 校招数据暂不可用" }, { status: 503 });
  }
}

function format(row: Row) {
  const tags = array(row.tags_json);
  const tracks = tags.filter((tag) => tag.startsWith("赛道:")).map((tag) => tag.slice(3));
  const regions = [
    /北京|上海|深圳|杭州|成都|全国|中国/.test(row.location) ? "中国" : null,
    /London|Cambridge|Manchester|Sheffield|Bristol|Reading|UK|英国/.test(row.location) ? "英国" : null,
    /Dublin|Ireland|爱尔兰/.test(row.location) ? "爱尔兰" : null,
    /香港|Hong Kong/.test(row.location) ? "中国香港" : null,
  ].filter((item): item is string => Boolean(item));
  const verification = tags.includes("2027届")
    ? "已确认 2027 届"
    : tags.includes("批次待确认") || tags.includes("等待开放")
      ? "2027 批次待确认"
      : "2027 专项跟踪";

  return {
    id: row.id,
    name: row.name,
    org: row.org,
    kind: row.kind,
    status: row.status,
    fit: row.fit,
    location: row.location,
    deadline: row.deadline,
    deadlineStatus: row.deadline_status,
    opensAt: row.opens_at,
    mastersEligible: Boolean(row.masters_eligible),
    eligibilityDetails: row.eligibility_details,
    phdBridgeDetails: row.phd_bridge_details,
    why: row.why,
    action: row.action,
    tags: tags.filter((tag) => !tag.startsWith("赛道:") && tag !== "2027校招专题"),
    tracks,
    regions,
    verification,
    url: row.url,
    sourceVerifiedAt: row.source_verified_at,
    source: {
      id: row.source_id,
      name: row.source_name,
      lastSuccessAt: row.source_last_success_at,
      lastCheckedAt: row.source_last_checked_at,
      healthy: Boolean(row.source_last_success_at) && !row.source_consecutive_failures,
    },
  };
}

function array(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
