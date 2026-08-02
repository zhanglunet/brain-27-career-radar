type CountRow = { total: number };

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    const [feeds, organizations, opportunities, latestRun, counts] = await Promise.all([
      env.DB.prepare(`SELECT id,name,url,region,candidate_type,enabled,last_checked_at,last_success_at,
        last_status_code,consecutive_failures,last_error FROM organization_discovery_feeds ORDER BY region,name`).all(),
      env.DB.prepare(`SELECT c.id,c.name,c.candidate_url,c.canonical_host,c.candidate_type,c.region,c.status,
        c.confidence,c.evidence_excerpt,c.first_seen_at,c.last_seen_at,f.name AS feed_name,f.url AS feed_url
        FROM organization_candidates c JOIN organization_discovery_feeds f ON f.id=c.feed_id
        ORDER BY c.last_seen_at DESC LIMIT 300`).all(),
      env.DB.prepare(`SELECT c.id,c.title,c.org,c.kind,c.location,c.deadline,c.opportunity_status,c.canonical_url,
        c.state,c.first_seen_at,c.last_seen_at,s.name AS source_name,
        (SELECT COUNT(*) FROM field_evidence e WHERE e.candidate_id=c.id) AS evidence_count
        FROM candidate_records c JOIN sources s ON s.id=c.source_id
        ORDER BY c.last_seen_at DESC LIMIT 300`).all(),
      env.DB.prepare(`SELECT id,trigger,status,started_at,finished_at,feeds_checked,candidates_found,failed_count,error_summary
        FROM organization_discovery_runs ORDER BY started_at DESC LIMIT 1`).first(),
      Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS total FROM organization_discovery_feeds WHERE enabled=1").first<CountRow>(),
        env.DB.prepare("SELECT COUNT(*) AS total FROM organization_candidates WHERE status='candidate'").first<CountRow>(),
        env.DB.prepare("SELECT COUNT(*) AS total FROM candidate_records WHERE state IN ('observed','review')").first<CountRow>(),
        env.DB.prepare("SELECT COUNT(*) AS total FROM sources WHERE enabled=1 AND discovery_enabled=1 AND adapter_key='career-listing'").first<CountRow>(),
      ]),
    ]);
    return Response.json({
      generatedAt: new Date().toISOString(),
      counts: { feeds: n(counts[0]), organizationCandidates: n(counts[1]), opportunityCandidates: n(counts[2]), listingSources: n(counts[3]) },
      feeds: feeds.results,
      organizations: organizations.results,
      opportunities: opportunities.results,
      latestRun,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "radar.discovery_page.failed", error: message(error) }));
    return Response.json({ error: "持续发现数据暂不可用" }, { status: 503 });
  }
}

function n(row: CountRow | null) { return Number(row?.total ?? 0); }
function message(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500); }
