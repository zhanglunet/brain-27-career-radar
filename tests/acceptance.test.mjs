/**
 * PRD-061/T5 · 验收（trend #281）。
 *
 * 合成验收集走完整流水线（runAutoOrganize：归类→精确去重→模糊去重→历史关联→待确认区），
 * 逐项验证 PRD-061 的 5 条验收标准。全部 fixture 内联、确定性（无随机、无网络、无 LLM）。
 *
 * 5 条标准：
 * 1. 归类准确率 ≥ 0.90（含 4 个故意模糊的 hard case，照样计入分母）
 * 2. 去重召回率（5 对已知跨来源重复全合并）+ 零误合并（5 个 near-miss 一个不并）
 * 3. 关联覆盖率（6 个应关联的新条目各 ≥1 条链接；2 个负对照 0 条）
 * 4. 增量：第二轮空操作；变更条目被重新处理
 * 5. 不破坏 PRD-017 人工确认闸门（pending 全待确认、历史只读、配置未动）
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classify } from "../lib/wiki/classifier.ts";
import {
  runAutoOrganize,
  initialPipelineState,
} from "../lib/wiki/auto-organize.ts";
import { WIKI_PIPELINE_CONFIG } from "../lib/wiki/pipeline-config.ts";

// ── fixture 基础设施 ────────────────────────────────────────────────────

const ORG = {};
const DL = {};
const MENTOR = {};

function mkEntry({
  id,
  title,
  body = "",
  source = "测试来源站",
  source_url = `https://example.com/${id}`,
  source_type = "daily_report",
  org = null,
  deadline = null,
  mentor = null,
  keywords = [],
  type = null,
  created = "2026-10-18",
  last_verified = "2026-10-18T08:00:00.000Z",
  status = "active",
  confidence = "medium",
}) {
  if (org) ORG[id] = org;
  if (deadline) DL[id] = deadline;
  if (mentor) MENTOR[id] = mentor;
  return {
    id,
    title,
    source,
    source_url,
    source_type,
    d1_evidence: null,
    confidence,
    created,
    last_verified,
    status,
    facets: { ...(type ? { type } : {}), ...(keywords.length ? { keywords } : {}) },
    body,
  };
}

const orgOf = (e) => ORG[e.id] ?? null;
const deadlineOf = (e) => DL[e.id] ?? null;
const mentorOf = (e) => MENTOR[e.id] ?? null;
const ACCESSORS = { orgOf, deadlineOf, mentorOf };

// ── 验收集 1：归类（32 条：28 清晰 + 4 故意模糊，期望低置信） ────────────────
// 期望值按 T1 设计逐字核对（L2 值域 = WIKI_OPPORTUNITY_TYPES；L3 种子 = WIKI_DIRECTIONS v0.1）。

const CLASSIFY_CASES = [
  // —— L2=phd ——
  { e: mkEntry({ id: "c01", title: "UCL 脑机接口博士奖学金 2026", body: "伦敦大学学院脑机接口方向博士招生，导师制培养。", source: "UCL 官网" }), exp: { l1: "高校", l2: "phd", l3: ["脑机接口"] } },
  { e: mkEntry({ id: "c02", title: "清华大学类脑智能博士项目", body: "清华大学类脑智能研究中心招收博士生。", source: "清华大学官网" }), exp: { l1: "高校", l2: "phd", l3: ["类脑智能"] } },
  { e: mkEntry({ id: "c03", title: "中国科学院自动化研究所认知神经科学博士招生", body: "自动化研究所脑网络组招收博士研究生。", source: "中科院自动化所" }), exp: { l1: "研究所", l2: "phd", l3: ["认知神经科学"] } },
  { e: mkEntry({ id: "c04", title: "北京智源人工智能研究院计算神经科学博士项目", body: "智源研究院招收计算神经科学方向博士生。", source: "智源官网" }), exp: { l1: "研究所", l2: "phd", l3: ["计算神经科学"] } },
  { e: mkEntry({ id: "c13", title: "复旦大学脑疾病博士招生", body: "复旦大学脑疾病研究中心博士招生。", source: "复旦大学官网" }), exp: { l1: "高校", l2: "phd", l3: ["脑疾病"] } },
  { e: mkEntry({ id: "c17", title: "北京大学心理学系博士招生", body: "北大心理学系认知神经科学博士招生。", source: "北大官网" }), exp: { l1: "高校", l2: "phd", l3: ["认知神经科学"] } },
  { e: mkEntry({ id: "c20", title: "中国科学技术大学 fMRI 博士项目", body: "中科大 fMRI 研究中心博士招生。", source: "中科大官网" }), exp: { l1: "高校", l2: "phd", l3: ["fMRI"] } },
  { e: mkEntry({ id: "c26", title: "西湖大学博士招生", body: "西湖大学博士招生，脑机接口方向。", source: "西湖大学官网" }), exp: { l1: "高校", l2: "phd", l3: ["脑机接口"] } },
  { e: mkEntry({ id: "c27", title: "中科院心理研究所 EEG 博士招生", body: "心理研究所 EEG 方向博士招生。", source: "心理所官网" }), exp: { l1: "研究所", l2: "phd", l3: ["EEG"] } },
  // —— L2=joint_phd（联培抑制博士→phd）——
  { e: mkEntry({ id: "c08", title: "MIT 脑成像联培博士项目", body: "MIT 与合作院校联合培养脑成像方向博士。", source: "MIT 官网" }), exp: { l1: "高校", l2: "joint_phd", l3: ["脑成像"] } },
  { e: mkEntry({ id: "c09", title: "牛津大学 fMRI 联合培养博士招生", body: "牛津大学 fMRI 中心联合培养博士。", source: "牛津大学官网" }), exp: { l1: "高校", l2: "joint_phd", l3: ["fMRI"] } },
  { e: mkEntry({ id: "c25", title: "普林斯顿大学联培博士", body: "普林斯顿大学联培博士，脑成像方向。", source: "普林斯顿官网" }), exp: { l1: "高校", l2: "joint_phd", l3: ["脑成像"] } },
  // —— L2=ra ——
  { e: mkEntry({ id: "c06", title: "科技部重点研发计划脑疾病研究助理招聘", body: "重点研发专项招聘脑疾病方向研究助理。", source: "科技部官网" }), exp: { l1: "政府项目", l2: "ra", l3: ["脑疾病"] } },
  { e: mkEntry({ id: "c07", title: "国家自然科学基金委 EEG 研究项目助理招聘", body: "基金委资助项目招聘 EEG 实验助理。", source: "基金委官网" }), exp: { l1: "政府项目", l2: "ra", l3: ["EEG"] } },
  { e: mkEntry({ id: "c10", title: "剑桥大学神经影像研究助理招聘", body: "剑桥大学神经影像实验室招聘研究助理 RA。", source: "剑桥大学官网" }), exp: { l1: "高校", l2: "ra", l3: ["神经影像"] } },
  { e: mkEntry({ id: "c15", title: "中科院神经科学研究所 RA 招聘", body: "神经科学研究所认知神经科学方向招聘研究助理。", source: "中科院" }), exp: { l1: "研究所", l2: "ra", l3: ["认知神经科学"] } },
  { e: mkEntry({ id: "c19", title: "浙江大学医学院 EEG 研究助理招聘", body: "浙大医学院招聘 EEG 方向研究助理。", source: "浙大官网" }), exp: { l1: "高校", l2: "ra", l3: ["EEG"] } },
  { e: mkEntry({ id: "c22", title: "重点研发计划神经调控方向 RA 招聘", body: "重点研发计划招聘神经调控方向研究助理。", source: "科技部" }), exp: { l1: "政府项目", l2: "ra", l3: ["神经调控"] } },
  // —— L2=campus ——
  { e: mkEntry({ id: "c11", title: "某科技公司机器人方向校园招聘", body: "公司招聘脑机接口算法工程师，校招通道。", source: "公司官网" }), exp: { l1: "企业", l2: "campus", l3: ["脑机接口"] } },
  { e: mkEntry({ id: "c18", title: "华为公司 2026 届校园招聘", body: "华为公司校园招聘脑机接口工程师。", source: "华为官网" }), exp: { l1: "企业", l2: "campus", l3: ["脑机接口"] } },
  { e: mkEntry({ id: "c24", title: "字节跳动校园招聘类脑智能研究员", body: "字节跳动校招类脑智能方向研究员。", source: "字节跳动公司官网" }), exp: { l1: "企业", l2: "campus", l3: ["类脑智能"] } },
  // —— L2=intern ——
  { e: mkEntry({ id: "c05", title: "Neuralink 公司脑机接口实习生招聘", body: "Neuralink 脑机接口团队招聘实习生。", source: "Neuralink 官网" }), exp: { l1: "企业", l2: "intern", l3: ["脑机接口"] } },
  { e: mkEntry({ id: "c12", title: "DeepTech 有限公司神经调控实习岗位", body: "有限公司神经调控产品组招聘实习生。", source: "公司官网" }), exp: { l1: "企业", l2: "intern", l3: ["神经调控"] } },
  { e: mkEntry({ id: "c16", title: "腾讯公司 AI 实习生招聘", body: "腾讯公司招聘 AI 方向实习生，参与脑机接口项目。", source: "腾讯官网" }), exp: { l1: "企业", l2: "intern", l3: ["脑机接口"] } },
  { e: mkEntry({ id: "c21", title: "商汤公司神经影像算法实习生", body: "商汤公司神经影像组招聘实习生。", source: "商汤官网" }), exp: { l1: "企业", l2: "intern", l3: ["神经影像"] } },
  { e: mkEntry({ id: "c28", title: "MIT 脑成像暑期实习生", body: "MIT 脑成像中心暑期实习生招聘。", source: "MIT 官网" }), exp: { l1: "高校", l2: "intern", l3: ["脑成像"] } },
  // —— L2=research（含访问学者暂归）——
  { e: mkEntry({ id: "c14", title: "上海科技大学访问学者计划", body: "上科大邀请访问学者开展脑成像合作研究。", source: "上科大官网" }), exp: { l1: "高校", l2: "research", l3: ["脑成像"] } },
  { e: mkEntry({ id: "c23", title: "斯坦福大学计算神经科学访问学者", body: "斯坦福大学邀请计算神经科学访问学者。", source: "斯坦福官网" }), exp: { l1: "高校", l2: "research", l3: ["计算神经科学"] } },
  // —— 故意模糊 4 条：期望低置信（needsReview=true），但 L1/L2 标签仍可判定 ——
  { e: mkEntry({ id: "a01", title: "UCL 博士项目开放申请", body: "招生信息详见官网。", source: "UCL 官网" }), exp: { l1: "高校", l2: "phd", l3: [] }, lowConf: true },
  { e: mkEntry({ id: "a02", title: "UCL 脑机接口项目", body: "项目信息详见官网。", source: "未知来源小站" }), exp: { l1: "高校", l2: null, l3: ["脑机接口"] }, lowConf: true },
  { e: mkEntry({ id: "a03", title: "脑机接口博士奖学金", body: "fMRI 方向博士奖学金，详情咨询。", source: "测试来源站" }), exp: { l1: null, l2: "phd", l3: ["脑机接口", "fMRI"] }, lowConf: true },
  { e: mkEntry({ id: "a04", title: "某研究团队助理招聘", body: "招聘研究助理一名。", source: "未知小站" }), exp: { l1: null, l2: "ra", l3: [] }, lowConf: true },
];

// ── 验收集 2：去重（5 对已知跨来源重复 + 5 个 near-miss） ────────────────────
// 同一机会不同来源：标题相同或近似、机构名写法不同、截止日相同 → 应合并。
// near-miss：同机构不同类型 / 同名不同届 / 机构不同 / 相似度不足 / 机构未知 → 一个不并。

const DUP_PAIRS = [
  [
    mkEntry({ id: "d1a", title: "脑机接口博士奖学金 2026", body: "UCL 脑机接口博士奖学金，2026 年入学。", source: "UCL 官网", source_url: "https://ucl.ac.uk/a", org: "UCL", deadline: "2026-12-01", type: "phd", keywords: ["脑机接口"], last_verified: "2026-10-18T08:00:00.000Z" }),
    mkEntry({ id: "d1b", title: "脑机接口博士奖学金 2026", body: "伦敦大学学院脑机接口博士奖学金，2026 入学。", source: "伦敦大学学院招生页", source_url: "https://ucl.ac.uk/b", org: "伦敦大学学院", deadline: "2026-12-01", type: "phd", keywords: ["脑机接口"], last_verified: "2026-10-18T09:00:00.000Z" }),
  ],
  [
    mkEntry({ id: "d2a", title: "MIT 脑成像博士奖学金 2026", body: "MIT 脑成像方向博士奖学金。", source: "MIT 官网", source_url: "https://mit.edu/a", org: "MIT", deadline: "2026-11-15", type: "phd", keywords: ["脑成像"], last_verified: "2026-10-18T08:00:00.000Z" }),
    mkEntry({ id: "d2b", title: "2026 MIT 脑成像博士奖学金", body: "麻省理工学院脑成像博士奖学金。", source: "麻省理工学院招生页", source_url: "https://mit.edu/b", org: "麻省理工学院", deadline: "2026-11-15", type: "phd", keywords: ["脑成像"], last_verified: "2026-10-18T09:00:00.000Z" }),
  ],
  [
    mkEntry({ id: "d3a", title: "牛津大学 fMRI 研究助理招聘", body: "牛津大学 fMRI 中心招聘研究助理。", source: "牛津大学官网", source_url: "https://ox.ac.uk/a", org: "Oxford", deadline: "2026-10-30", type: "ra", keywords: ["fMRI"], last_verified: "2026-10-18T08:00:00.000Z" }),
    mkEntry({ id: "d3b", title: "牛津大学 fMRI 研究助理招聘", body: "University of Oxford fMRI 中心 RA 招聘。", source: "University of Oxford 招聘页", source_url: "https://ox.ac.uk/b", org: "University of Oxford", deadline: "2026-10-30", type: "ra", keywords: ["fMRI"], last_verified: "2026-10-18T09:00:00.000Z" }),
  ],
  [
    mkEntry({ id: "d4a", title: "剑桥大学神经影像暑期实习", body: "剑桥大学神经影像组暑期实习。", source: "剑桥大学官网", source_url: "https://cam.ac.uk/a", org: "Cambridge", deadline: "2026-09-01", type: "intern", keywords: ["神经影像"], last_verified: "2026-10-18T08:00:00.000Z" }),
    mkEntry({ id: "d4b", title: "剑桥大学神经影像暑期实习", body: "剑桥大学神经影像暑期实习生招募。", source: "剑桥大学招生页", source_url: "https://cam.ac.uk/b", org: "剑桥大学", deadline: "2026-09-01", type: "intern", keywords: ["神经影像"], last_verified: "2026-10-18T09:00:00.000Z" }),
  ],
  [
    mkEntry({ id: "d5a", title: "清华大学 EEG 博士项目", body: "清华大学 EEG 方向博士招生。", source: "清华大学官网", source_url: "https://tsinghua.edu.cn/a", org: "清华大学", deadline: "2026-12-20", type: "phd", keywords: ["EEG"], last_verified: "2026-10-18T08:00:00.000Z" }),
    mkEntry({ id: "d5b", title: "清华大学 EEG 博士项目", body: "Tsinghua University EEG 博士招生。", source: "Tsinghua University 招生页", source_url: "https://tsinghua.edu.cn/b", org: "Tsinghua University", deadline: "2026-12-20", type: "phd", keywords: ["EEG"], last_verified: "2026-10-18T09:00:00.000Z" }),
  ],
];

const NEAR_MISS = [
  // 同机构、标题近似，但类型不同（博士 vs 助理）→ 不并
  mkEntry({ id: "n1a", title: "UCL 脑机接口博士项目", body: "UCL 脑机接口博士招生。", source: "UCL 官网", org: "UCL", deadline: "2026-12-01", type: "phd", keywords: ["脑机接口"] }),
  mkEntry({ id: "n1b", title: "UCL 脑机接口研究助理项目", body: "UCL 脑机接口研究助理招聘。", source: "UCL 招聘页", org: "UCL", deadline: "2026-12-01", type: "ra", keywords: ["脑机接口"] }),
  // 同名不同届（截止日差一年）→ 不并
  mkEntry({ id: "n2a", title: "剑桥大学博士奖学金 2026", body: "剑桥大学 2026 博士奖学金。", source: "剑桥大学官网", org: "Cambridge", deadline: "2026-12-01", type: "phd", keywords: [] }),
  mkEntry({ id: "n2b", title: "剑桥大学博士奖学金 2027", body: "剑桥大学 2027 博士奖学金。", source: "剑桥大学官网", org: "Cambridge", deadline: "2027-12-01", type: "phd", keywords: [] }),
  // 标题相同但机构不同 → 不并
  mkEntry({ id: "n3a", title: "神经调控博士奖学金", body: "UCL 神经调控博士奖学金。", source: "UCL 官网", org: "UCL", deadline: "2026-12-01", type: "phd", keywords: ["神经调控"] }),
  mkEntry({ id: "n3b", title: "神经调控博士奖学金", body: "MIT 神经调控博士奖学金。", source: "MIT 官网", org: "MIT", deadline: "2026-12-01", type: "phd", keywords: ["神经调控"] }),
  // 相似度不足（暑期学校 vs 博士奖学金）→ 不并（用独立机构避免与其他条目干扰）
  mkEntry({ id: "n4a", title: "斯坦福脑机接口博士奖学金", body: "斯坦福脑机接口博士奖学金。", source: "斯坦福官网", org: "斯坦福", deadline: "2026-12-01", type: "phd", keywords: ["脑机接口"] }),
  mkEntry({ id: "n4b", title: "斯坦福脑机接口暑期学校", body: "斯坦福脑机接口暑期学校招生。", source: "斯坦福官网", org: "斯坦福", deadline: "2026-07-01", type: "phd", keywords: ["脑机接口"] }),
  // 机构未知（无 orgOf）→ fail-closed 不并（标题完全相同也不并）
  mkEntry({ id: "n5a", title: "脑机接口博士奖学金 2026", body: "某机构脑机接口博士奖学金。", source: "来源A", deadline: "2026-12-01", type: "phd", keywords: ["脑机接口"] }),
  mkEntry({ id: "n5b", title: "脑机接口博士奖学金 2026", body: "某机构脑机接口博士奖学金。", source: "来源B", deadline: "2026-12-01", type: "phd", keywords: ["脑机接口"] }),
];

// ── 验收集 3：关联（15 条历史 + 8 条新条目；6 条应关联，2 条负对照） ──────────

const LINK_HISTORY = [
  mkEntry({ id: "h01", title: "UCL 脑机接口实验室开放日", body: "UCL 脑机接口实验室开放日活动。", source: "UCL 官网", org: "UCL", keywords: ["脑机接口"], last_verified: "2026-09-01T08:00:00.000Z" }),
  mkEntry({ id: "h02", title: "伦敦大学学院神经调控研讨会", body: "伦敦大学学院神经调控研讨会。", source: "伦敦大学学院官网", org: "伦敦大学学院", keywords: ["神经调控"], last_verified: "2026-09-02T08:00:00.000Z" }),
  mkEntry({ id: "h03", title: "UCL fMRI 中心博士项目", body: "UCL fMRI 中心博士招生。", source: "UCL 官网", org: "UCL", keywords: ["fMRI"], last_verified: "2026-09-03T08:00:00.000Z" }),
  mkEntry({ id: "h04", title: "MIT 脑成像研究", body: "MIT 脑成像方向研究进展。", source: "MIT 官网", org: "MIT", keywords: ["脑成像"], last_verified: "2026-09-04T08:00:00.000Z" }),
  mkEntry({ id: "h05", title: "MIT 类脑智能研讨会", body: "MIT 类脑智能研讨会。", source: "MIT 官网", org: "MIT", keywords: ["类脑智能"], last_verified: "2026-09-05T08:00:00.000Z" }),
  mkEntry({ id: "h06", title: "清华大学脑机接口团队", body: "清华大学脑机接口团队介绍。", source: "清华大学官网", org: "清华大学", keywords: ["脑机接口"], last_verified: "2026-09-06T08:00:00.000Z" }),
  mkEntry({ id: "h07", title: "清华大学 EEG 实验室", body: "清华大学 EEG 实验室介绍。", source: "清华大学官网", org: "清华大学", keywords: ["EEG"], last_verified: "2026-09-07T08:00:00.000Z" }),
  mkEntry({ id: "h08", title: "牛津认知神经科学讲座", body: "牛津大学认知神经科学公开讲座。", source: "牛津大学官网", org: "牛津大学", keywords: ["认知神经科学"], last_verified: "2026-09-08T08:00:00.000Z" }),
  mkEntry({ id: "h09", title: "剑桥计算神经科学项目", body: "剑桥大学计算神经科学项目。", source: "剑桥大学官网", org: "剑桥大学", keywords: ["计算神经科学"], last_verified: "2026-09-09T08:00:00.000Z" }),
  mkEntry({ id: "h10", title: "北大脑疾病研究中心", body: "北京大学脑疾病研究中心。", source: "北大官网", org: "北京大学", keywords: ["脑疾病"], last_verified: "2026-09-10T08:00:00.000Z" }),
  mkEntry({ id: "h11", title: "复旦神经影像项目", body: "复旦大学神经影像项目，导师张三。", source: "复旦大学官网", org: "复旦大学", keywords: ["神经影像"], mentor: ["张三"], last_verified: "2026-09-11T08:00:00.000Z" }),
  mkEntry({ id: "h12", title: "浙大脑机接口项目", body: "浙江大学脑机接口项目，PI 张三。", source: "浙大官网", org: "浙江大学", keywords: ["脑机接口"], mentor: ["张三"], last_verified: "2026-09-12T08:00:00.000Z" }),
  mkEntry({ id: "h13", title: "上交 EEG 项目", body: "上海交大 EEG 项目，李四教授主持。", source: "上交官网", org: "上海交大", keywords: ["EEG"], mentor: ["李四"], last_verified: "2026-09-13T08:00:00.000Z" }),
  mkEntry({ id: "h14", title: "中科院 fMRI 数据集", body: "中科院发布 fMRI 公开数据集。", source: "中科院官网", org: "中科院", keywords: ["fMRI"], last_verified: "2026-09-14T08:00:00.000Z" }),
  mkEntry({ id: "h15", title: "斯坦福脑成像公开课", body: "斯坦福大学脑成像公开课。", source: "斯坦福官网", org: "斯坦福", keywords: ["脑成像"], last_verified: "2026-09-15T08:00:00.000Z" }),
];

const LINK_NEW = [
  // l1：同机构（UCL=伦敦大学学院）→ h01/h02/h03
  mkEntry({ id: "l1", title: "UCL 脑机接口博士项目新增", body: "UCL 新增脑机接口博士项目。", source: "验收来源1", org: "UCL", keywords: ["脑机接口"] }),
  // l2：同领域（脑机接口）→ h01/h06/h12
  mkEntry({ id: "l2", title: "脑机接口研究助理招聘", body: "招聘脑机接口方向研究助理。", source: "验收来源2", keywords: ["脑机接口"] }),
  // l3：同导师（张三）→ h11/h12
  mkEntry({ id: "l3", title: "张三团队新项目", body: "张三团队启动新项目。", source: "验收来源3", keywords: ["量子计算"], mentor: ["张三"] }),
  // l4：同机构 MIT + 同领域 fMRI → h04/h05/h03/h14
  mkEntry({ id: "l4", title: "MIT fMRI 博士后项目", body: "MIT fMRI 中心博士后项目。", source: "验收来源4", org: "MIT", keywords: ["fMRI"] }),
  // l5：同机构（清华大学）→ h06/h07
  mkEntry({ id: "l5", title: "清华大学 EEG 暑期学校", body: "清华大学 EEG 暑期学校招生。", source: "验收来源5", org: "清华大学", keywords: ["EEG"] }),
  // l6：同导师（李四）+ 同领域（脑成像）→ h13/h04/h09/h15
  mkEntry({ id: "l6", title: "李四教授新课题", body: "李四教授启动脑成像新课题。", source: "验收来源6", keywords: ["脑成像"], mentor: ["李四"] }),
  // l7/l8：负对照——机构、领域、导师三路皆无命中，期望 0 条链接
  mkEntry({ id: "l7", title: "野鸡大学量子计算讲座", body: "某某野鸡大学量子计算讲座通知。", source: "验收来源7", org: "某某野鸡大学", keywords: ["量子计算"] }),
  mkEntry({ id: "l8", title: "野鸡学院区块链课程", body: "另一所野鸡学院区块链课程。", source: "验收来源8", org: "另一所野鸡学院", keywords: ["区块链"] }),
];
const LINK_EXPECTED = ["l1", "l2", "l3", "l4", "l5", "l6"];
const LINK_NEGATIVE = ["l7", "l8"];

// ── 验收测试 ─────────────────────────────────────────────────────────────

test("验收1/5 · 归类准确率 ≥0.90（32 条，含 4 条故意模糊的 hard case 计入分母）", () => {
  let correct = 0;
  const wrong = [];
  let lowConfFlagged = 0;
  for (const c of CLASSIFY_CASES) {
    const got = classify(c.e).classification;
    const l3ok = c.exp.l3.every((t) => got.l3.includes(t));
    const ok = got.l1 === c.exp.l1 && got.l2 === c.exp.l2 && l3ok;
    if (ok) correct++;
    else wrong.push(`${c.e.id}(得 l1=${got.l1} l2=${got.l2} l3=[${got.l3}])`);
    if (c.lowConf) {
      assert.equal(got.needsReview, true, `${c.e.id} 应为低置信待确认`);
      lowConfFlagged++;
    }
  }
  const acc = correct / CLASSIFY_CASES.length;
  console.log(`  归类准确率 = ${acc.toFixed(3)} (${correct}/${CLASSIFY_CASES.length})；低置信正确标记 ${lowConfFlagged}/4`);
  assert.ok(acc >= 0.9, `验收1 未达标：归类准确率 ${acc.toFixed(3)} < 0.90，错项: ${wrong.join("；")}`);
});

test("验收2/5 · 去重召回率 ≥0.80，且 5 个 near-miss 零误合并", () => {
  const drafts = [...DUP_PAIRS.flat(), ...NEAR_MISS];
  const r = runAutoOrganize({
    drafts,
    history: [],
    state: initialPipelineState(),
    accessors: ACCESSORS,
    nowIso: "2026-10-18T10:00:00.000Z",
  });
  const recall = r.stats.fuzzyMerges / DUP_PAIRS.length;
  console.log(`  去重召回率 = ${recall.toFixed(3)}（合并 ${r.stats.fuzzyMerges}/${DUP_PAIRS.length} 对）；精确去重吸收 ${r.stats.exactMerges}（期望 0，source 不同）`);
  assert.equal(r.stats.exactMerges, 0, "精确去重不应吸收（各对 source 不同）");
  assert.ok(recall >= 0.8, `验收2 未达标：去重召回率 ${recall} < 0.80`);
  // 零误合并：10 个 near-miss 条目必须全部存活（在 pending，未被吸收）
  const pendingIds = new Set(r.pending.map((p) => p.id));
  const droppedIds = new Set(r.dropped.map((d) => d.id));
  for (const nm of NEAR_MISS) {
    assert.ok(pendingIds.has(nm.id), `near-miss ${nm.id} 被误合并`);
    assert.ok(!droppedIds.has(nm.id), `near-miss ${nm.id} 出现在 dropped`);
  }
  console.log(`  near-miss 零误合并 ✓（10/10 存活）；pending=${r.pending.length}, dropped=${r.dropped.length}`);
});

test("验收2b/5 · 证据链完整（合并复合体多源可追溯）", () => {
  const [d1a, d1b] = DUP_PAIRS[0];
  const r = runAutoOrganize({
    drafts: [d1a, d1b],
    history: [],
    state: initialPipelineState(),
    accessors: ACCESSORS,
    nowIso: "2026-10-18T10:00:00.000Z",
  });
  const comp = r.pending.find((p) => (p.reviewReasons || []).includes("fuzzy_merged"));
  assert.ok(comp, "应产出 fuzzy_merged 复合条目");
  assert.deepEqual(new Set(comp.sources), new Set(["UCL 官网", "伦敦大学学院招生页"]), "sources 应覆盖全部来源");
  assert.deepEqual(new Set(comp.sourceUrls), new Set(["https://ucl.ac.uk/a", "https://ucl.ac.uk/b"]), "sourceUrls 应覆盖全部链接");
  assert.ok(comp.mergeEvidence, "应带合并证据");
  assert.deepEqual(new Set(comp.mergeEvidence.mergedIds), new Set(["d1a"]), "证据应记录被吸收条目");
  assert.equal(comp.needsReview, true, "合并复合体必须待人工确认");
  console.log(`  证据链完整 ✓：sources=[${[...comp.sources].join(", ")}]，mergedIds=[${comp.mergeEvidence.mergedIds}]`);
});

test("验收3/5 · 关联覆盖率（6 条应关联各 ≥1 条链接；2 条负对照 0 条）", () => {
  const r = runAutoOrganize({
    drafts: LINK_NEW,
    history: LINK_HISTORY,
    state: initialPipelineState(),
    accessors: ACCESSORS,
    nowIso: "2026-10-18T10:00:00.000Z",
  });
  const byId = new Map(r.pending.map((p) => [p.id, p]));
  let linked = 0;
  for (const id of LINK_EXPECTED) {
    const p = byId.get(id);
    assert.ok(p, `${id} 应在 pending`);
    const n = p.related.length;
    const rels = [...new Set(p.related.map((x) => x.relation))].join(",");
    console.log(`  ${id}: ${n} 条链接 [${rels}]`);
    if (n >= 1) linked++;
  }
  for (const id of LINK_NEGATIVE) {
    const p = byId.get(id);
    assert.ok(p, `${id} 应在 pending`);
    assert.equal(p.related.length, 0, `负对照 ${id} 应 0 条链接，实际 ${p.related.length}`);
  }
  const coverage = linked / LINK_EXPECTED.length;
  console.log(`  关联覆盖率 = ${coverage.toFixed(3)} (${linked}/${LINK_EXPECTED.length})；负对照 0 链接 ✓`);
  assert.equal(coverage, 1, `验收3 未达标：关联覆盖率 ${coverage} < 1`);
});

test("验收4/5 · 增量：第二轮空操作，变更条目被重新处理", () => {
  const drafts = LINK_NEW;
  const history = LINK_HISTORY;
  const r1 = runAutoOrganize({ drafts, history, state: initialPipelineState(), accessors: ACCESSORS, nowIso: "2026-10-18T10:00:00.000Z" });
  assert.equal(r1.stats.processed, drafts.length, "首轮应全量处理");
  assert.equal(r1.stats.fullRecompute, true, "首轮 ruleVersion 变化应标记全量");
  const r2 = runAutoOrganize({ drafts, history, state: r1.state, accessors: ACCESSORS, nowIso: "2026-10-18T10:00:00.000Z" });
  console.log(`  第二轮 processed=${r2.stats.processed}, skipped=${r2.stats.skipped}, pending=${r2.pending.length}`);
  assert.equal(r2.stats.processed, 0, "无变化的第二轮应空操作");
  assert.equal(r2.stats.skipped, drafts.length);
  assert.equal(r2.pending.length, 0);
  assert.equal(r2.stats.fullRecompute, false, "第二轮不应全量回算");
  // 变更一条：last_verified 推进 → 第三轮只处理它
  const bumped = drafts.map((d) =>
    d.id === "l1" ? { ...d, last_verified: "2026-10-18T11:00:00.000Z" } : d,
  );
  const r3 = runAutoOrganize({ drafts: bumped, history, state: r2.state, accessors: ACCESSORS, nowIso: "2026-10-18T12:00:00.000Z" });
  console.log(`  第三轮（l1 变更） processed=${r3.stats.processed}, skipped=${r3.stats.skipped}`);
  assert.equal(r3.stats.processed, 1, "只应重新处理变更的 1 条");
  assert.equal(r3.pending.length, 1);
  assert.equal(r3.pending[0].id, "l1");
});

test("验收5/5 · 人工确认闸门完好（PRD-017 不被破坏）", () => {
  // 配置未被篡改：日报沉淀仍要求人工确认
  assert.equal(WIKI_PIPELINE_CONFIG.dailyReport.requireHumanConfirm, true, "PRD-017 闸门配置被改动");
  const drafts = [...DUP_PAIRS.flat(), ...LINK_NEW];
  const history = [...LINK_HISTORY];
  const histSnap = JSON.stringify(history);
  const draftSnap = JSON.stringify(drafts);
  const r = runAutoOrganize({
    drafts,
    history,
    state: initialPipelineState(),
    accessors: ACCESSORS,
    nowIso: "2026-10-18T10:00:00.000Z",
  });
  // 历史只读、输入不被修改
  assert.equal(JSON.stringify(history), histSnap, "history 被流水线修改");
  assert.equal(JSON.stringify(drafts), draftSnap, "drafts 被流水线修改");
  // 每条 pending 都有归类解释（人工确认时可审计）
  for (const p of r.pending) {
    assert.ok(p.classification, `${p.id} 缺少归类结果`);
    assert.ok(Array.isArray(p.classification.hits), `${p.id} 缺少命中词解释`);
    assert.ok(typeof p.classification.confidence === "number", `${p.id} 缺少置信度`);
  }
  // 待确认区语义：selected 的每条去向明确（pending 或 dropped），无自动入库
  assert.equal(r.pending.length + r.dropped.length, r.stats.processed, "条目去向不明：有条目既不在 pending 也不在 dropped");
  assert.ok(r.pending.length > 0, "pending 不应为空");
  console.log(`  闸门完好 ✓：pending=${r.pending.length}（全待人工确认）, dropped=${r.dropped.length}（审计）, processed=${r.stats.processed}；history/drafts 零修改；requireHumanConfirm=true`);
});
