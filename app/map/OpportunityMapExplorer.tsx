"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../documentation.module.css";

type Opportunity = { id:string; name:string; org:string; kind:string; location:string; deadline:string; deadlineStatus:string; url:string };
type Point = { id:string; label:string; labelEn:string; region:string; x:number; y:number; opportunities:Opportunity[] };
type Payload = { totalUnique:number; regions:{region:string;count:number;points:number}[]; points:Point[] };
const regionOptions=["全部","英国","中国内地","中国香港"];
const kindOptions=["全部","博士","联培博士","科研助理","实习","校招","研究岗位"];

export default function OpportunityMapExplorer(){
  const[data,setData]=useState<Payload|null>(null);
  const[error,setError]=useState(false);
  const[region,setRegion]=useState("全部");
  const[kind,setKind]=useState("全部");
  const[selectedId,setSelectedId]=useState<string|null>(null);
  useEffect(()=>{fetch("/api/opportunity-map",{cache:"no-store"}).then((response)=>{if(!response.ok)throw new Error("map failed");return response.json() as Promise<Payload>}).then(setData).catch(()=>setError(true))},[]);
  const points=useMemo(()=>(data?.points??[]).map((point)=>({...point,opportunities:point.opportunities.filter((item)=>kind==="全部"||item.kind===kind)})).filter((point)=>point.opportunities.length>0&&(region==="全部"||point.region===region)),[data,region,kind]);
  const selected=points.find((point)=>point.id===selectedId)??points[0]??null;
  if(error)return <p className={styles.error}>地图数据暂时不可用，请稍后重试。</p>;
  if(!data)return <p className={styles.loading}>正在绘制全球机会分布…</p>;
  return <>
    <section className={styles.mapStats} aria-label="区域机会统计">
      {data.regions.map((item)=><button type="button" key={item.region} className={region===item.region?styles.mapStatActive:styles.mapStat} onClick={()=>setRegion(region===item.region?"全部":item.region)}><span>{item.region}</span><strong>{item.count}</strong><small>{item.points} 个城市点</small></button>)}
      <div className={styles.mapStat}><span>全部唯一机会</span><strong>{data.totalUnique}</strong><small>多城市岗位只计一次</small></div>
    </section>
    <div className={styles.mapFilters}>
      <div>{regionOptions.map((value)=><button type="button" key={value} className={region===value?styles.filterActive:styles.filter} onClick={()=>setRegion(value)}>{value}</button>)}</div>
      <div>{kindOptions.map((value)=><button type="button" key={value} className={kind===value?styles.filterActive:styles.filter} onClick={()=>setKind(value)}>{value}</button>)}</div>
    </div>
    <section className={styles.mapLayout}>
      <div className={styles.worldMapWrap}>
        <svg className={styles.worldMap} viewBox="0 0 1000 500" role="img" aria-labelledby="map-title map-desc">
          <title id="map-title">全球学术机会分布地图</title><desc id="map-desc">显示英国、中国内地和中国香港各城市的当前机会数量。</desc>
          <rect width="1000" height="500" rx="24" className={styles.mapOcean}/>
          <g className={styles.mapGrid}>{[100,200,300,400,500,600,700,800,900].map((x)=><line key={`x${x}`} x1={x} y1="0" x2={x} y2="500"/>)}{[100,200,300,400].map((y)=><line key={`y${y}`} x1="0" y1={y} x2="1000" y2={y}/>)}</g>
          <g className={styles.mapLand}><path d="M48 107 103 54 181 43 238 70 271 118 232 147 201 195 153 219 102 183 66 160Z"/><path d="M205 230 254 252 277 321 248 407 212 448 187 368 177 296Z"/><path d="M438 86 492 58 553 76 579 108 630 91 704 104 767 144 852 138 924 176 904 226 828 241 758 218 708 251 651 231 602 184 555 175 509 199 467 174 421 145Z"/><path d="M484 208 550 209 600 252 587 342 535 429 483 375 451 301Z"/><path d="M826 318 893 294 953 331 938 393 867 414 811 369Z"/><path d="M355 94 388 78 406 107 389 134 360 126Z"/></g>
          {points.map((point)=><Marker key={point.id} point={point} active={selected?.id===point.id} onSelect={()=>setSelectedId(point.id)}/>)}
        </svg>
        <p className={styles.mapNote}>圆点数字为当前筛选下的机会数；含多个城市的岗位会出现在多个城市点，但“全部唯一机会”只计一次。</p>
      </div>
      <aside className={styles.mapInspector}>{selected?<><p className={styles.eyebrow}>{selected.region} · {selected.labelEn}</p><h2>{selected.label}</h2><strong className={styles.mapCount}>{selected.opportunities.length}</strong><span> 个机会</span><div className={styles.mapOpportunityList}>{selected.opportunities.map((item)=><article key={item.id}><div><span>{item.kind}</span><small>{dateStatus(item.deadlineStatus)}</small></div><h3>{item.name}</h3><p>{item.org} · {item.location}</p><p>{item.deadline}</p><a href={item.url} target="_blank" rel="noreferrer">查看官方页面 ↗</a></article>)}</div></>:<><h2>当前筛选没有机会</h2><p>切换地区或机会类型继续查看。</p></>}</aside>
    </section>
    <section className={styles.mapAccessible}><h2>城市清单</h2><div>{points.map((point)=><button type="button" key={point.id} onClick={()=>setSelectedId(point.id)}><strong>{point.label}</strong><span>{point.region}</span><b>{point.opportunities.length}</b></button>)}</div></section>
  </>;
}

function Marker({point,active,onSelect}:{point:Point;active:boolean;onSelect:()=>void}){const count=point.opportunities.length,radius=10+Math.min(count,18)*1.2;return <g className={active?styles.mapMarkerActive:styles.mapMarker} role="button" tabIndex={0} aria-label={`${point.label} ${count} 个机会`} onClick={onSelect} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" ")onSelect()}}><circle cx={point.x} cy={point.y} r={radius+8} className={styles.mapPulse}/><circle cx={point.x} cy={point.y} r={radius}/><text x={point.x} y={point.y+4}>{count}</text><text x={point.x} y={point.y-radius-12} className={styles.mapLabel}>{point.label}</text></g>}
function dateStatus(value:string){return value==="confirmed"?"官方日期":value==="estimated"?"预计日期":value==="rolling"?"滚动":"待确认"}
