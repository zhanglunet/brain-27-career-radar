import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import ResearchersExplorer from "./ResearchersExplorer";

export const metadata: Metadata = { title: "导师雷达｜BRAIN / 27", description: "跟踪全球重点脑科学、认知科学、脑机接口与 NeuroAI 导师。" };

export default function ResearchersPage() {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/papers">最新论文</Link><Link href="/paper-sources">论文数据库</Link><Link href="/sources">信息源</Link><Link href="/logs">日志</Link><Link href="/prd/academic">P2 PRD</Link></div></nav>
    <header className={styles.hero}><div><p className={styles.eyebrow}>P2.1 · RESEARCHER INTELLIGENCE</p><h1>导师雷达<br /><span>跟踪人，而不只跟踪岗位</span></h1><p className={styles.lead}>首批覆盖牛津、剑桥、UCL、清华、复旦、中国科学院、香港及全球代表团队。每位导师关联官方主页、研究主题、方法和近期论文候选。</p></div><div className={styles.heroMeta}><span>首批范围</span><strong>16 位重点导师</strong><p>英国 / 中国内地 / 中国香港 / 美国</p></div></header>
    <div className={styles.content}><ResearchersExplorer /></div>
    <footer className={styles.footer}><span>BRAIN / 27 · P2.1</span><p>导师清单是可解释的跟踪池，不是学术排名。</p></footer>
  </main>;
}
