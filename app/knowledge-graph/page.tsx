import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import KnowledgeGraphExplorer from "./KnowledgeGraphExplorer";

export const metadata: Metadata = { title: "知识图谱｜BRAIN / 27", description: "连接论文、导师、研究方向、机构与机会的学术知识图谱。" };
export default function KnowledgeGraphPage() { return <main className={styles.page}><nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/map">全球地图</Link><Link href="/papers">双语论文</Link><Link href="/researchers">导师雷达</Link><Link href="/calendar">时间表</Link><Link href="/beijing">区域页面</Link><Link href="/sources">信息源</Link></div></nav><header className={styles.hero}><div><p className={styles.eyebrow}>P2.3 · ACADEMIC KNOWLEDGE GRAPH</p><h1>看见关系<br/><span>而不只是清单</span></h1><p className={styles.lede}>把论文、导师、研究方向、机构和机会连接成一张持续更新的关系网络。图谱只表达数据库中已有且可追溯的关系，不用视觉距离暗示未经验证的因果或学术评价。</p></div><div className={styles.heroAside}><span>空间视图已接入</span><strong>关系 × 全球地图</strong><p>从知识关系切换到英国、中国内地和中国香港的机会空间分布。</p></div></header><div className={styles.content}><KnowledgeGraphExplorer/></div><footer className={styles.footer}><span>BRAIN / 27 · P2.3</span><p>关系可追溯到论文数据库与机构官方来源。</p></footer></main>; }
