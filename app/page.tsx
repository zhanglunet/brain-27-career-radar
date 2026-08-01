"use client";

import { useEffect, useMemo, useState } from "react";

type Opportunity = {
  name: string;
  org: string;
  kind: "博士" | "联培博士" | "科研助理" | "校招" | "实习" | "研究岗位";
  status: "立即行动" | "等待开放" | "持续关注";
  fit: "高度匹配" | "匹配" | "转型匹配";
  location: string;
  deadline: string;
  fundingType?: "full" | "partial" | "mixed" | "self_funded" | "unknown";
  fundingDetails?: string;
  fundingVerifiedAt?: string | null;
  mastersEligible?: boolean;
  eligibilityDetails?: string;
  phdBridgeDetails?: string | null;
  why: string;
  action: string;
  tags: string[];
  url: string;
  sourceVerifiedAt?: string | null;
};

type Institution = {
  name: string;
  mark: string;
  summary: string;
  note: string;
  url: string;
  sourceVerifiedAt?: string | null;
};

type RadarPayload = {
  dataOrigin: "database";
  updatedAt: string | null;
  syncStatus: string;
  opportunities: Opportunity[];
  institutions: Institution[];
};

const opportunities: Opportunity[] = [
  {
    name: "2027 级联合培养博士",
    org: "北京智源人工智能研究院",
    kind: "联培博士",
    status: "立即行动",
    fit: "高度匹配",
    location: "北京",
    deadline: "已启动｜滚动初筛",
    why: "方向覆盖生命大模型、类脑智能、AI4Life、世界模型与具身智能。硕士生可走申请—考核制，与北大、人大、中科院自动化所等单位联培。",
    action: "发送学术简历，突出实验范式、脑数据分析和 AI 交叉潜力；同步确认对应联培高校与导师。",
    tags: ["类脑智能", "AI4Life", "申请考核", "双导师"],
    url: "https://hub.baai.ac.cn/view/54026",
  },
  {
    name: "2027 普通招考博士",
    org: "北京脑科学与类脑研究所",
    kind: "博士",
    status: "等待开放",
    fit: "高度匹配",
    location: "北京",
    deadline: "预计 2026.10—11 发布",
    why: "与北大、北师大、北理工、协和、首医联招；硕士起点可申请。覆盖心理学、神经生物学、生物医学工程与脑机接口，入学后轮转定导。",
    action: "8—9 月筛选实验室；10 月起盯招生公告。心理学通道优先关注北师大联培项目。",
    tags: ["实验心理学", "认知神经", "脑机接口", "轮转定导"],
    url: "https://cibr.ac.cn/detail/cibrPersonneladmissions/5d82d0e8ad2347c1b78bffbbb13c802f",
  },
  {
    name: "2027 博士研究生",
    org: "清华大学心理与认知科学系",
    kind: "博士",
    status: "等待开放",
    fit: "高度匹配",
    location: "北京",
    deadline: "第二批或于 2026.11.01—11.30 开放",
    why: "最贴近实验心理学、脑影像、认知与智能。第一批已结束；只有第一批未招满时才开放第二批。",
    action: "现在完成 5000 字研究计划、1500 字研究兴趣陈述，并提前落实两封专家推荐信。",
    tags: ["心理学", "脑影像", "认知与智能", "申请考核"],
    url: "https://www.pcs.tsinghua.edu.cn/info/1031/2141.htm",
  },
  {
    name: "2027 级联合培养博士",
    org: "上海人工智能实验室",
    kind: "联培博士",
    status: "立即行动",
    fit: "匹配",
    location: "上海",
    deadline: "已启动｜以联培高校为准",
    why: "与清华、北大、复旦、上交、浙大等十余所高校联培；AI for Science 明确包括神经科学，另有认知推理与世界模型方向。",
    action: "从神经科学 × AI 切入，优先匹配 AI for Science 或可信认知方向，提交招生系统并邮件咨询。",
    tags: ["神经科学", "AI for Science", "世界模型", "联培"],
    url: "https://www.shlab.org.cn/news/5444256",
  },
  {
    name: "生物医学工程博士",
    org: "天津大学—香港理工大学深圳未来技术学院",
    kind: "博士",
    status: "等待开放",
    fit: "高度匹配",
    location: "深圳",
    deadline: "2027 招生细则待发布",
    why: "直接覆盖脑信号获取与解码、神经调控、脑—机—体交互和医学人工智能，采用双校联合指导。",
    action: "尽快咨询导师与招生批次；用 EEG/行为实验项目证明跨入工程研究的能力。",
    tags: ["脑机接口", "神经调控", "医学AI", "双校培养"],
    url: "https://sz.tju.edu.cn/zsxx/sbzs/zysz2.htm",
  },
  {
    name: "脑机接口 / 类脑计算博士方向",
    org: "清华大学深圳国际研究生院",
    kind: "博士",
    status: "等待开放",
    fit: "匹配",
    location: "深圳",
    deadline: "第一批已结束；第二批视名额开放",
    why: "2027 目录包含忆阻器存算一体、脑机接口和类脑计算，工程与算法色彩较强。",
    action: "若已有信号处理或深度学习成果，准备第二批；否则将它作为冲刺项。",
    tags: ["类脑计算", "脑机接口", "深度学习", "工程"],
    url: "https://www.sigs.tsinghua.edu.cn/2026/0630/c7769a291927/page.htm",
  },
  {
    name: "2027 联培博士『通计划』",
    org: "北京通用人工智能研究院 × 哈尔滨工业大学",
    kind: "联培博士",
    status: "持续关注",
    fit: "转型匹配",
    location: "哈尔滨 / 北京",
    deadline: "后续按学院通知",
    why: "聚焦多智能体、通用视觉、机器人、语言交互、认知与推理、混合智能；目前公布专业为机械工程、数学，拟招 2 人。",
    action: "仅在数学、建模和编程基础较强时投入；申请前需同时联系校内与研究院导师。",
    tags: ["认知推理", "通用智能", "双导师", "强工程"],
    url: "https://yzb.hit.edu.cn/2026/0708/c19935a396468/page.htm",
  },
  {
    name: "心理学申请—考核博士",
    org: "上海交通大学心理学院",
    kind: "博士",
    status: "持续关注",
    fit: "高度匹配",
    location: "上海",
    deadline: "2027 普博简章待发布",
    why: "学院以心理学 + AI 为特色，布局脑与认知科学、临床健康心理及跨学科研究。",
    action: "持续查看招生页；提前按往年申请—考核结构准备论文、研究计划和英语材料。",
    tags: ["心理学+AI", "脑与认知", "临床心理", "申请考核"],
    url: "https://psychology.sjtu.edu.cn/zsxx.html",
  },
  {
    name: "机器学习研究员（健康方向）",
    org: "OPPO",
    kind: "实习",
    status: "立即行动",
    fit: "高度匹配",
    location: "深圳",
    deadline: "2027 届寻梦实习｜在招",
    why: "参与电生理信号建模与实验设计，岗位明确提到 EEG、ECG、PPG、IMU、时序表征学习与可解释性。",
    action: "优先投递；简历第一屏展示 EEG/生理时序数据、Python/PyTorch 和实验设计。",
    tags: ["EEG", "生理信号", "机器学习", "实验设计"],
    url: "https://careers.oppo.com/university/oppo/campus/post/1615?recruitType=Intern",
  },
  {
    name: "健康算法工程师",
    org: "OPPO",
    kind: "实习",
    status: "立即行动",
    fit: "高度匹配",
    location: "深圳",
    deadline: "2027 届寻梦实习｜在招",
    why: "面向睡眠、心率、健康检测，要求数字信号处理、Python/MATLAB、机器学习与算法落地。",
    action: "用可复现项目证明从实验数据到算法指标的完整链路。",
    tags: ["睡眠", "PPG", "信号处理", "健康AI"],
    url: "https://careers.oppo.com/university/oppo/campus/post/1611?recruitType=Graduate",
  },
  {
    name: "2027 届秋季校园招聘",
    org: "BrainCo 强脑科技",
    kind: "校招",
    status: "立即行动",
    fit: "高度匹配",
    location: "杭州 / 待确认",
    deadline: "第三方页面标注 2026.09.12",
    why: "业务直接聚焦非侵入式脑机接口，招聘方向涉及算法、软件、硬件与产品。具体岗位及截止时间需在官方渠道二次确认。",
    action: "先在官方招聘页查询职位，再用校招页校验批次；不要只依赖第三方截止时间。",
    tags: ["非侵入式BCI", "算法", "产品", "校招"],
    url: "https://www.brainco.cn/recruit",
  },
  {
    name: "脑机接口信号处理与解码岗位",
    org: "NeuroXess 脑虎科技",
    kind: "研究岗位",
    status: "持续关注",
    fit: "匹配",
    location: "上海",
    deadline: "社会招聘｜未标注校招批次",
    why: "官方岗位涉及植入式脑机接口信号处理、解码、分析与算法优化，但对应届硕士的开放程度需直接确认。",
    action: "以应届生自荐方式联系；突出神经信号分析，不把它当作标准校招流程。",
    tags: ["植入式BCI", "神经解码", "算法", "自荐"],
    url: "https://www.neuroxess.com/join-us/",
  },
  {
    name: "Seed 大模型人才校招",
    org: "字节跳动 Seed",
    kind: "校招",
    status: "立即行动",
    fit: "转型匹配",
    location: "北京 / 上海 / 深圳等",
    deadline: "2027 届｜在招",
    why: "覆盖世界模型、多模态、AI for Science 与具身智能。实验心理学背景可转向人机认知与评测，但需强机器学习和代码能力。",
    action: "只有在具备 PyTorch、建模和论文复现能力时优先投入。",
    tags: ["世界模型", "多模态", "AI4S", "高代码门槛"],
    url: "https://seed.bytedance.com/zh/seedearlycareer",
  },
  {
    name: "2027 留用实习 / 联培博士",
    org: "上海人工智能实验室",
    kind: "实习",
    status: "立即行动",
    fit: "匹配",
    location: "上海",
    deadline: "留用实习覆盖 2026.10—2027.09 毕业",
    why: "AI for Science 招聘明确涵盖神经科学，实验室同时开放日常实习与 2027 联培博士。",
    action: "用同一份研究型材料双投实习和联培，优先选神经科学、认知推理或科学智能方向。",
    tags: ["神经科学", "科学智能", "留用实习", "联培"],
    url: "https://www.shlab.org.cn/joinus",
  },
];

