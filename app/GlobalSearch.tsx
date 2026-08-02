"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Item = { id: string; type: string; title: string; subtitle: string; description: string; url: string; meta: string | null };
type Group = { type: string; label: string; items: Item[] };

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") setOpen(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "/" && !target?.matches("input,textarea,select,[contenteditable=true]")) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("搜索暂不可用");
          return response.json() as Promise<{ groups: Group[] }>;
        })
        .then((data) => setGroups(data.groups ?? []))
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

  return <>
    <button className="global-search-trigger" type="button" onClick={() => setOpen(true)} aria-label="打开全局搜索"><span>⌕</span><b>全局搜索</b><kbd>⌘ K</kbd></button>
    {open && <div className="global-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="全局搜索">
        <header><span>⌕</span><input ref={input} value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索机会、机构、导师、论文、信息源…" aria-label="搜索关键词"/><button onClick={() => setOpen(false)} aria-label="关闭搜索">ESC</button></header>
        <div className="global-search-body">
          {q.trim().length < 2 && <div className="global-search-hint"><b>输入至少两个字开始搜索</b><p>支持机会、机构、导师、论文、信息源和历史情报报告。</p><div><Link href="/opportunities" onClick={() => setOpen(false)}>查看全部机会</Link><Link href="/discovery" onClick={() => setOpen(false)}>查看持续发现</Link></div></div>}
          {loading && q.trim().length >= 2 && <p className="global-search-state">正在搜索…</p>}
          {error && <p className="global-search-state global-search-error">{error}</p>}
          {!loading && !error && q.trim().length >= 2 && !groups.length && <p className="global-search-state">没有找到匹配内容。</p>}
          {q.trim().length >= 2 && groups.map((group) => <div className="global-search-group" key={group.type}><h2>{group.label}<small>{group.items.length}</small></h2>{group.items.map((item) => <a href={item.url} key={`${item.type}-${item.id}`} onClick={() => setOpen(false)} target={item.url.startsWith("http") ? "_blank" : undefined} rel={item.url.startsWith("http") ? "noreferrer" : undefined}><span className={`search-type search-type-${item.type}`}>{label(item.type)}</span><div><b>{item.title}</b><small>{item.subtitle}</small><p>{item.description}</p></div><em>↗</em></a>)}</div>)}
        </div>
        {q.trim().length >= 2 && <footer><Link href={`/search?q=${encodeURIComponent(q)}`} onClick={() => setOpen(false)}>打开完整搜索结果 →</Link><span>ESC 关闭</span></footer>}
      </section>
    </div>}
  </>;
}

function label(type: string) {
  return ({ opportunity: "机会", institution: "机构", researcher: "导师", paper: "论文", source: "来源", report: "报告" } as Record<string, string>)[type] ?? type;
}
