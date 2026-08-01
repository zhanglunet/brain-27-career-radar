import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import BeijingExplorer from "./BeijingExplorer";

export const metadata: Metadata = { title: "北京高校与科研机构｜BRAIN / 27", description: "北京脑科学、认知科学、脑机接口和类脑智能高校、全国重点实验室、中科院研究所与机会。" };
export default function BeijingPage() { return <main className={styles.page}><nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/map">全球地图</Link><Link href="/shanghai">上海</Link><Link href="/shenzhen">深圳</Link><Link href="/uk">英国</Link><Link href="/ireland">爱尔兰</Link><Link href="/hong-kong">中国香港</Link></div></nav><header className={styles.hero}><div><p className={styles.eyebrow}>BEIJING · RESEARCH ECOSYSTEM</p><h1>北京机会<br/><span>高校 × 国重 × 中科院</span></h1><p className={styles.lede}>围绕脑科学、认知神经科学、心理学、脑机接口和类脑智能，统一查看北京高校、全国/国家重点实验室、中科院研究所及其博士、科研助理、实习和研究岗位。</p></div><div className={styles.heroAside}><span>官方来源优先</span><strong>持续扩展</strong><p>当前清单是高相关首批覆盖，不把“北京所有机构”误写成已穷尽。</p></div></header><div className={styles.content}><BeijingExplorer/></div><footer className={styles.footer}><span>BRAIN / 27 · BEIJING</span><p>岗位状态和资格以机构官方页面为准。</p></footer></main>; }
