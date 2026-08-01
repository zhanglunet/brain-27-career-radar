type GraphNode = { id: string; type: "paper" | "researcher" | "topic" | "institution" | "opportunity"; label: string; labelEn?: string; subtitle?: string; url?: string };
type GraphEdge = { source: string; target: string; relation: string };
type PaperRow = { id:string; title:string; title_zh:string|null; source_url:string; topics_json:string };
type ResearcherRow = { id:string; name:string; name_zh:string|null; institution:string; department:string; profile_url:string; topics_json:string };
type InstitutionRow = { id:string; name:string; name_en:string|null; institution_type:string; city:string; url:string; topics_json:string };
type OpportunityRow = { id:string; name:string; org:string; kind:string; url:string; tags_json:string };
type AuthorRow = { paper_id:string; researcher_id:string };

export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB) throw new Error("D1 binding DB is unavailable");
    const [papersResult, researchersResult, institutionsResult, opportunitiesResult, authorsResult] = await Promise.all([
      env.DB.prepare(`SELECT id,title,title_zh,source_url,topics_json FROM papers WHERE review_status != 'rejected' ORDER BY COALESCE(publication_date,created_at) DESC LIMIT 60`).all<PaperRow>(),
      env.DB.prepare(`SELECT id,name,name_zh,institution,department,profile_url,topics_json FROM researchers WHERE published=1 ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END LIMIT 40`).all<ResearcherRow>(),
      env.DB.prepare(`SELECT id,name,name_en,institution_type,city,url,topics_json FROM institutions WHERE published=1 ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,sort_order LIMIT 60`).all<InstitutionRow>(),
      env.DB.prepare(`SELECT id,name,org,kind,url,tags_json FROM opportunities WHERE published=1 ORDER BY created_at DESC LIMIT 80`).all<OpportunityRow>(),
      env.DB.prepare(`SELECT paper_id,researcher_id FROM paper_authors WHERE researcher_id IS NOT NULL`).all<AuthorRow>(),
    ]);

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const topicCounts = new Map<string, number>();
    const paperTopics = new Map<string, string[]>();
    const researcherTopics = new Map<string, string[]>();

    for (const institution of institutionsResult.results) nodes.set(`institution:${institution.id}`, {
      id:`institution:${institution.id}`, type:"institution", label:institution.name, labelEn:institution.name_en ?? undefined,
      subtitle:`${typeLabel(institution.institution_type)}${institution.city ? ` · ${institution.city}` : ""}`, url:institution.url,
    });
    for (const paper of papersResult.results) {
      nodes.set(`paper:${paper.id}`, { id:`paper:${paper.id}`, type:"paper", label:paper.title_zh ?? paper.title, labelEn:paper.title_zh ? paper.title : undefined, url:paper.source_url });
      const topics = array(paper.topics_json); paperTopics.set(paper.id, topics); countTopics(topicCounts, topics);
    }
    for (const researcher of researchersResult.results) {
      nodes.set(`researcher:${researcher.id}`, { id:`researcher:${researcher.id}`, type:"researcher", label:researcher.name_zh ?? researcher.name, labelEn:researcher.name_zh ? researcher.name : undefined, subtitle:researcher.department || researcher.institution, url:researcher.profile_url });
      const topics = array(researcher.topics_json); researcherTopics.set(researcher.id, topics); countTopics(topicCounts, topics);
      const institutionId = matchedInstitution(researcher, institutionsResult.results);
      if (institutionId) edges.push({ source:`researcher:${researcher.id}`, target:`institution:${institutionId}`, relation:"任职 / affiliated" });
    }
    for (const author of authorsResult.results) if (nodes.has(`paper:${author.paper_id}`) && nodes.has(`researcher:${author.researcher_id}`)) {
      edges.push({ source:`researcher:${author.researcher_id}`, target:`paper:${author.paper_id}`, relation:"作者 / author" });
    }

    const allowedTopics = new Set([...topicCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([topic])=>topic));
    for (const topic of allowedTopics) nodes.set(`topic:${topic}`, { id:`topic:${topic}`, type:"topic", label:topic });
    for (const [paperId, topics] of paperTopics) for (const topic of topics) if (allowedTopics.has(topic)) edges.push({ source:`paper:${paperId}`, target:`topic:${topic}`, relation:"研究方向 / topic" });
    for (const [researcherId, topics] of researcherTopics) for (const topic of topics) if (allowedTopics.has(topic)) edges.push({ source:`researcher:${researcherId}`, target:`topic:${topic}`, relation:"研究方向 / topic" });

    for (const opportunity of opportunitiesResult.results) {
      const id = `opportunity:${opportunity.id}`;
      nodes.set(id, { id, type:"opportunity", label:opportunity.name, subtitle:opportunity.kind, url:opportunity.url });
      const institution = matchedOpportunityInstitution(opportunity.org, institutionsResult.results);
      if (institution) edges.push({ source:id, target:`institution:${institution.id}`, relation:"发布机会 / offers" });
      for (const topic of array(opportunity.tags_json)) if (allowedTopics.has(topic)) edges.push({ source:id, target:`topic:${topic}`, relation:"相关方向 / relates" });
    }

    const connected = new Set(edges.flatMap((edge)=>[edge.source,edge.target]));
    const compactNodes = [...nodes.values()].filter((node)=>connected.has(node.id) || node.type === "institution");
    const compactIds = new Set(compactNodes.map((node)=>node.id));
    return Response.json({ generatedAt:new Date().toISOString(), counts:counts(compactNodes), nodes:compactNodes, edges:edges.filter((edge)=>compactIds.has(edge.source)&&compactIds.has(edge.target)) }, { headers:{ "Cache-Control":"public, max-age=300" } });
  } catch (error) {
    console.error(JSON.stringify({ event:"radar.knowledge_graph.failed", error:message(error) }));
    return Response.json({ error:"knowledge graph is temporarily unavailable" }, { status:503 });
  }
}

