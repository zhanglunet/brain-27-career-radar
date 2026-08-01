import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";
import SystemStatus from "./SystemStatus";

export const metadata: Metadata = {
  title: "系统运行说明｜BRAIN / 27",
  description: "BRAIN / 27 的实时运行状态、自动更新机制、D1 数据流和维护说明。",
};

export default function SystemPage() {
  return <main className={styles.page}>
    <DocsNav active="system" />
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>SYSTEM / OPERATIONS</p><h1>系统如何<span>自动运行</span></h1><p className={styles.lede}>这不是一个直接让模型改网页的黑盒。系统每天检查已登记的官方来源，保留证据与运行记录；高风险内容变化先进入审核，页面始终保留最后一次可信数据。</p></div>
      <aside className={styles.heroAside}><strong>P1 PILOT</strong><p>P0 已稳定运行；P1 已对 5 个来源启用结构化抽取、同站候选发现、证据链、字段差异和风险路由，当前处于 7 天灰度观察。</p></aside>
    </header>

    <div className={styles.content}>
      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>实时运行状态</h2><p>数据来自生产 D1，只公开聚合状态，不公开数据库标识、日志正文或凭据；运维状态不使用边缘缓存。</p></div>
        <SystemStatus />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>一次更新如何发生</h2><p>Cron 使用 UTC。当前计划为每天 01:00 UTC，即日本时间 10:00；Cloudflare 按至少一次语义投递，因此写入采用可追溯记录和去重约束。</p></div>
        <div className={styles.flow}>
          <div className={styles.flowStep}><b>01 / TRIGGER</b><h3>定时触发</h3><p>Cloudflare Cron 调用 Worker 的 scheduled 处理器。</p></div>
          <div className={styles.flowStep}><b>02 / FETCH</b><h3>检查来源</h3><p>四路并发、12 秒超时、512 KiB 上限，并使用 ETag 与 Last-Modified。</p></div>
          <div className={styles.flowStep}><b>03 / EXTRACT</b><h3>抽取候选</h3><p>5 个试点适配器解析 JSON-LD、页面标题和同站链接，并规范化 URL。</p></div>
          <div className={styles.flowStep}><b>04 / AUDIT</b><h3>比较并留证</h3><p>D1 保存候选、字段证据与变更集；日期、开放状态等高风险变化只进入审核。</p></div>
          <div className={styles.flowStep}><b>05 / SERVE</b><h3>页面展示</h3><p>API 返回已发布机会；D1 异常时浏览器退回静态可信快照。</p></div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>自动化边界</h2><p>P1 已能把部分来源变化转成结构化候选，但不会未经审核自动改写截止日期、开放状态或职业建议。</p></div>
        <div className={styles.cardGrid}>
          <article className={`${styles.card} ${styles.cardDone}`}><span className={styles.cardLabel}>已自动化</span><h3>来源健康与变更监控</h3><p>每日访问 15 个登记来源，记录状态码、重定向、响应标识、内容哈希、验证时间和连续失败。</p></article>
          <article className={`${styles.card} ${styles.cardDone}`}><span className={styles.cardLabel}>P1 灰度中</span><h3>候选发现与字段抽取</h3><p>5 个来源已启用适配器，抽取标题、机构、类别、地点、截止日期、状态与证据，并生成字段级变更集。</p></article>
          <article className={`${styles.card} ${styles.cardNext}`}><span className={styles.cardLabel}>P2 · 待开发</span><h3>外部新来源与审核后台</h3><p>跨域候选来源批准、人工编辑、通知和模型辅助建议尚未上线；同站候选也不会直接公开。</p></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>你还需要做什么</h2><p>当前生产运行没有阻塞性配置；以下是运行确认与后续产品选择。</p></div>
        <ul className={styles.checklist}>
          <li><span>01</span><div><strong>等待首个生产 Cron 留痕</strong><br /><small>日本时间 10:00 后刷新本页，确认出现最近一次巡检及 15 个来源的检查结果。</small></div><span className={`${styles.tag} ${styles.tagPending}`}>需观察</span></li>
          <li><span>02</span><div><strong>处理待审核变化</strong><br /><small>P2 可视化后台尚未开发；灰度期通过 Cloudflare D1 控制台查看 review_queue 和 change_sets。高风险语义变更不会自动发布。</small></div><span className={styles.tag}>运维动作</span></li>
          <li><span>03</span><div><strong>完成 P1 七天观察</strong><br /><small>核对 5 个试点来源的抽取准确率、重复率与误报；达到门槛后再扩展到其余 10 个来源。</small></div><span className={`${styles.tag} ${styles.tagPending}`}>观察中</span></li>
          <li><span>04</span><div><strong>自定义域名已配置</strong><br /><small>生产入口使用 radar.openagent.hk；workers.dev 地址保留为故障诊断和备用入口。</small></div><span className={styles.tag}>已完成</span></li>
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>故障时会怎样</h2><p>系统设计目标是“监控失败不等于内容消失”。</p></div>
        <div className={styles.requirements}>
          <article className={styles.requirement}><h3>单个来源超时</h3><p>只增加该来源失败次数；本次批次标记为 partial，其他来源继续执行，已发布内容继续展示。</p></article>
          <article className={styles.requirement}><h3>连续三次失败</h3><p>创建 repeated_failure 审核项，保留错误摘要，等待维护者检查来源失效、反爬或地址变更。</p></article>
          <article className={styles.requirement}><h3>页面内容变化</h3><p>保存新快照并创建 content_changed 审核项；不会仅凭模板变化直接重写重要业务字段。</p></article>
          <article className={styles.requirement}><h3>D1 或 API 不可用</h3><p>主页使用构建时静态种子继续渲染，并显示 STATIC，避免用户看到空白雷达。</p></article>
        </div>
      </section>
    </div>
    <DocsFooter />
  </main>;
}

function DocsNav({ active }: { active: "system" | "prd" }) {
  return <nav className={styles.nav}><Link className={styles.brand} href="/"><span className={styles.brandMark}>Ψ</span> BRAIN / 27</Link><div className={styles.navLinks}><Link href="/">机会雷达</Link><Link className={active === "system" ? styles.active : undefined} href="/system">系统说明</Link><Link className={active === "prd" ? styles.active : undefined} href="/prd">需求文档</Link></div></nav>;
}

function DocsFooter() {
  return <footer className={styles.footer}><span>BRAIN / 27 · 系统运行说明</span><p>信息投递前仍请以机构官方页面为准。</p></footer>;
}
