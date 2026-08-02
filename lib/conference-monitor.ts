const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

type Trigger = "cron" | "manual" | "test";
type ConferenceRow = { id:string; official_url:string; content_hash:string|null };
export type ConferenceSyncSummary = { runId:string; status:"succeeded"|"partial"|"failed"; conferencesChecked:number; versionsAdded:number; failedCount:number };

export function conferenceContentExcerpt(html:string):string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/\s+/g," ").trim().slice(0,8000);
}

export async function syncAcademicConferences(db:D1Database,options:{trigger:Trigger;fetcher?:typeof fetch;now?:()=>Date}):Promise<ConferenceSyncSummary>{
  const fetcher=options.fetcher??fetch,now=options.now??(()=>new Date()),startedAt=now().toISOString(),runId=crypto.randomUUID();
  await db.prepare(`INSERT INTO conference_sync_runs (id,trigger,status,started_at) VALUES (?,?,'running',?)`).bind(runId,options.trigger,startedAt).run();
  console.log(JSON.stringify({event:"radar.conference_sync.started",runId,trigger:options.trigger}));
  try{
    const query=db.prepare(`SELECT id,official_url,content_hash FROM academic_conferences WHERE published=1 ${options.trigger==="cron"?"AND (source_verified_at IS NULL OR datetime(source_verified_at) <= datetime(?, '-' || check_interval_hours || ' hours'))":""} ORDER BY COALESCE(source_verified_at,'') ASC,id LIMIT 24`);
    const rows=await(options.trigger==="cron"?query.bind(startedAt):query).all<ConferenceRow>();
    const errors:string[]=[];let checked=0,versionsAdded=0;
    await mapInBatches(rows.results,4,async(row)=>{
      try{
        const response=await timedFetch(fetcher,row.official_url);if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const excerpt=conferenceContentExcerpt(await readBoundedText(response,MAX_BODY_BYTES));
        if(excerpt.length<80)throw new Error("official page returned insufficient content");
        const hash=await sha256(excerpt),capturedAt=now().toISOString();checked++;
        if(hash!==row.content_hash){
          const result=await db.prepare(`INSERT OR IGNORE INTO conference_versions (id,conference_id,content_hash,excerpt,captured_at) VALUES (?,?,?,?,?)`).bind(crypto.randomUUID(),row.id,hash,excerpt,capturedAt).run();
          if(result.meta.changes>0)versionsAdded++;
        }
        await db.prepare(`UPDATE academic_conferences SET content_hash=?,source_verified_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(hash,capturedAt,row.id).run();
        console.log(JSON.stringify({event:"radar.conference_sync.succeeded",runId,conferenceId:row.id,changed:hash!==row.content_hash}));
      }catch(error){const summary=message(error);errors.push(`${row.id}: ${summary}`);console.error(JSON.stringify({event:"radar.conference_sync.failed",runId,conferenceId:row.id,error:summary}));}
    });
    const failed=errors.length,total=rows.results.length,status=failed===0?"succeeded":failed>=total&&total>0?"failed":"partial",finishedAt=now().toISOString();
    await db.prepare(`UPDATE conference_sync_runs SET status=?,finished_at=?,conferences_checked=?,versions_added=?,failed_count=?,error_summary=? WHERE id=?`).bind(status,finishedAt,checked,versionsAdded,failed,errors.slice(0,12).join("\n")||null,runId).run();
    const summary={runId,status,conferencesChecked:checked,versionsAdded,failedCount:failed} satisfies ConferenceSyncSummary;
    console.log(JSON.stringify({event:"radar.conference_sync.finished",...summary}));return summary;
  }catch(error){await db.prepare(`UPDATE conference_sync_runs SET status='failed',finished_at=?,error_summary=? WHERE id=?`).bind(now().toISOString(),message(error),runId).run();throw error;}
}

async function timedFetch(fetcher:typeof fetch,url:string){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort("conference sync timed out"),REQUEST_TIMEOUT_MS);try{return await fetcher(url,{redirect:"follow",signal:controller.signal,headers:{Accept:"text/html,application/xhtml+xml,*/*;q=0.5","User-Agent":"Brain27CareerRadar/0.13 (+academic-conference-monitor)"}})}finally{clearTimeout(timeout)}}
async function readBoundedText(response:Response,limit:number){const reader=response.body?.getReader();if(!reader)return(await response.text()).slice(0,limit);const decoder=new TextDecoder();let size=0,output="";while(size<limit){const{done,value}=await reader.read();if(done)break;const slice=value.slice(0,limit-size);size+=slice.byteLength;output+=decoder.decode(slice,{stream:true});if(slice.byteLength<value.byteLength){await reader.cancel();break}}return output+decoder.decode()}
async function sha256(value:string){const data=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return[...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function mapInBatches<T>(items:T[],size:number,task:(item:T)=>Promise<void>){for(let index=0;index<items.length;index+=size)await Promise.all(items.slice(index,index+size).map(task))}
function message(error:unknown){return error instanceof Error?error.message.slice(0,500):String(error).slice(0,500)}