const institutions = [
  {
    name: "北京智源人工智能研究院",
    mark: "新增重点",
    summary: "更偏 AI 研究平台，而非传统心理学机构；与你最接近的是生命大模型、类脑智能和 AI4Life。2027 联培博士已经启动，硕士生可申请。",
    note: "优势是双导师、算力与产业连接；短板是对算法、编程和 AI 研究潜力要求高。",
    url: "https://hub.baai.ac.cn/view/54026",
  },
  {
    name: "北京脑科学与类脑研究所",
    mark: "方向最贴合",
    summary: "脑科学主场，联招路径覆盖心理学、神经生物学和生物医学工程；硕士起点普博一般在 10—11 月发布。",
    note: "轮转定导适合尚未完全锁定实验室的人，但每人只能选择一个联培项目。",
    url: "https://cibr.ac.cn/detail/cibrPersonneladmissions/5d82d0e8ad2347c1b78bffbbb13c802f",
  },
  {
    name: "上海人工智能实验室",
    mark: "AI × 神经科学",
    summary: "2027 联培博士已启动，合作高校覆盖清北复交浙等；AI for Science 明确包含神经科学。",
    note: "适合把脑数据研究转译成科学智能、世界模型或认知推理问题。",
    url: "https://www.shlab.org.cn/news/5444256",
  },
  {
    name: "北京通用人工智能研究院",
    mark: "认知启发 AI",
    summary: "研究布局含认知与推理、混合智能和机器人。2027 与哈工大联培项目已公布，但当前专业仅机械工程和数学、名额少。",
    note: "适合数学与工程能力很强的转型申请者，不是实验心理学的自然延伸。",
    url: "https://yzb.hit.edu.cn/2026/0708/c19935a396468/page.htm",
  },
  {
    name: "鹏城国家实验室",
    mark: "工程博士",
    summary: "与清华深圳国际研究生院开展 2027 工程博士联培，面向通信、网络和智能信息，第二批视首轮名额决定。",
    note: "更适合信号处理、计算机或工程背景；可作为脑机接口算法方向的交叉备选。",
    url: "https://yzbm.tsinghua.edu.cn/publish/s03/s0302/detail/2581f75f-63ec-4d59-ba1f-8126bdd7a855?yxsdm=599",
  },
];

