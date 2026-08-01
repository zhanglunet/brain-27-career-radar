import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import LogsExplorer from "./LogsExplorer";

export const metadata: Metadata = {
  title: "采集与发布日志｜BRAIN / 27",
  description: "按来源、日期、地区和结果检索机会雷达的历史 Cron、采集、抽取、决策与发布日志。",
};

export default function LogsPage() {
  return <main className={styles.page}>
    <DocsNav />
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>COLLECTION LOG / AUDIT TRAIL</p><h1>采集与<span>发布日志</span></h1><p className={styles.lede}>查看每次 Cron 和逐来源结果，追踪候选、证据与发布数量；同时区分页面稳定性自动观察和必须人工判断的语义审核。</p></div>
      <aside className={styles.heroAside}><strong>UTC AUDIT</strong><p>数据库统一使用 UTC 留痕，页面按日本时间显示。日志只保存有限错误摘要，不公开响应正文或凭据。</p></aside>
    </header>
    <div className={styles.content}>
      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>历史检索</h2><p>旧版本的 `sync_runs` 继续展示；逐来源日志从本功能上线后开始记录，不伪造历史明细。</p></div>
        <LogsExplorer />
      </section>
    </div>
    <footer className={styles.footer}><span>BRAIN / 27 · AUDIT LOG</span><p>实际申请与投递状态仍以官方来源为准。</p></footer>
  </main>;
}

function DocsNav() {
  return <nav className={styles.nav}><Link className={styles.brand} href="/"><span className={styles.brandMark}>Ψ</span> BRAIN / 27</Link><div className={styles.navLinks}><Link href="/">机会雷达</Link><Link href="/reports">情报报告</Link><Link href="/sources">信息源</Link><Link className={styles.active} href="/logs">采集日志</Link><Link href="/system">系统说明</Link><Link href="/prd">需求文档</Link></div></nav>;
}
