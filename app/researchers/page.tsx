import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import ResearchersExplorer from "./ResearchersExplorer";

export const metadata: Metadata = { title: "导师雷达｜BRAIN / 27", description: "跟踪全球重点脑科学、认知科学、脑机接口与 NeuroAI 导师。" };

export default function ResearchersPage() {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/papers">双语论文</Link><Link href="/knowledge-graph">知识图谱</Link><Link href="/calendar">时间表</Link><Link href="/beijing">北京机构</Link><Link href="/paper-sources">论文数据库</Link></div></nav>
    <header className={styles.hero}><div><p className={styles.eyebrow}>P2.3 · RESEARCHER INTELLIGENCE</p><h1>导师雷达<br /><span>跟踪人，而不只跟踪岗位</span></h1><p className={styles.lead}>覆盖牛津、剑桥、UCL、清华、北大、北京中科院研究所、香港及全球代表团队。每位导师关联官方主页、研究主题、方法和近期论文候选。</p></div><div className={styles.heroMeta}><span>扩展范围</span><strong>全球 + 北京重点</strong><p>英国 / 中国内地 / 中国香港 / 美国</p></div></header>
    <div className={styles.content}><ResearchersExplorer /></div>
    <footer className={styles.footer}><span>BRAIN / 27 · P2.3</span><p>导师清单是可解释的跟踪池，不是学术排名。</p></footer>
  </main>;
}
