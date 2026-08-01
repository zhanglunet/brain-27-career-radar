"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../documentation.module.css";

type SourceItem = {
  id: string;
  name: string;
  coverage: "phd" | "campus" | "mixed";
  organizationType: "university" | "research" | "company" | "platform";
  regions: string[];
  topics: string[];
  description: string;
  url: string;
  finalUrl: string | null;
  enabled: boolean;
  extractionPilot: boolean;
  lastCheckedAt: string | null;
  lastStatusCode: number | null;
  consecutiveFailures: number;
  snapshotCount: number;
  checkCount: number;
  health: "healthy" | "failing" | "waiting" | "manual";
};

type SourcesPayload = { total: number; sources: SourceItem[] };

export default function SourcesExplorer() {
  const [query, setQuery] = useState("");
  const [coverage, setCoverage] = useState("");
  const [region, setRegion] = useState("");
  const [state, setState] = useState("");
  const [payload, setPayload] = useState<SourcesPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams();
    if (query.trim()) parameters.set("q", query.trim());
    if (coverage) parameters.set("coverage", coverage);
    if (region) parameters.set("region", region);
    if (state) parameters.set("state", state);
    fetch(`/api/sources?${parameters}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`sources API returned ${response.status}`);
        return response.json() as Promise<SourcesPayload>;
      })
      .then((nextPayload) => { setPayload(nextPayload); setFailed(false); })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [query, coverage, region, state]);

  const summary = useMemo(() => {
    const sources = payload?.sources ?? [];
    return {
      active: sources.filter((item) => item.enabled).length,
      phd: sources.filter((item) => item.coverage === "phd").length,
      campus: sources.filter((item) => item.coverage === "campus").length,
      failing: sources.filter((item) => item.health === "failing").length,
    };
  }, [payload]);

  return <div>
    <div className={styles.filterBar}>
      <label><span>搜索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="机构、主题或来源代号" /></label>
      <label><span>类型</span><select value={coverage} onChange={(event) => setCoverage(event.target.value)}><option value="">全部</option><option value="phd">博士 / 科研</option><option value="campus">企业校招</option><option value="mixed">综合</option></select></label>
      <label><span>地区</span><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="">全部</option><option value="CN">中国大陆</option><option value="HK">中国香港</option><option value="UK">英国</option><option value="IE">爱尔兰</option></select></label>
      <label><span>状态</span><select value={state} onChange={(event) => setState(event.target.value)}><option value="">全部</option><option value="active">自动采集正常</option><option value="failing">自动采集失败</option><option value="manual">人工核对</option></select></label>
    </div>

    <div className={styles.statusGrid}>
      <article className={styles.statusCard}><span>当前结果</span><strong>{payload?.total ?? "—"}</strong><p>按当前筛选条件显示</p></article>
      <article className={styles.statusCard}><span>自动采集</span><strong>{summary.active}</strong><p>每日 Cron 检查</p></article>
      <article className={styles.statusCard}><span>博士 / 科研</span><strong>{summary.phd}</strong><p>高校、研究所及奖学金入口</p></article>
      <article className={styles.statusCard}><span>企业校招</span><strong>{summary.campus}</strong><p>英国、爱尔兰、中国大陆与香港</p></article>
    </div>

    {failed ? <p className={styles.loading}>信息源目录暂时不可用，请稍后刷新。</p> : !payload ? <p className={styles.loading}>正在读取 D1 信息源目录…</p> :
      <div className={styles.directoryGrid}>{payload.sources.map((source) => <article className={styles.sourceCard} key={source.id}>
        <div className={styles.sourceCardTop}><span className={`${styles.healthDot} ${styles[`health_${source.health}`]}`}>{healthLabel(source.health)}</span><span>{coverageLabel(source.coverage)}</span></div>
        <h3><a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></h3>
        <p>{source.description}</p>
        <div className={styles.chips}>{source.regions.map((item) => <span key={item}>{regionLabel(item)}</span>)}{source.topics.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div>
        <dl className={styles.sourceMeta}>
          <div><dt>最近检查</dt><dd>{formatDateTime(source.lastCheckedAt)}</dd></div>
          <div><dt>HTTP</dt><dd>{source.lastStatusCode ?? "—"}</dd></div>
          <div><dt>历史检查</dt><dd>{source.checkCount}</dd></div>
          <div><dt>证据快照</dt><dd>{source.snapshotCount}</dd></div>
        </dl>
        {source.extractionPilot ? <p className={styles.pilotNote}>P1 字段抽取试点</p> : null}
      </article>)}</div>}
    {payload && payload.sources.length === 0 ? <p className={styles.loading}>没有符合条件的信息源。</p> : null}
    {summary.failing > 0 ? <p className={styles.note}>当前筛选结果中有 {summary.failing} 个自动来源最近失败；失败只会留下日志，不会删除既有可信内容。</p> : null}
  </div>;
}

function coverageLabel(value: SourceItem["coverage"]): string {
  if (value === "phd") return "博士 / 科研";
  if (value === "campus") return "企业校招";
  return "综合";
}

function healthLabel(value: SourceItem["health"]): string {
  if (value === "healthy") return "自动正常";
  if (value === "failing") return "自动失败";
  if (value === "waiting") return "等待首次检查";
  return "人工核对";
}

function regionLabel(value: string): string {
  return ({ CN: "中国大陆", HK: "中国香港", UK: "英国", IE: "爱尔兰" } as Record<string, string>)[value] ?? value;
}

function formatDateTime(value: string | null): string {
  if (!value) return "尚未检查";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