const statusOptions = ["全部", "立即行动", "等待开放", "持续关注"] as const;
const kindOptions = ["全部", "博士", "联培博士", "科研助理", "校招", "实习", "研究岗位"] as const;

export default function Home() {
  const [status, setStatus] = useState<(typeof statusOptions)[number]>("全部");
  const [kind, setKind] = useState<(typeof kindOptions)[number]>("全部");
  const [query, setQuery] = useState("");
  const [radar, setRadar] = useState<{
    opportunities: Opportunity[];
    institutions: Institution[];
    updatedAt: string;
    origin: "static" | "database";
    syncStatus: string;
  }>({ opportunities, institutions, updatedAt: "2026-08-01", origin: "static", syncStatus: "not_run" });

  useEffect(() => {
    const controller = new AbortController();
    async function loadRadar() {
      try {
        const response = await fetch("/api/radar?v=p1.9", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!isRadarPayload(payload)) return;
        setRadar({
          opportunities: payload.opportunities,
          institutions: payload.institutions,
          updatedAt: payload.updatedAt ?? new Date().toISOString(),
          origin: "database",
          syncStatus: payload.syncStatus,
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Unable to load live radar data", error);
        }
      }
    }
    void loadRadar();
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => radar.opportunities.filter((item) => {
    const statusMatch = status === "全部" || item.status === status;
    const kindMatch = kind === "全部" || item.kind === kind;
    const haystack = `${item.name}${item.org}${item.location}${item.fundingDetails ?? ""}${item.eligibilityDetails ?? ""}${item.phdBridgeDetails ?? ""}${item.tags.join("")}`.toLowerCase();
    return statusMatch && kindMatch && haystack.includes(query.trim().toLowerCase());
  }), [status, kind, query, radar.opportunities]);

  const immediateCount = radar.opportunities.filter((item) => item.status === "立即行动").length;

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#top" aria-label="返回顶部"><span>Ψ</span> BRAIN / 27</a>
        <div className="navlinks"><a href="#radar">机会雷达</a><a href="/map">全球地图</a><a href="/calendar">时间表</a><a href="/knowledge-graph">知识图谱</a><a href="/beijing">区域页面</a><a href="/researchers">导师雷达</a><a href="/papers">双语论文</a><a href="/paper-sources">论文数据库</a><a href="/sources">信息源</a><a href="/logs">采集日志</a><a href="/system">系统说明</a><a href="/prd">需求文档</a></div>
        <div className="fresh"><i /> {freshnessLabel(radar.origin, radar.syncStatus)}于 {formatDate(radar.updatedAt)}</div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">2027 硕士毕业 · 城市不限</p>
          <h1>从实验心理学<br />走向<span>脑科学 × AI</span></h1>
          <p className="lede">一份聚焦实验心理学、认知神经、脑机接口与脑启发人工智能的博士申请、科研助理和科研就业雷达。支持先在高校积累研究成果，再申请博士。</p>
          <div className="hero-actions"><a className="primary" href="#radar">查看立即行动项 ↘</a><a className="secondary" href="#institutes">研究机构地图</a></div>
        </div>
        <div className="hero-panel">
          <div className="panel-head"><span>PROFILE SIGNAL</span><span className="live">{freshnessBadge(radar.origin, radar.syncStatus)}</span></div>
          <div className="profile-line"><b>背景</b><span>实验心理学 · 2027 硕士</span></div>
          <div className="profile-line"><b>主航道</b><span>认知神经 / BCI / Brain × AI</span></div>
          <div className="profile-line"><b>当前窗口</b><span>科研助理 + 秋招 + 博士初筛</span></div>
          <div className="signal"><div style={{width:"86%"}} /><small>方向匹配强度 86%</small></div>
          <div className="mini-grid"><div><strong>{radar.opportunities.length}</strong><span>精选机会</span></div><div><strong>{immediateCount}</strong><span>立即行动</span></div><div><strong>{radar.institutions.length}</strong><span>重点机构</span></div></div>
        </div>
      </section>

      <section className="alert-strip">
        <span>NOW</span>
        <p><b>最短路径：</b>先投硕士可申请的高校科研助理，优先北京、上海、深圳和香港；积累数据、论文与推荐信，同时准备 2027 博士申请。</p>
      </section>

      <section className="section" id="radar">
        <div className="section-title"><div><p className="eyebrow">OPPORTUNITY RADAR</p><h2>机会雷达</h2></div><p>优先显示能在未来 30 天内产生结果的动作。</p></div>
        <div className="controls">
          <div className="segmented" aria-label="按状态筛选">{statusOptions.map((option) => <button key={option} className={status === option ? "active" : ""} onClick={() => setStatus(option)}>{option}</button>)}</div>
          <div className="segmented" aria-label="按类型筛选">{kindOptions.map((option) => <button key={option} className={kind === option ? "active" : ""} onClick={() => setKind(option)}>{option}</button>)}</div>
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索机构、方向或城市" /></label>
        </div>
        <p className="result-count">显示 {filtered.length} / {radar.opportunities.length} 个机会</p>
        <div className="cards">
          {filtered.map((item, index) => (
            <article className="card" key={`${item.org}-${item.name}`}>
              <div className="card-top"><span className={`status status-${item.status}`}>{item.status}</span><span className="index">{String(index + 1).padStart(2,"0")}</span></div>
              <p className="org">{item.org}</p><h3>{item.name}</h3>
              <div className="meta"><span>{item.kind}</span><span>{item.location}</span><span className={`fit fit-${item.fit}`}>{item.fit}</span></div>
              <p className="deadline">◷ {item.deadline}</p>
              {(item.kind === "博士" || item.kind === "联培博士") && item.fundingType ? <div className={`funding funding-${item.fundingType}`}><b>{fundingLabel(item.fundingType)}</b><span>{item.fundingDetails}</span></div> : null}
              {item.kind === "科研助理" ? <div className="bridge"><b>{item.mastersEligible ? "硕士可申请" : "学历要求待核对"}</b><span>{item.eligibilityDetails ?? "以官方岗位要求为准"}</span>{item.phdBridgeDetails ? <small>博士过渡价值：{item.phdBridgeDetails}</small> : null}</div> : null}
              {item.sourceVerifiedAt ? <p className="deadline">来源验证于 {formatDate(item.sourceVerifiedAt)}</p> : null}
              <p className="why">{item.why}</p>
              <div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="next"><b>下一步</b><p>{item.action}</p></div>
              <a className="source" href={item.url} target="_blank" rel="noreferrer">打开官方 / 原始来源 ↗</a>
            </article>
          ))}
        </div>
      </section>

      <section className="section institutes" id="institutes">
        <div className="section-title"><div><p className="eyebrow">RESEARCH INSTITUTES</p><h2>智源与同类科研机构</h2></div><p>不是所有 AI 研究院都同样适合实验心理学背景。</p></div>
        <div className="institution-list">
          {radar.institutions.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" className="institution" key={item.name}>
            <span className="num">0{index + 1}</span><div><div className="inst-head"><h3>{item.name}</h3><span>{item.mark}</span></div><p>{item.summary}</p><small>{item.note}</small></div><b>↗</b>
          </a>)}
        </div>
      </section>

      <section className="section plan" id="plan">
        <div className="section-title"><div><p className="eyebrow">90-DAY PLAN</p><h2>未来 90 天</h2></div><p>把“同时准备”变成有截止时间的节奏。</p></div>
        <div className="timeline">
          <div><span>01</span><p className="time">8 月上旬</p><h3>科研助理优先投递</h3><p>先处理有明确截止时间的清华、北大、复旦、港大岗位，并为英港高校招聘门户建立提醒。</p></div>
          <div><span>02</span><p className="time">8—9 月</p><h3>双轨材料成型</h3><p>准备科研助理简历和 5000 字博士计划；围绕“实验范式 × 脑信号 × 可解释 AI”形成一页研究提案。</p></div>
          <div><span>03</span><p className="time">9—10 月</p><h3>导师与机构匹配</h3><p>筛选北京脑所实验室；跟踪上交心理、天大深圳与各联培高校招生页。</p></div>
          <div><span>04</span><p className="time">10—11 月</p><h3>博士批次提交</h3><p>重点处理北京脑所联招；若清华心理第二批开放，于 11 月完成申请。</p></div>
        </div>
      </section>

      <section className="section evidence">
        <div><p className="eyebrow">APPLICATION SIGNALS</p><h2>材料里必须出现的证据</h2></div>
        <div className="skills"><span>实验设计</span><span>EEG / fMRI / 眼动</span><span>Python / MATLAB / R</span><span>MNE / EEGLAB / SPM</span><span>统计推断</span><span>时序建模</span><span>机器学习 / PyTorch</span><span>科研写作</span><span>伦理与数据治理</span></div>
      </section>

      <footer><div><span className="brand"><span>Ψ</span> BRAIN / 27</span><p>2027 脑科学与 AI 机会雷达</p></div><p>信息会变化。投递前请以链接中的机构官方页面为准。</p></footer>
    </main>
  );
}

