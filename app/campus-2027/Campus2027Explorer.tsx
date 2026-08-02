"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../documentation.module.css";

type Opportunity = {
  id: string;
  name: string;
  org: string;
  kind: string;
  status: string;
  fit: string;
  location: string;
  deadline: string;
  mastersEligible: boolean;
  eligibilityDetails: string;
  phdBridgeDetails: string | null;
  why: string;
  action: string;
  tags: string[];
  tracks: string[];
  regions: string[];
  verification: string;
  url: string;
  source: { name: string | null; healthy: boolean; lastCheckedAt: string | null };
};

type Payload = {
  generatedAt: string;
  counts: { total: number; confirmed2027: number; china: number; uk: number; immediate: number };
  tracks: string[];
  opportunities: Opportunity[];
};

export default function Campus2027Explorer() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [track, setTrack] = useState("");
  const [region, setRegion] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/campus-2027", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("2027 校招数据暂不可用");
        return response.json() as Promise<Payload>;
      })
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const items = useMemo(() => data?.opportunities.filter((item) => {
    const haystack = `${item.name} ${item.org} ${item.location} ${item.tags.join(" ")} ${item.tracks.join(" ")}`.toLowerCase();
    return (!track || item.tracks.includes(track))
      && (!region || item.regions.includes(region))
      && (!kind || item.kind === kind)
      && (!status || item.status === status)
      && (!query || haystack.includes(query.toLowerCase()));
  }) ?? [], [data, track, region, kind, status, query]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.loading}>正在读取 2027 校招与研究岗位…</p>;

  return <>
    <section className={styles.statusGrid}>
      <article className={styles.statusCard}><span>专项机会</span><strong>{data.counts.total}</strong><p>官方入口与已核验批次</p></article>
      <article className={styles.statusCard}><span>确认 2027 届</span><strong>{data.counts.confirmed2027}</strong><p>毕业范围已有官方依据</p></article>
      <article className={styles.statusCard}><span>中国机会</span><strong>{data.counts.china}</strong><p>大厂、研究机构、大模型厂商</p></article>
      <article className={styles.statusCard}><span>英国机会</span><strong>{data.counts.uk}</strong><p>大厂与国家级研究机构</p></article>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>2027 专项清单</h2><p>“已确认 2027 届”表示官方已经公布毕业范围；“专项跟踪”只代表入口值得持续检查，不等于 2027 批次已经开放。</p></div>
      <div className={styles.filterBar}>
        <label><span>搜索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="公司、机构、城市或方向" /></label>
        <label><span>赛道</span><select value={track} onChange={(event) => setTrack(event.target.value)}><option value="">全部</option>{data.tracks.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>地区</span><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="">全部</option>{["中国", "英国", "中国香港", "爱尔兰"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>类型</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">全部</option>{["校招", "实习", "研究岗位"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option>{["立即行动", "持续关注", "等待开放"].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <p className={styles.note}>显示 {items.length} / {data.counts.total} 个机会。优先处理“立即行动”；英国岗位还需逐项确认 Graduate Route、Skilled Worker 或其他工作许可条件。</p>
      <div className={styles.campusGrid}>
        {items.map((item) => <article className={styles.campusCard} key={item.id}>
          <div className={styles.campusCardTop}>
            <span>{item.tracks.join(" · ") || "专项机会"}</span>
            <b className={verificationClass(item.verification)}>{item.verification}</b>
          </div>
          <h3><a href={item.url} target="_blank" rel="noreferrer">{item.name}</a></h3>
          <p className={styles.campusOrg}>{item.org} · {item.location}</p>
          <div className={styles.chips}>{[item.kind, item.status, ...item.tags.slice(0, 4)].map((tag) => <span key={tag}>{tag}</span>)}</div>
          <dl className={styles.campusMeta}>
            <div><dt>申请窗口</dt><dd>{item.deadline}</dd></div>
            <div><dt>硕士适用</dt><dd>{item.mastersEligible ? "可以申请，逐岗核对" : "按岗位要求核对"}</dd></div>
          </dl>
          <p>{item.why}</p>
          <p className={styles.campusEligibility}>{item.eligibilityDetails}</p>
          <div className={styles.campusAction}><b>下一步</b><p>{item.action}</p></div>
          <footer><a href={item.url} target="_blank" rel="noreferrer">查看官方机会 ↗</a><span>{item.source.healthy ? "官方源已正常检查" : "官方源等待/重新检查"}</span></footer>
        </article>)}
      </div>
      {!items.length && <p className={styles.emptyState}>没有符合当前筛选条件的机会。</p>}
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>建议投递顺序</h2><p>把明确开放、需要提前准备、尚未开放三类分开，避免在通用招聘主页上浪费时间。</p></div>
      <ol className={styles.checklist}>
        <li><span>1</span><div><b>现在投递</b><p>百度、华为、阿里、阿里云、MiniMax、字节 Seed 与上海 AI 实验室的明确 2027 入口。</p></div><span className={styles.tag}>NOW</span></li>
        <li><span>2</span><div><b>准备英国材料</b><p>Arm 预计 9—10 月开放；提前完成英文 CV、项目证据和工作许可判断。</p></div><span className={styles.tag}>PREPARE</span></li>
        <li><span>3</span><div><b>等待官方切换批次</b><p>Kimi、智谱、腾讯、DeepSeek 及国际公司入口持续由 Cron 检查，不猜测开放日期。</p></div><span className={styles.tag}>WATCH</span></li>
      </ol>
    </section>
  </>;
}

function verificationClass(value: string) {
  if (value === "已确认 2027 届") return styles.campusVerified;
  if (value.includes("待确认")) return styles.campusWaiting;
  return styles.campusWatch;
}
