import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "开发周报｜BRAIN / 27",
  description: "BRAIN / 27 本周开发、线上运行观察、风险与下周计划。",
};

const sections = [
  {
    title: "本周开发与交付",
    items: [
      "2026-08-03 至 2026-08-09 无新增代码提交，项目处于 v0.13.0 学术会议雷达发布后的运行观察期。",
      "本地质量门通过：TypeScript、ESLint、生产构建、34/34 自动化测试全部成功。",
      "线上首页、/conferences、/api/conferences、/api/system-status 均返回 HTTP 200；会议 API 返回 13 个会议、18 个已确认日期。",
    ],
  },
  {
    title: "线上运行观察",
    items: [
      "会议雷达最近一次运行检查 12 个会议，新增 3 个官网版本证据，1 个失败，状态为 partial。",
      "职业/论文 Cron 最近一次运行检查 92 个来源，4 个内容变化，73 个失败，状态为 partial。",
      "主要错误为 Too many subrequests by single Worker invocation，需优先拆分巡检批次并降低单次调用负载。",
    ],
  },
  {
    title: "风险与下周计划",
    items: [
      "P0：按来源优先级或稳定批次拆分 Worker 调用，控制单次子请求数。",
      "P1：按 HTTP、超时、平台限制分类失败来源，持续失败来源转人工核对。",
      "P1：修复后以 trigger=cron 的生产运行记录验证成功率、失败数、变化数和审查队列趋势。",
      "P2：继续观察会议监控，人工复核失败会议来源和新增版本证据。",
    ],
  },
];

export default function WeeklyPage() {
  return <main className="report-page">
    <nav className="nav"><Link className="brand" href="/"><span>Ψ</span> BRAIN / 27</Link><div className="navlinks"><a href="/opportunities">全部机会</a><a href="/conferences">学术雷达</a><a href="/calendar">时间表</a><a className="active" href="/weekly">本周周报</a><a href="/sitemap">站点地图</a></div><div className="fresh"><i /> 周报已发布</div></nav>
    <section className="report-hero">
      <p className="eyebrow">WEEKLY ENGINEERING REPORT · 2026 W32</p>
      <h1>本周开发周报</h1>
      <p className="report-meta">2026-08-03 — 2026-08-09 · 版本基线 v0.13.0</p>
      <p className="report-lede">本周没有新增代码提交，项目进入学术会议雷达发布后的运行观察期。质量门保持全绿，但自动巡检暴露了 Worker 单次调用子请求数超限问题。</p>
    </section>
    <section className="report-content">
      <div className="report-callout"><span>结论</span><p>功能发布稳定，监控链路需要先完成批次与并发治理，再扩大自动巡检覆盖。</p></div>
      {sections.map((section, index) => <section className="report-section" key={section.title}><div className="report-section-index">0{index + 1}</div><div><h2>{section.title}</h2><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div></section>)}
      <div className="report-source"><b>证据边界</b><p>本页基于仓库 Git 历史、npm run verify、公开生产路由及 Cloudflare D1/Worker 运行快照生成。线上统计会随后续 Cron 运行变化；生产运行与本地测试严格区分。</p><a href="https://github.com/zhanglunet/brain-27-career-radar/blob/main/docs/weekly/2026-08-09.md" target="_blank" rel="noreferrer">查看仓库原始 Markdown ↗</a></div>
    </section>
    <footer><div><span className="brand"><span>Ψ</span> BRAIN / 27</span><p>2027 脑科学与 AI 机会雷达</p></div><a href="/sitemap">从站点地图查找全部页面 →</a></footer>
  </main>;
}
