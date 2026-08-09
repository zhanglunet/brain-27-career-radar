import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "站点地图｜BRAIN / 27",
  description: "按用途查找 BRAIN / 27 的机会、学术、地区、监控与说明页面。",
};

const groups = [
  { eyebrow: "START HERE", title: "开始使用", links: [["/", "首页雷达", "精选机会与 90 天行动计划"], ["/search", "全局搜索", "跨机会、论文、导师与机构搜索"], ["/opportunities", "全部机会", "查看完整机会清单与筛选"]] },
  { eyebrow: "OPPORTUNITIES", title: "机会与行动", links: [["/campus-2027", "2027 校招", "国内外校招与研究岗位专项"], ["/calendar", "时间表与截止日期", "截止日、开放日与行动提醒"], ["/discovery", "持续发现", "持续发现的新机构与机会"]] },
  { eyebrow: "ACADEMIC RADAR", title: "学术情报", links: [["/conferences", "学术会议雷达", "心理学、脑科学与 AI 顶会"], ["/researchers", "导师雷达", "重点导师与研究方向"], ["/papers", "双语论文", "最新论文与中文摘要"], ["/policies", "科研政策与项目", "基金、人才与科研项目"], ["/knowledge-graph", "知识图谱", "论文、导师、机构与机会关系"], ["/paper-sources", "论文数据库", "数据库目录与同步状态"]] },
  { eyebrow: "REGIONS", title: "地区与机构", links: [["/map", "全球地图", "按地区查看机会分布"], ["/beijing", "北京", "北京科研生态"], ["/shanghai", "上海", "上海科研生态"], ["/shenzhen", "深圳", "深圳科研生态"], ["/uk", "英国", "英国机构与机会"], ["/ireland", "爱尔兰", "爱尔兰机构与机会"], ["/hong-kong", "中国香港", "香港机构与机会"], ["/ai-companies", "大模型公司", "AI 公司与官方招聘入口"]] },
  { eyebrow: "REPORTS & OPERATIONS", title: "周报与系统", links: [["/weekly", "本周开发周报", "本周开发、运行观察与下周计划"], ["/reports", "日报 / 周报 / 月报", "系统生成的周期报告"], ["/sources", "信息源", "官方来源目录与健康状态"], ["/logs", "运行日志", "来源巡检与审查记录"], ["/system", "系统说明", "D1、Cron 与数据边界"], ["/prd", "需求文档", "产品需求与开发阶段"]] },
] as const;

export default function SitemapPage() {
  return <main className="sitemap-page">
    <nav className="nav"><Link className="brand" href="/"><span>Ψ</span> BRAIN / 27</Link><div className="navlinks"><a href="/opportunities">全部机会</a><a href="/conferences">学术雷达</a><a href="/calendar">时间表</a><a href="/weekly">本周周报</a><a className="active" href="/sitemap">站点地图</a></div><div className="fresh"><i /> 全部页面索引</div></nav>
    <section className="sitemap-hero"><p className="eyebrow">SITE MAP · FIND YOUR NEXT MOVE</p><h1>从这里找到<br /><span>你要的页面</span></h1><p>把高频入口放在导航，把完整路径放在这里。按用途浏览机会、学术情报、地区生态与系统记录。</p></section>
    <section className="sitemap-grid">{groups.map((group) => <section className="sitemap-group" key={group.title}><p className="eyebrow">{group.eyebrow}</p><h2>{group.title}</h2><div>{group.links.map(([href, label, description]) => <Link href={href} key={href}><span className="sitemap-arrow">↗</span><span><b>{label}</b><small>{description}</small></span></Link>)}</div></section>)}</section>
    <footer><div><span className="brand"><span>Ψ</span> BRAIN / 27</span><p>2027 脑科学与 AI 机会雷达</p></div><Link href="/">返回首页 →</Link></footer>
  </main>;
}
