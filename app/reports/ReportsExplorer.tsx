"use client";

import { useEffect, useState } from "react";
import styles from "../documentation.module.css";

type PeriodType="daily"|"weekly"|"monthly";
type Report={id:string;periodType:PeriodType;periodStart:string;periodEnd:string;newOpportunities:number;newSources:number;newPapers:number;newPolicies:number;newProjects:number;sourceChanges:number;sourceFailures:number;sourceRuns:number;academicRuns:number;policyRuns:number;summary:string;highlights:{opportunities:string[];sources:string[];papers:string[];policies:string[];projects:string[]};generatedAt:string};
type Payload={periodType:PeriodType;page:number;pageSize:number;total:number;reports:Report[]};
const labels:Record<PeriodType,string>={daily:"日报",weekly:"周报",monthly:"月报"};

export default function ReportsExplorer(){
  const[periodType,setPeriodType]=useState<PeriodType>("daily");
  const[query,setQuery]=useState("");
  const[page,setPage]=useState(1);
  const[data,setData]=useState<Payload|null>(null);
  const[error,setError]=useState("");
  useEffect(()=>{
    const params=new URLSearchParams({periodType,page:String(page)});
    if(query)params.set("q",query);
    fetch(`/api/reports?${params}`,{cache:"no-store"})
      .then(async(response)=>{if(!response.ok)throw new Error("报告数据暂不可用");return response.json()as Promise<Payload>})
      .then((payload)=>{setError("");setData(payload)})
      .catch((reason:Error)=>setError(reason.message));
  },[periodType,query,page]);
  const select=(value:PeriodType)=>{setPeriodType(value);setPage(1)};
  if(error)return<p className={styles.error}>{error}</p>;
  if(!data)return<p className={styles.loading}>正在整理日报、周报和月报…</p>;
  const latest=data.reports[0]??null,pages=Math.max(1,Math.ceil(data.total/data.pageSize));
  return<>
    <section className={styles.reportHeroGrid}>{latest?<><article><p className={styles.eyebrow}>LATEST · {labels[periodType]}</p><h2>{periodLabel(latest)}</h2><p>{latest.summary}</p><small>生成于 {new Date(latest.generatedAt).toLocaleString("zh-CN")}</small></article><div className={styles.reportMetric}><span>新增机会</span><strong>{latest.newOpportunities}</strong></div><div className={styles.reportMetric}><span>新增论文</span><strong>{latest.newPapers}</strong></div><div className={styles.reportMetric}><span>政策 / 项目</span><strong>{latest.newPolicies + latest.newProjects}</strong></div></>:<article><h2>等待首次报告</h2><p>下次 Cron 完成机会、论文与政策同步后，会自动生成当天日报以及本周、本月汇总。</p></article>}</section>
    <section className={styles.section}><div className={styles.sectionHead}><h2>历史报告</h2><p>日报按 UTC 自然日固化；周报从周一到周日，月报按自然月，并在每天 Cron 后重算当前周期。</p></div><div className={styles.reportToolbar}><div>{(["daily","weekly","monthly"]as PeriodType[]).map((value)=><button type="button" key={value} className={periodType===value?styles.filterActive:styles.filter} onClick={()=>select(value)}>{labels[value]}</button>)}</div><label><span className={styles.srOnly}>按日期或摘要检索</span><input value={query} onChange={(event)=>{setQuery(event.target.value);setPage(1)}} placeholder="检索日期，如 2026-08"/></label></div>{data.reports.length?<div className={styles.reportList}>{data.reports.map((report)=><ReportCard key={report.id} report={report}/>)}</div>:<p className={styles.emptyState}>当前筛选没有历史{labels[periodType]}。</p>}<div className={styles.pagination}><button type="button" disabled={page<=1} onClick={()=>setPage((value)=>value-1)}>上一页</button><span>{page} / {pages} · 共 {data.total} 份</span><button type="button" disabled={page>=pages} onClick={()=>setPage((value)=>value+1)}>下一页</button></div></section>
  </>;
}

function ReportCard({report}:{report:Report}){return<article className={styles.reportCard}><header><div><span>{labels[report.periodType]}</span><h3>{periodLabel(report)}</h3></div><small>{report.sourceRuns} 次来源 · {report.academicRuns} 次论文 · {report.policyRuns} 次政策同步</small></header><div className={styles.reportNumbers}><div><b>{report.newOpportunities}</b><span>新机会</span></div><div><b>{report.newPapers}</b><span>新论文</span></div><div><b>{report.newPolicies}</b><span>新政策</span></div><div><b>{report.newProjects}</b><span>新项目</span></div></div><p>{report.summary}</p><div className={styles.reportHighlights}>{highlight("机会",report.highlights.opportunities)}{highlight("论文",report.highlights.papers)}{highlight("政策",report.highlights.policies)}{highlight("项目",report.highlights.projects)}</div>{report.sourceFailures>0&&<p className={styles.reportWarning}>本周期有 {report.sourceFailures} 次来源检查失败；历史可信内容仍保留。</p>}</article>}
function highlight(label:string,items:string[]){if(!items.length)return null;return<div><b>{label}</b><ul>{items.map((item)=><li key={item}>{item}</li>)}</ul></div>}
function periodLabel(report:Report){if(report.periodStart===report.periodEnd)return report.periodStart;return`${report.periodStart} — ${report.periodEnd}`}