function array(value:string):string[]{try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((x):x is string=>typeof x==="string"&&x.trim().length>0):[]}catch{return[]}}
function countTopics(target:Map<string,number>,topics:string[]){for(const topic of topics)target.set(topic,(target.get(topic)??0)+1)}
function matchedInstitution(researcher:ResearcherRow,institutions:InstitutionRow[]):string|null{
  const key=`${researcher.institution} ${researcher.department}`.toLowerCase();
  const preferred = key.includes("peking") ? "pku-mcgovern" : key.includes("tsinghua") ? (researcher.id==="r-luping-shi"?"tsinghua-cbicr":"tsinghua-thbi") : key.includes("institute of psychology") ? "cas-psych" : key.includes("institute of automation") ? "casia" : null;
  if(preferred&&institutions.some((item)=>item.id===preferred))return preferred;
  return institutions.find((item)=>key.includes(item.name.toLowerCase())||(item.name_en&&key.includes(item.name_en.toLowerCase())))?.id??null;
}
function matchedOpportunityInstitution(org:string,institutions:InstitutionRow[]):InstitutionRow|null{const key=org.replace(/\s+/g,"").toLowerCase();return institutions.find((item)=>{const names=[item.name,item.name_en??""].map((name)=>name.replace(/\s+/g,"").toLowerCase()).filter(Boolean);return names.some((name)=>key.includes(name)||name.includes(key))})??(key.includes("北京大学")?institutions.find((item)=>item.id==="pku-mcgovern")??null:key.includes("清华大学")?institutions.find((item)=>item.id==="tsinghua-thbi")??null:key.includes("自动化")?institutions.find((item)=>item.id==="casia")??null:null)}
function counts(nodes:GraphNode[]){return nodes.reduce<Record<string,number>>((result,node)=>{result[node.type]=(result[node.type]??0)+1;return result},{})}
function typeLabel(value:string){return({university:"高校/高校实验室",national_lab:"全国/国家重点实验室",cas_institute:"中科院研究所",research_institute:"科研机构",company:"企业"}as Record<string,string>)[value]??value}
function message(error:unknown){return error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)}
