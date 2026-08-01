type ReportDatabase={prepare:(sql:string)=>{bind:(...values:unknown[])=>{first:<T>()=>Promise<T|null>;all:<T>()=>Promise<{results:T[]}>;run:()=>Promise<unknown>}}};
type CountRow={new_opportunities:number;new_sources:number;new_papers:number;source_changes:number;source_failures:number;source_runs:number;academic_runs:number};
type NameRow={name:string};
export type ReportPeriod="daily"|"weekly"|"monthly";

export async function refreshIntelligenceReports(database:ReportDatabase,now=new Date()){
  const today=utcDate(now),weekStart=startOfWeek(today),monthStart=`${today.slice(0,7)}-01`;
  const periods=[
    {type:"daily"as const,start:today,end:today},
    {type:"weekly"as const,start:weekStart,end:addDays(weekStart,6)},
    {type:"monthly"as const,start:monthStart,end:addDays(addMonths(monthStart,1),-1)},
  ];
  const reports=[];
  for(const period of periods)reports.push(await refreshPeriod(database,period.type,period.start,period.end,now));
  console.log(JSON.stringify({event:"radar.reports.refreshed",date:today,reports:reports.map((item)=>({id:item.id,type:item.periodType,newOpportunities:item.newOpportunities,newSources:item.newSources,newPapers:item.newPapers}))}));
  return reports;
}

async function refreshPeriod(database:ReportDatabase,periodType:ReportPeriod,periodStart:string,periodEnd:string,now:Date){
  const from=`${periodStart}T00:00:00.000Z`,until=`${addDays(periodEnd,1)}T00:00:00.000Z`;
  const counts=await database.prepare(`SELECT
    (SELECT COUNT(*) FROM opportunities WHERE published=1 AND created_at>=? AND created_at<?) new_opportunities,
    (SELECT COUNT(*) FROM sources WHERE created_at>=? AND created_at<?) new_sources,
    (SELECT COUNT(*) FROM papers WHERE created_at>=? AND created_at<?) new_papers,
    (SELECT COUNT(*) FROM source_check_logs WHERE changed=1 AND checked_at>=? AND checked_at<?) source_changes,
    (SELECT COUNT(*) FROM source_check_logs WHERE ok=0 AND checked_at>=? AND checked_at<?) source_failures,
    (SELECT COUNT(*) FROM sync_runs WHERE started_at>=? AND started_at<?) source_runs,
    (SELECT COUNT(*) FROM academic_sync_runs WHERE started_at>=? AND started_at<?) academic_runs`).bind(from,until,from,until,from,until,from,until,from,until,from,until,from,until).first<CountRow>();
  if(!counts)throw new Error("report count query returned no row");
  const[opportunities,sources,papers]=await Promise.all([
    database.prepare(`SELECT name FROM opportunities WHERE published=1 AND created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 8`).bind(from,until).all<NameRow>(),
    database.prepare(`SELECT name FROM sources WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 8`).bind(from,until).all<NameRow>(),
    database.prepare(`SELECT COALESCE(title_zh,title) name FROM papers WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 8`).bind(from,until).all<NameRow>(),
  ]);
  const label=periodType==="daily"?"日报":periodType==="weekly"?"周报":"月报";
  const summary=`${label}：新增机会 ${counts.new_opportunities} 个、信息源 ${counts.new_sources} 个、论文 ${counts.new_papers} 篇；完成来源巡检 ${counts.source_runs} 轮、论文同步 ${counts.academic_runs} 轮，发现 ${counts.source_changes} 个来源变化，${counts.source_failures} 次来源检查失败。`;
  const id=`${periodType}:${periodStart}`,generatedAt=now.toISOString(),highlights={opportunities:opportunities.results.map((item)=>item.name),sources:sources.results.map((item)=>item.name),papers:papers.results.map((item)=>item.name)};
  await database.prepare(`INSERT INTO intelligence_reports (id,period_type,period_start,period_end,new_opportunities,new_sources,new_papers,source_changes,source_failures,source_runs,academic_runs,summary,highlights_json,generated_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(period_type,period_start) DO UPDATE SET period_end=excluded.period_end,new_opportunities=excluded.new_opportunities,new_sources=excluded.new_sources,new_papers=excluded.new_papers,source_changes=excluded.source_changes,source_failures=excluded.source_failures,source_runs=excluded.source_runs,academic_runs=excluded.academic_runs,summary=excluded.summary,highlights_json=excluded.highlights_json,generated_at=excluded.generated_at,updated_at=excluded.updated_at`).bind(id,periodType,periodStart,periodEnd,counts.new_opportunities,counts.new_sources,counts.new_papers,counts.source_changes,counts.source_failures,counts.source_runs,counts.academic_runs,summary,JSON.stringify(highlights),generatedAt,generatedAt).run();
  return{id,periodType,periodStart,periodEnd,newOpportunities:counts.new_opportunities,newSources:counts.new_sources,newPapers:counts.new_papers,sourceChanges:counts.source_changes,sourceFailures:counts.source_failures,sourceRuns:counts.source_runs,academicRuns:counts.academic_runs,summary,highlights,generatedAt};
}

function utcDate(value:Date){return value.toISOString().slice(0,10)}
function startOfWeek(date:string){const value=new Date(`${date}T00:00:00.000Z`),day=value.getUTCDay()||7;value.setUTCDate(value.getUTCDate()-day+1);return utcDate(value)}
function addDays(date:string,days:number){const value=new Date(`${date}T00:00:00.000Z`);value.setUTCDate(value.getUTCDate()+days);return utcDate(value)}
function addMonths(date:string,months:number){const value=new Date(`${date}T00:00:00.000Z`);value.setUTCMonth(value.getUTCMonth()+months);return utcDate(value)}
