import type { Metadata } from "next";
import Link from "next/link";
import styles from "../../documentation.module.css";

export const metadata: Metadata = { title: "P2.3 知识图谱与日历 PRD｜BRAIN / 27", description: "双语论文、知识图谱、北京科研生态和统一截止日期日历需求。" };

export default function KnowledgeGraphPrd() {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link href="/" className={styles.brand}>BRAIN / 27</Link><div className={styles.navLinks}><Link href="/papers">双语论文</Link><Link href="/knowledge-graph">知识图谱</Link><Link href="/calendar">时间表</Link><Link href="/beijing">北京机会</Link></div></nav>
    <header className={styles.hero}><div><p className={styles.eyebrow}>PRODUCT REQUIREMENTS · P2.3</p><h1>学术情报网络<br/><span>关系与时间同时可见</span></h1><p className={styles.lead}>连接论文、导师、研究方向、机构和机会，并把官方截止日、预计日期、滚动申请与准备动作放在一个日历中。</p></div><div className={styles.heroMeta}><span>PRD VERSION</span><strong>0.6.0</strong><p>2026-08-01 · 开发完成，待生产验收</p></div></header>
    <div className={styles.content}>
      <section className={styles.section}><div className={styles.sectionHead}><h2>本期交付</h2><p>四个页面共享 D1 事实数据，并为桌面和手机提供相同的关键信息。</p></div><div className={`${styles.cardGrid} ${styles.requirements}`}><article className={`${styles.card} ${styles.cardDone}`}><p>01</p><h3>双语论文</h3><p>英文原文、中文译文、摘要和翻译状态。</p></article><article className={`${styles.card} ${styles.cardDone}`}><p>02</p><h3>知识图谱</h3><p>五类节点与有证据的事实关系。</p></article><article className={`${styles.card} ${styles.cardDone}`}><p>03</p><h3>北京科研生态</h3><p>高校、国重、中科院及博士/RA/实习机会。</p></article><article className={`${styles.card} ${styles.cardDone}`}><p>04</p><h3>统一日历</h3><p>开放日、截止日与提前准备任务。</p></article></div></section>
      <section className={styles.section}><div className={styles.sectionHead}><h2>截止日期治理</h2><p>不把推测写成官方事实，也不给滚动和未知机会编造具体日期。</p></div><div className={styles.requirements}><article className={styles.requirement}><h3>官方确认</h3><p>保存具体日期、时间、时区和官方链接。</p></article><article className={styles.requirement}><h3>预计日期</h3><p>用于提前规划，页面持续标注“预计”，自然更新后替换。</p></article><article className={styles.requirement}><h3>滚动申请</h3><p>持续开放，建议尽早联系或投递，不显示虚假截止日。</p></article><article className={styles.requirement}><h3>待确认</h3><p>进入持续监控列表，官方发布前只显示准备动作。</p></article></div></section>
      <section className={styles.section}><div className={styles.sectionHead}><h2>当前最近日期</h2><p>详细时间、时区和后续全部日程以在线时间表为准。</p></div><ul className={styles.checklist}><li><span>08/09</span><div><strong>香港大学心理学岗位</strong><br/><small>官方确认 · Asia/Hong_Kong</small></div><span className={styles.tag}>最近</span></li><li><span>08/31</span><div><strong>香港大学心理肿瘤学岗位</strong><br/><small>官方确认 · Asia/Hong_Kong</small></div><span className={styles.tag}>确认</span></li><li><span>09/14</span><div><strong>Oxford OCEMR DPhil</strong><br/><small>12:00 · Europe/London · 官方确认</small></div><span className={styles.tag}>确认</span></li></ul></section>
    </div><footer className={styles.footer}><span>BRAIN / 27 · P2.3 PRD</span><p>所有申请日期最终以官方页面为准。</p></footer>
  </main>;
}
