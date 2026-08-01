import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import PapersExplorer from "./PapersExplorer";

export const metadata: Metadata = { title: "最新论文｜BRAIN / 27", description: "自动发现重点导师近期论文并透明展示核验状态。" };
export default function PapersPage() { return <main className={styles.page}><nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/researchers">导师雷达</Link><Link href="/paper-sources">论文数据库</Link><Link href="/sources">信息源</Link><Link href="/logs">日志</Link><Link href="/prd/academic">P2 PRD</Link></div></nav><header className={styles.hero}><div><p className={styles.eyebrow}>P2.2 · PAPER INTELLIGENCE</p><h1>最新论文<br /><span>发现、去重、核验</span></h1><p className={styles.lead}>Cron 从 Crossref 与 Europe PMC 发现重点导师近 18 个月成果，按 DOI / PMID 去重，并用作者与神经/认知主题双重匹配。候选与已核验内容严格区分。</p></div><div className={styles.heroMeta}><span>自动更新</span><strong>每 6 小时触发</strong><p>候选默认不作为确定事实发布</p></div></header><div className={styles.content}><PapersExplorer /></div><footer className={styles.footer}><span>BRAIN / 27 · P2.2</span><p>聚合数据库用于发现；最终以 DOI、PMID 与出版方页面为准。</p></footer></main>; }
