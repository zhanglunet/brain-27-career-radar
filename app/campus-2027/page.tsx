import type { Metadata } from "next";
import Link from "next/link";
import Campus2027Explorer from "./Campus2027Explorer";
import styles from "../documentation.module.css";

export const metadata: Metadata = {
  title: "2027 校招与研究岗位｜BRAIN / 27",
  description: "汇总国内外大厂、大模型厂商及中国和英国研究机构面向 2027 届的校招、实习和研究岗位。",
};

export default function Campus2027Page() {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/ai-companies">大模型公司</Link><Link href="/discovery">持续发现</Link><Link href="/map">全球地图</Link><Link href="/calendar">时间表</Link><Link href="/reports">情报报告</Link><Link href="/sources">信息源</Link><Link href="/prd">需求文档</Link></div></nav>
<header className={styles.hero}><div><p className={styles.eyebrow}>CLASS OF 2027 · CHINA · UK · HONG KONG</p><h1>2027 校招<br/><span>从现在开始投</span></h1><p className={styles.lede}>集中查看北京、上海优先的国内大厂、研究机构和大模型团队，同时重点跟踪 DeepSeek、Kimi、智谱、智源与中科院机会；并覆盖英国顶级高校实验室、课题组、学院和导师岗位、英国企业 Graduate / Intern，以及香港企业与高校校招。</p></div><div className={styles.heroAside}><span>专项跟踪</span><strong>五条重点线 · 官方入口优先</strong><p>国内校招、大模型公司与中科院、英国顶级高校、英国企业、香港企业与高校；已开放批次、持续招聘入口和等待开放项目分开显示。</p></div></header>
    <div className={styles.content}><Campus2027Explorer /></div>
    <footer className={styles.footer}><span>BRAIN / 27 · CLASS OF 2027</span><p>岗位会变化；投递前以机构官方页面的毕业时间、地点、签证和截止日期为准。</p></footer>
  </main>;
}
