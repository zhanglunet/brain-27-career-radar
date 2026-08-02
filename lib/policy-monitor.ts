import { extractAnchors } from "./p1/html.ts";
import { canonicalizeUrl } from "./p1/url.ts";

const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_CANDIDATES_PER_FEED = 60;
const POLICY_KEYWORDS = /(policy|policies|funding|fund|grant|call(?:s)?\b|work programme|strategy|budget|fellowship|scheme|guidance|application|programme|research priorities|政策|指南|项目|资助|基金|人才|合作|申报|申请|预算|战略|规划)/i;
const GENERIC_TEXT = /^(home|首页|more|更多|read more|learn more|website|官网|contact|联系我们|privacy|隐私|terms|条款|news|新闻)$/i;
const BLOCKED_HOSTS = /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|weibo|wechat|google|baidu|bing)\./i;

type Trigger = "cron" | "manual" | "test";
type FeedRow = { id:string; name:string; url:string; region:string; consecutive_failures:number };
type PolicyRow = { id:string; source_url:string; content_hash:string|null };
export type PolicyCandidate = { title:string; candidateUrl:string; policyType:string; confidence:number; evidenceExcerpt:string };
export type PolicySyncSummary = { runId:string; status:"succeeded"|"partial"|"failed"; feedsChecked:number; policiesChecked:number; candidatesFound:number; versionsAdded:number; failedCount:number };

export function extractPolicyCandidates(html:string, feedUrl:string):PolicyCandidate[]{
  const candidates:PolicyCandidate[]=[];
  const seen=new Set<string>();
  for(const anchor of extractAnchors(html)){
    const title=anchor.text.replace(/\s+/g," ").trim();
    if(title.length<5||title.length>220||GENERIC_TEXT.test(title)||!POLICY_KEYWORDS.test(title))continue;
    const candidateUrl=canonicalizeUrl(anchor.href,feedUrl);
    if(!candidateUrl||candidateUrl===canonicalizeUrl(feedUrl)||seen.has(candidateUrl))continue;
    const host=new URL(candidateUrl).hostname;
    if(BLOCKED_HOSTS.test(host))continue;
    seen.add(candidateUrl);
    candidates.push({title,candidateUrl,policyType:classify(title),confidence:confidence(title),evidenceExcerpt:`${title} → ${candidateUrl}`.slice(0,500)});
    if(candidates.length>=MAX_CANDIDATES_PER_FEED)break;
  }
  return candidates;
}

