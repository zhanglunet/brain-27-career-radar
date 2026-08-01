import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import PapersExplorer from "./PapersExplorer";

export const metadata: Metadata = { title: "中英双语论文｜BRAIN / 27", description: "自动发现重点导师近期论文，展示中英文标题、摘要与核验状态。" };
export default function PapersPage() { return <main className={styles.page}><nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/researchers">导师雷达</Link><Link href="/knowledge-graph">知识图谱</Link><Link href="/calendar">时间表</Link><Link href="/beijing">北京机构</Link><Link href="/paper-sources">论文数据库</Link></div></nav><header className={styles.hero}><div><p className={styles.eyebrow}>P2.3 · BILINGUAL PAPER INTELLIGENCE</p><h1>最新论文<br /><span>中英双语理解</span></h1><p className={styles.lead}>Cron 从 Crossref、Europe PMC、arXiv、PubMed、PMC 与 DOAJ 发现重点导师近 18 个月成果，按持久标识符去重。英文标题和摘要保留原文，中文译文自动补齐并明确标注机器翻译边界。</p></div><div className={styles.heroMeta}><span>自动更新</span><strong>每 6 小时触发</strong><p>论文采集后自动进入翻译队列</p></div></header><div className={styles.content}><PapersExplorer /></div><footer className={styles.footer}><span>BRAIN / 27 · P2.3</span><p>聚合数据库用于发现；引用和结论以出版方英文原文为准。</p></footer></main>; }
