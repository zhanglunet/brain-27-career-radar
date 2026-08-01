"use client";

import { useEffect, useState } from "react";
import styles from "../documentation.module.css";

type Run = { id: string; trigger: string; status: string; started_at: string; finished_at: string | null; checked_count: number; changed_count: number; failed_count: number };
type Check = { id: string; sourceName: string; coverage: string; regions: string[]; checkedAt: string; outcome: string; statusCode: number | null; errorSummary: string | null; candidatesCount: number; evidenceCount: number; changeSetsCount: number; appliedCount: number; trigger: string };
type Review = { id: string; sourceName: string; reason: string; status: string; reviewMode: "automatic" | "human"; resolutionNote: string | null; createdAt: string; resolvedAt: string | null };
type LogsPayload = { page: number; pageSize: number; total: number; summary: { succeeded: number; failed: number; changed: number; candidates: number; evidence: number; decisions: number; published: number }; runs: Run[]; reviews: Review[]; checks: Check[] };

export default function LogsExplorer() {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("");
  const [trigger, setTrigger] = useState("");
  const [coverage, setCoverage] = useState("");
  const [region, setRegion] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<LogsPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (query.trim()) parameters.set("q", query.trim());
    if (outcome) parameters.set("outcome", outcome);
    if (trigger) parameters.set("trigger", trigger);
    if (coverage) parameters.set("coverage", coverage);
    if (region) parameters.set("region", region);
    if (date) parameters.set("date", date);
    fetch(`/api/logs?${parameters}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`logs API returned ${response.status}`);
        return response.json() as Promise<LogsPayload>;
      })
      .then((nextPayload) => { setPayload(nextPayload); setFailed(false); })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [query, outcome, trigger, coverage, region, date, page]);

  const pages = payload ? Math.max(1, Math.ceil(payload.total / payload.pageSize)) : 1;
  return <div>
    <div className={styles.filterBar}>
      <label><span>搜索来源</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="机构或来源代号" /></label>
      <label><span>结果</span><select value={outcome} onChange={(event) => { setOutcome(event.target.value); setPage(1); }}><option value="">全部</option><option value="unchanged">成功 / 未变化</option><option value="not_modified">304 未修改</option><option value="changed">发现变化</option><option value="failed">失败</option></select></label>
      <label><span>触发方式</span><select value={trigger} onChange={(event) => { setTrigger(event.target.value); setPage(1); }}><option value="">全部</option><option value="cron">自动 Cron</option><option value="manual">人工</option><option value="test">测试</option></select></label>
      <label><span>类型</span><select value={coverage} onChange={(event) => { setCoverage(event.target.value); setPage(1); }}><option value="">全部</option><option value="phd">博士 / 科研</option><option value="campus">企业校招</option></select></label>
      <label><span>地区</span><select value={region} onChange={(event) => { setRegion(event.target.value); setPage(1); }}><option value="">全部</option><option value="CN">中国大陆</option><option value="HK">中国香港</option><option value="UK">英国</option><option value="IE">爱尔兰</option></select></label>
      <label><span>UTC 日期</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} /></label>
    </div>

    <div className={styles.statusGrid}>
      <article className={styles.statusCard}><span>日志条数</span><strong>{payload?.total ?? "—"}</strong><p>符合当前检索条件</p></article>
      <article className={styles.statusCard}><span>成功 / 失败</span><strong>{payload ? `${payload.summary.succeeded}/${payload.summary.failed}` : "—"}</strong><p>逐来源检查结果</p></article>
      <article className={styles.statusCard}><span>候选 / 证据</span><strong>{payload ? `${payload.summary.candidates}/${payload.summary.evidence}` : "—"}</strong><p>P1 结构化采集</p></article>
      <article className={styles.statusCard}><span>实际发布</span><strong>{payload?.summary.published ?? "—"}</strong><p>自动合并仍默认关闭</p></article>
    </div>

    {payload && payload.runs.length > 0 ? <div className={styles.logSection}><h3>历史运行</h3><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>时间</th><th>触发</th><th>状态</th><th>检查</th><th>变化</th><th>失败</th></tr></thead><tbody>{payload.runs.map((run) => <tr key={run.id}><td>{formatDateTime(run.finished_at ?? run.started_at)}</td><td>{run.trigger}</td><td>{run.status}</td><td>{run.checked_count}</td><td>{run.changed_count}</td><td>{run.failed_count}</td></tr>)}</tbody></table></div></div> : null}

    {payload && payload.reviews.length > 0 ? <div className={styles.logSection}><h3>审核与自动观察</h3><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>创建时间</th><th>来源</th><th>原因</th><th>处理方式</th><th>状态 / 结论</th></tr></thead><tbody>{payload.reviews.map((review) => <tr key={review.id}><td>{formatDateTime(review.createdAt)}</td><td>{review.sourceName}</td><td>{reviewReasonLabel(review.reason)}</td><td>{review.reviewMode === "automatic" ? "自动审查" : "人工审核"}</td><td><span className={review.status === "pending" ? styles.pending : styles.good}>{reviewStatusLabel(review.status)}</span>{review.resolutionNote ? <><br /><small>{review.resolutionNote}</small></> : null}</td></tr>)}</tbody></table></div></div> : null}

    <div className={styles.logSection}><h3>逐来源采集日志</h3>
      {failed ? <p className={styles.loading}>采集日志暂时不可用，请稍后刷新。</p> : !payload ? <p className={styles.loading}>正在读取 D1 历史日志…</p> : payload.checks.length === 0 ? <p className={styles.loading}>尚无符合条件的逐来源日志。新日志从该功能上线后的首次 Cron 开始记录；上方仍保留旧的运行摘要。</p> :
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>检查时间</th><th>来源</th><th>地区</th><th>结果</th><th>HTTP</th><th>候选 / 证据 / 决策 / 发布</th></tr></thead><tbody>{payload.checks.map((check) => <tr key={check.id}><td>{formatDateTime(check.checkedAt)}</td><td>{check.sourceName}<br /><small>{check.trigger} · {check.coverage === "phd" ? "博士/科研" : "企业校招"}</small></td><td>{check.regions.map(regionLabel).join(" / ")}</td><td><span className={check.outcome === "failed" ? styles.pending : styles.good}>{outcomeLabel(check.outcome)}</span>{check.errorSummary ? <><br /><small>{check.errorSummary}</small></> : null}</td><td>{check.statusCode ?? "—"}</td><td>{check.candidatesCount} / {check.evidenceCount} / {check.changeSetsCount} / {check.appliedCount}</td></tr>)}</tbody></table></div>}
      {payload && payload.total > payload.pageSize ? <div className={styles.pagination}><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button></div> : null}
    </div>
  </div>;
}

function formatDateTime(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(normalized));
}

function regionLabel(value: string): string {
  return ({ CN: "中国大陆", HK: "中国香港", UK: "英国", IE: "爱尔兰" } as Record<string, string>)[value] ?? value;
}

function outcomeLabel(value: string): string {
  return ({ unchanged: "成功 / 未变化", not_modified: "304 未修改", changed: "发现变化", failed: "失败" } as Record<string, string>)[value] ?? value;
}

function reviewReasonLabel(value: string): string {
  return ({ content_changed: "页面内容变化", repeated_failure: "连续失败", new_source: "新机会候选", parse_conflict: "字段冲突" } as Record<string, string>)[value] ?? value;
}

function reviewStatusLabel(value: string): string {
  return ({ pending: "等待人工审核", observing: "自动观察中", approved: "已自动/人工确认", rejected: "已驳回或被新变化取代" } as Record<string, string>)[value] ?? value;
}
