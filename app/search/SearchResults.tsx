"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../documentation.module.css";

type Item = { id: string; type: string; title: string; subtitle: string; description: string; url: string; meta: string | null };
type Payload = { query: string; total: number; results: Item[] };

export default function SearchResults({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [data, setData] = useState<Payload | null>(null);
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (q.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("全局搜索暂不可用");
          return response.json() as Promise<Payload>;
        })
        .then(setData)
        .catch((reason: Error) => {
          if (reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const items = useMemo(() => data?.results.filter((item) => !type || item.type === type) ?? [], [data, type]);
  const validQuery = q.trim().length >= 2;

  return <section className={styles.section}>
    <div className={styles.searchPageBar}><span>⌕</span><input autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索机会、导师、论文、政策、项目、机构…"/></div>
    <div className={styles.graphFilters}>{[["", "全部"], ["opportunity", "机会"], ["institution", "机构"], ["researcher", "导师"], ["paper", "论文"], ["policy", "政策"], ["project", "项目"], ["topic", "议题"], ["source", "信息源"], ["report", "报告"]].map(([value, text]) => <button key={value} className={type === value ? styles.graphFilterActive : ""} onClick={() => setType(value)}>{text}</button>)}</div>
    {loading && validQuery && <p className={styles.loading}>正在搜索全部数据…</p>}
    {error && validQuery && <p className={`${styles.state} ${styles.stateError}`}>{error}</p>}
    {!validQuery && <p className={styles.note}>输入至少两个字。全局搜索只展示已公开、已核验的机会、机构、导师、论文、科研政策、项目、议题、信息源和报告。</p>}
    {!loading && validQuery && data && <><p className={styles.note}>“{data.query}”共找到 {data.total} 条，当前显示 {items.length} 条。</p><div className={styles.searchResultList}>{items.map((item) => <a key={`${item.type}-${item.id}`} href={item.url} target={item.url.startsWith("http") ? "_blank" : undefined} rel={item.url.startsWith("http") ? "noreferrer" : undefined}><span>{label(item.type)}</span><div><h3>{item.title}</h3><small>{item.subtitle}</small><p>{item.description}</p></div><b>↗</b></a>)}</div>{!items.length && <p className={styles.emptyState}>当前分类没有匹配结果。</p>}</>}
  </section>;
}

function label(type: string) {
  return ({ opportunity: "机会", institution: "机构", researcher: "导师", paper: "论文", policy:"政策",project:"项目",topic:"议题", source: "来源", report: "报告" } as Record<string, string>)[type] ?? type;
}
