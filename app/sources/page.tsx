import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import SourcesExplorer from "./SourcesExplorer";

export const metadata: Metadata = {
  title: "信息源清单｜BRAIN / 27",
  description: "博士、科研机构与企业校招信息源的地区、主题、采集状态和历史证据清单。",
};

export default function SourcesPage() {
  return <main className={styles.page}>
    <DocsNav />
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>SOURCE DIRECTORY / LIVE D1</p><h1>信息源<span>清单</span></h1><p className={styles.lede}>集中查看系统当前维护的高校、科研机构、奖学金和企业校招官方入口。可以按类型、地区、状态和关键词检索；自动访问受限的官网仍保留为人工核对来源。</p></div>
      <aside className={styles.heroAside}><strong>4 REGIONS</strong><p>重点覆盖英国、爱尔兰、中国大陆与中国香港。来源清单不等于已发布机会；新发现内容仍需经过证据和风险规则。</p></aside>
    </header>
    <div className={styles.content}>
      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>全部官方来源</h2><p>“自动采集”表示每日 Cron 会访问该来源；“人工核对”通常表示官网阻止自动访问，不会被当作系统故障。</p></div>
        <SourcesExplorer />
      </section>
    </div>
    <footer className={styles.footer}><span>BRAIN / 27 · SOURCE DIRECTORY</span><p>申请与投递前请以机构官方页面为准。</p></footer>
  </main>;
}

function DocsNav() {
  return <nav className={styles.nav}><Link className={styles.brand} href="/"><span className={styles.brandMark}>Ψ</span> BRAIN / 27</Link><div className={styles.navLinks}><Link href="/">机会雷达</Link><Link className={styles.active} href="/sources">信息源</Link><Link href="/logs">采集日志</Link><Link href="/system">系统说明</Link><Link href="/prd">需求文档</Link></div></nav>;
}
