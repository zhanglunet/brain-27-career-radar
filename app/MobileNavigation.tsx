"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const groups = [
  { title: "机会", links: [["/", "首页雷达"], ["/opportunities", "全部机会"], ["/campus-2027", "2027 校招"], ["/calendar", "时间表与截止日期"], ["/search", "全局搜索"]] },
  { title: "学术", links: [["/conferences", "心理学 / 脑科学 / AI 顶会"], ["/researchers", "导师雷达"], ["/papers", "最新论文"], ["/policies", "科研政策与项目"], ["/knowledge-graph", "知识图谱"], ["/paper-sources", "论文数据库"]] },
  { title: "地区", links: [["/map", "全球地图"], ["/beijing", "北京"], ["/shanghai", "上海"], ["/shenzhen", "深圳"], ["/uk", "英国"], ["/ireland", "爱尔兰"], ["/hong-kong", "中国香港"]] },
  { title: "跟踪与说明", links: [["/reports", "日报 / 周报 / 月报"], ["/discovery", "持续发现"], ["/ai-companies", "大模型公司"], ["/sources", "信息源"], ["/logs", "运行日志"], ["/system", "系统说明"], ["/prd", "需求文档"]] },
] as const;

export default function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return <div className="mobile-navigation">
    <button className="mobile-navigation-trigger" type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="mobile-navigation-panel" aria-label="打开网站导航">
      <span aria-hidden="true"><i/><i/><i/></span><b>菜单</b>
    </button>
    {open && <div className="mobile-navigation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <nav id="mobile-navigation-panel" className="mobile-navigation-panel" aria-label="手机主导航">
        <header><Link href="/" onClick={() => setOpen(false)}><strong>Ψ</strong><span>BRAIN / 27<small>机会与学术情报雷达</small></span></Link><button type="button" onClick={() => setOpen(false)} aria-label="关闭网站导航">关闭 ×</button></header>
        <div className="mobile-navigation-groups">
          {groups.map((group) => <section key={group.title}><h2>{group.title}</h2><div>{group.links.map(([href, label]) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
            return <Link href={href} key={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={active ? "active" : undefined}><span>{label}</span><b aria-hidden="true">→</b></Link>;
          })}</div></section>)}
        </div>
        <footer><span>任意页面均可使用</span><button type="button" onClick={() => { setOpen(false); window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true })); }}>⌕ 打开全局搜索</button></footer>
      </nav>
    </div>}
  </div>;
}