export async function syncResearchPolicies(db:D1Database,options:{trigger:Trigger;fetcher?:typeof fetch;now?:()=>Date}):Promise<PolicySyncSummary>{
  const fetcher=options.fetcher??fetch,now=options.now??(()=>new Date()),startedAt=now().toISOString(),runId=crypto.randomUUID();
  await db.prepare(`INSERT INTO policy_sync_runs (id,trigger,status,started_at) VALUES (?,?,'running',?)`).bind(runId,options.trigger,startedAt).run();
  console.log(JSON.stringify({event:"radar.policy_sync.started",runId,trigger:options.trigger}));
  try{
    const query=db.prepare(`SELECT id,name,url,region,consecutive_failures FROM policy_feeds WHERE enabled=1 ${options.trigger==="cron"?"AND (last_checked_at IS NULL OR datetime(last_checked_at) <= datetime(?, '-' || check_interval_hours || ' hours'))":""} ORDER BY id`);
    const feeds=await(options.trigger==="cron"?query.bind(startedAt):query).all<FeedRow>();
    const errors:string[]=[];let candidatesFound=0,policiesChecked=0,versionsAdded=0;
    await mapInBatches(feeds.results,4,async(feed)=>{
      const checkedAt=now().toISOString();
      try{
        const response=await timedFetch(fetcher,feed.url);if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const html=await readBoundedText(response,MAX_BODY_BYTES),candidates=extractPolicyCandidates(html,response.url||feed.url);
        for(const candidate of candidates)await db.prepare(`INSERT INTO policy_candidates (id,feed_id,title,candidate_url,region,policy_type,status,confidence,evidence_excerpt,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,'candidate',?,?,?,?) ON CONFLICT(candidate_url) DO UPDATE SET title=excluded.title,last_seen_at=excluded.last_seen_at,confidence=MAX(policy_candidates.confidence,excluded.confidence),updated_at=CURRENT_TIMESTAMP`).bind(stableId(candidate.candidateUrl),feed.id,candidate.title,candidate.candidateUrl,feed.region,candidate.policyType,candidate.confidence,candidate.evidenceExcerpt,checkedAt,checkedAt).run();
        candidatesFound+=candidates.length;
        await db.prepare(`UPDATE policy_feeds SET last_checked_at=?,last_success_at=?,last_status_code=?,consecutive_failures=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(checkedAt,checkedAt,response.status,feed.id).run();
        console.log(JSON.stringify({event:"radar.policy_sync.feed_succeeded",runId,feedId:feed.id,candidates:candidates.length}));
      }catch(error){const msg=message(error);errors.push(`${feed.id}: ${msg}`);await db.prepare(`UPDATE policy_feeds SET last_checked_at=?,consecutive_failures=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(checkedAt,feed.consecutive_failures+1,msg,feed.id).run();console.error(JSON.stringify({event:"radar.policy_sync.feed_failed",runId,feedId:feed.id,error:msg}));}
    });
    const policies=await db.prepare(`SELECT id,source_url,content_hash FROM research_policies WHERE published=1 AND review_status='verified' ORDER BY COALESCE(source_verified_at,'') ASC LIMIT 24`).all<PolicyRow>();
    await mapInBatches(policies.results,4,async(policy)=>{
      try{
        const response=await timedFetch(fetcher,policy.source_url);if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const html=await readBoundedText(response,MAX_BODY_BYTES),excerpt=plainText(html).slice(0,4000),hash=await sha256(excerpt);policiesChecked++;
        if(hash&&hash!==policy.content_hash){await db.prepare(`INSERT OR IGNORE INTO policy_versions (id,policy_id,content_hash,excerpt,captured_at) VALUES (?,?,?,?,?)`).bind(crypto.randomUUID(),policy.id,hash,excerpt,now().toISOString()).run();versionsAdded++;}
        await db.prepare(`UPDATE research_policies SET content_hash=?,source_verified_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(hash,now().toISOString(),policy.id).run();
      }catch(error){errors.push(`${policy.id}: ${message(error)}`);}
    });
    const failed=errors.length,checked=feeds.results.length,status=failed===0?"succeeded":failed>=checked+policies.results.length&&failed>0?"failed":"partial",finishedAt=now().toISOString();
    await db.prepare(`UPDATE policy_sync_runs SET status=?,finished_at=?,feeds_checked=?,policies_checked=?,candidates_found=?,versions_added=?,failed_count=?,error_summary=? WHERE id=?`).bind(status,finishedAt,checked,policiesChecked,candidatesFound,versionsAdded,failed,errors.slice(0,12).join("\n")||null,runId).run();
    const summary={runId,status,feedsChecked:checked,policiesChecked,candidatesFound,versionsAdded,failedCount:failed} satisfies PolicySyncSummary;console.log(JSON.stringify({event:"radar.policy_sync.finished",...summary}));return summary;
  }catch(error){await db.prepare(`UPDATE policy_sync_runs SET status='failed',finished_at=?,error_summary=? WHERE id=?`).bind(now().toISOString(),message(error),runId).run();throw error;}
}

async function timedFetch(fetcher:typeof fetch,url:string){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort("policy sync timed out"),REQUEST_TIMEOUT_MS);try{return await fetcher(url,{redirect:"follow",signal:controller.signal,headers:{Accept:"text/html,application/xhtml+xml,application/pdf;q=0.7,*/*;q=0.4","User-Agent":"Brain27CareerRadar/0.12 (+research-policy-monitor)"}})}finally{clearTimeout(timeout)}}
async function readBoundedText(response:Response,limit:number){const reader=response.body?.getReader();if(!reader)return(await response.text()).slice(0,limit);const decoder=new TextDecoder();let size=0,output="";while(size<limit){const{done,value}=await reader.read();if(done)break;const slice=value.slice(0,limit-size);size+=slice.byteLength;output+=decoder.decode(slice,{stream:true});if(slice.byteLength<value.byteLength){await reader.cancel();break}}return output+decoder.decode()}
function plainText(html:string){return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\s+/g," ").trim()}
async function sha256(value:string){const data=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function mapInBatches<T>(items:T[],size:number,task:(item:T)=>Promise<void>){for(let index=0;index<items.length;index+=size)await Promise.all(items.slice(index,index+size).map(task))}
function classify(title:string){if(/budget|fund|grant|call|scheme|资助|基金|申报|申请/i.test(title))return"funding";if(/talent|fellow|人才/i.test(title))return"talent";if(/collaborat|joint|合作/i.test(title))return"collaboration";if(/strategy|战略|规划/i.test(title))return"strategy";return"programme"}
function confidence(title:string){return Math.min(95,60+(POLICY_KEYWORDS.test(title)?18:0)+(/2026|2027|deadline|截止|指南|work programme/i.test(title)?12:0))}
function stableId(value:string){let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);return`policy-candidate-${(hash>>>0).toString(16)}`}
function message(error:unknown){return error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)}
