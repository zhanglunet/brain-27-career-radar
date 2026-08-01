type ProviderRow = {
  id:string; name:string; category:string; homepage_url:string; api_docs_url:string; description:string; coverage:string;
  auth_mode:string; credential_env:string|null; status:string; enabled:number; discovery_enabled:number; priority:number;
  capabilities_json:string; notes:string; last_sync_at:string|null; last_sync_status:string|null; consecutive_failures:number;
  last_error:string|null; paper_count:number; run_count:number; last_candidates:number|null; last_inserted:number|null;
  last_failed:number|null;
};

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    const result = await env.DB.prepare(
      `SELECT pp.*,
        (SELECT COUNT(DISTINCT paper_id) FROM paper_provider_records WHERE provider_id = pp.id) AS paper_count,
        (SELECT COUNT(*) FROM paper_provider_sync_logs WHERE provider_id = pp.id) AS run_count,
        (SELECT candidates_found FROM paper_provider_sync_logs WHERE provider_id = pp.id ORDER BY started_at DESC LIMIT 1) AS last_candidates,
        (SELECT papers_inserted FROM paper_provider_sync_logs WHERE provider_id = pp.id ORDER BY started_at DESC LIMIT 1) AS last_inserted,
        (SELECT failed_count FROM paper_provider_sync_logs WHERE provider_id = pp.id ORDER BY started_at DESC LIMIT 1) AS last_failed
       FROM paper_providers pp ORDER BY pp.priority, pp.name`,
    ).all<ProviderRow>();
    return Response.json({ generatedAt:new Date().toISOString(), total:result.results.length,
      active:result.results.filter((row)=>row.enabled===1&&row.discovery_enabled===1).length,
      providers:result.results.map((row)=>({id:row.id,name:row.name,category:row.category,homepageUrl:row.homepage_url,
        apiDocsUrl:row.api_docs_url,description:row.description,coverage:row.coverage,authMode:row.auth_mode,
        credentialEnv:row.credential_env,status:row.status,enabled:row.enabled===1,discoveryEnabled:row.discovery_enabled===1,
        capabilities:array(row.capabilities_json),notes:row.notes,lastSyncAt:row.last_sync_at,lastSyncStatus:row.last_sync_status,
        consecutiveFailures:row.consecutive_failures,lastError:row.last_error,paperCount:Number(row.paper_count??0),
        runCount:Number(row.run_count??0),lastCandidates:Number(row.last_candidates??0),lastInserted:Number(row.last_inserted??0),
        lastFailed:Number(row.last_failed??0)})) }, { headers:{"Cache-Control":"no-store"} });
  } catch(error) {
    console.error(JSON.stringify({event:"radar.paper_providers_api.failed",error:message(error)}));
    return Response.json({error:"paper provider directory is temporarily unavailable"},{status:503});
  }
}
function array(value:string):string[]{try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==="string"):[]}catch{return[]}}
function message(error:unknown){return error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)}