function isRadarPayload(value: unknown): value is RadarPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.dataOrigin === "database"
    && (typeof candidate.updatedAt === "string" || candidate.updatedAt === null)
    && typeof candidate.syncStatus === "string"
    && Array.isArray(candidate.opportunities)
    && candidate.opportunities.every(isOpportunity)
    && Array.isArray(candidate.institutions)
    && candidate.institutions.every(isInstitution);
}

function isOpportunity(value: unknown): value is Opportunity {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === "string"
    && typeof item.org === "string"
    && typeof item.kind === "string"
    && typeof item.status === "string"
    && typeof item.fit === "string"
    && typeof item.location === "string"
    && typeof item.deadline === "string"
    && (item.fundingType === undefined || ["full", "partial", "mixed", "self_funded", "unknown"].includes(String(item.fundingType)))
    && (item.fundingDetails === undefined || typeof item.fundingDetails === "string")
    && (item.mastersEligible === undefined || typeof item.mastersEligible === "boolean")
    && (item.eligibilityDetails === undefined || typeof item.eligibilityDetails === "string")
    && (item.phdBridgeDetails === undefined || item.phdBridgeDetails === null || typeof item.phdBridgeDetails === "string")
    && typeof item.why === "string"
    && typeof item.action === "string"
    && typeof item.url === "string"
    && Array.isArray(item.tags)
    && item.tags.every((tag) => typeof tag === "string");
}

function isInstitution(value: unknown): value is Institution {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === "string"
    && typeof item.mark === "string"
    && typeof item.summary === "string"
    && typeof item.note === "string"
    && typeof item.url === "string";
}

function fundingLabel(value: NonNullable<Opportunity["fundingType"]>): string {
  return ({ full: "全奖", partial: "部分资助", mixed: "全奖 / 半奖视资格", self_funded: "自费", unknown: "资助待确认" })[value];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function freshnessLabel(origin: "static" | "database", syncStatus: string): string {
  if (origin === "static") return "静态快照";
  if (syncStatus === "succeeded") return "已验证";
  if (syncStatus === "partial") return "部分验证";
  return "数据库快照";
}

function freshnessBadge(origin: "static" | "database", syncStatus: string): string {
  if (origin === "static") return "STATIC";
  if (syncStatus === "succeeded") return "LIVE";
  if (syncStatus === "partial") return "PARTIAL";
  return "DATA";
}
