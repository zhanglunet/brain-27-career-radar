import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";

export const metadata: Metadata = {
  title: "关于｜BRAIN / 27",
  description: "BRAIN / 27 的定位与愿景：为 2027 实验心理学硕士打造的可审计、可追踪的机会情报系统。",
};

export default function AboutPage() {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link className={styles.brand} href="/"><span className={styles.brandMark}>Ψ</span> BRAIN / 27</Link><div className={styles.navLinks}><Link href="/">机会雷达</Link><Link href="/campus-2027">2027 校招</Link><Link href="/discovery">持续发现</Link><Link href="/reports">情报报告</Link><Link href="/ai-companies">大模型公司</Link><Link href="/researchers">导师雷达</Link><Link href="/papers">最新论文</Link><Link href="/sources">信息源</Link><Link href="/logs">采集日志</Link><Link href="/system">系统说明</Link><Link className={styles.active} href="/about">关于</Link></div></nav>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>ABOUT / 定位与愿景</p><h1>关于 <span>BRAIN / 27</span></h1><p className={styles.lede}>BRAIN / 27 不是招聘网站，而是一套为一个人打造的机会情报系统：面向 2027 年毕业的实验心理学硕士，持续跟踪脑科学、认知神经科学、脑机接口与脑启发 AI 方向的博士、奖学金、科研助理和校招机会。</p></div>
      <aside className={styles.heroAside}><strong>116 / 63 / 21</strong><p>116 个官方信息源 · 63 个公开机会 · 21 位重点导师，全部可审计、可追溯。</p></aside>
    </header>

    <div className={styles.content}>
      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>定位</h2><p>高度垂直的机会情报系统，为一个具体的人的职业决策服务，而不是堆信息量。</p></div>
        <div className={styles.requirements}>
          <article className={styles.requirement}><h3>为谁服务</h3><p>目标用户是 2027 年毕业、希望从实验心理学进入脑科学、脑机接口或 AI 交叉方向的硕士生。机会雷达、统一日历、导师雷达、情报日报，所有功能都围绕这一个人的申请季展开。</p></article>
          <article className={styles.requirement}><h3>不是什么</h3><p>不是招聘链接集合。每条机会都有来源快照、采集日志、字段证据和审核结论；人工确认才入库，机器不擅自发布职业判断。自动发布内容的功能默认关闭。</p></article>
          <article className={styles.requirement}><h3>覆盖面</h3><p>116 个官方信息源：英国（牛津、剑桥、UCL 等）、中国大陆（清华、北大，北京、上海、深圳高校与机构）、中国香港高校、爱尔兰高校与机构，以及 18 家大模型公司雷达。</p></article>
          <article className={styles.requirement}><h3>核心原则</h3><p>官方来源优先、监控与发布分离、失败不删除、全程留痕、所有重要变化可追溯。受访问限制的来源会明确标记为人工核对，而不是悄悄消失。</p></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>愿景</h2><p>把职业信息焦虑，变成一套可审计、可追踪、可行动的情报系统。</p></div>
        <ul className={styles.checklist}>
          <li><span>01</span><div>机器做 24 小时盯梢：116 个来源定时检查，新增、变化、失效自动发现，证据留档。</div><span className={styles.tag}>自动</span></li>
          <li><span>02</span><div>机器做整理：新机会自动归类、跨来源去重、关联历史情报，情报库从“仓库”变成“助手”。</div><span className={styles.tag}>智能</span></li>
          <li><span>03</span><div>人只做判断：入库永远要人工确认。闸门只决定“人工看多细”，不决定“是否入库”。</div><span className={styles.tag}>可信</span></li>
          <li><span>04</span><div>行动闭环：统一日历集中展示截止日，自动生成截止前 30 / 14 / 7 / 3 天的准备任务。</div><span className={styles.tag}>行动</span></li>
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>三层进化</h2><p>系统是按“图书馆 → 借阅窗口 → 图书管理员”的思路长出来的。</p></div>
        <div className={styles.requirements}>
          <article className={styles.requirement}><h3>图书馆（存）</h3><p>情报 Wiki：日报沉淀流水线、精确去重、过期标记、冲突检测，D1 数据库作为审计真相源。</p></article>
          <article className={styles.requirement}><h3>借阅窗口（读）</h3><p>只读 MCP 与摘要模式：对外提供干净的只读接口，列表摘要 token 节省约 90%，详情可下钻。</p></article>
          <article className={styles.requirement}><h3>图书管理员（整理）</h3><p>obsidian-mind 式自组织：三层自动归类、模糊去重保留多源证据链、同机构 / 同领域 / 同导师三路历史关联，增量运行。</p></article>
        </div>
      </section>
    </div>
  </main>;
}
