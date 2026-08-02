import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryExplorer from "./DiscoveryExplorer";
import styles from "../documentation.module.css";

export const metadata:Metadata={title:"持续发现｜BRAIN / 27",description:"持续发现新的校招机会、公司和研究机构，并保留去重、证据与核验状态。"};
export default function DiscoveryPage(){return <main className={styles.page}><nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/campus-2027">2027 校招</Link><Link href="/discovery" className={styles.active}>持续发现</Link><Link href="/logs">运行日志</Link><Link href="/sources">信息源</Link><Link href="/reports">情报报告</Link><Link href="/prd">需求文档</Link></div></nav><header className={styles.hero}><div><p className={styles.eyebrow}>CONTINUOUS DISCOVERY · EVIDENCE FIRST</p><h1>发现新的<br/><span>公司、机构与机会</span></h1><p className={styles.lede}>不只盯固定清单：从已登记招聘入口发现新岗位，从可信官方目录发现新的公司和研究机构，再经过证据留存、去重与核验进入雷达。</p></div><div className={styles.heroAside}><span>自动运行</span><strong>每 6 小时</strong><p>招聘源按优先级到期检查；机构目录每 24–72 小时检查。候选核验后才公开发布。</p></div></header><div className={styles.content}><DiscoveryExplorer/></div><footer className={styles.footer}><span>BRAIN / 27 · CONTINUOUS DISCOVERY</span><p>候选页面用于追踪发现过程；申请前请以机构官方岗位页为准。</p></footer></main>}
