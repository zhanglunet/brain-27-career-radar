/**
 * PRD-061/T4 · 归类引擎（trend #279）。
 *
 * T1（trend #272）是纯设计文档（docs/plans/2026-10-18-autoclass-rules.md），
 * 归类引擎没有单独的任务，于是落在 T4 与增量流水线一起实现。本模块是
 * T1 设计 §二–§四 的可执行版本：三层分类体系（L1 机构类型 / L2 机会类型 /
 * L3 领域标签）+ 关键词词典 + 置信度闸门。
 *
 * 设计要点（T1 §三）：
 * - 输入文本 = title + "\n" + body + "\n" + source；
 * - 每层独立计分；L1/L2 单选（命中多条取置信度最高者；平局时更长命中词
 *   优先——如"研究所"胜过"科学院"中的"学院"——仍平局按词典顺序），
 *   L3 多选（得分过阈的全收）；
 * - 机构白名单优先于关键词（白名单命中直接定 L1，不参与权重竞争）。
 *
 * 实现注记（相对 T1 文档的诚实偏差）：
 * - T1 写"分词复用 rag.ts 的 tokenize"。tokenize 是中文 bigram（"实验室"→
 *   "实验"+"验室"），3 字以上中文词无法作为整体命中 token 集合。
 *   本实现：term 命中 = token 集合命中 OR 归一化文本子串命中（ASCII 词用
 *   词边界）。两条都是确定性的；分词口径仍与检索层一致。
 * - "每层得分 = 命中词权重和 / 满分（取 1.0 归一）"按字面实现：
 *   score = min(1, Σ命中权重 / 1.0)。种子词典权重全为 1.0，故单命中即 1.0；
 *   公式为后续权重调优留出空间。
 * - L3 层得分：取被接受词项中的最高分（无命中为 0）；词项接受阈值 = 得分 > 0。
 * - "低可信来源"：T1 未定义判定法。v0.1 启发式见 LOW_TRUST_SOURCE_HINTS，
 *   可经 opts.isLowTrustSource 覆盖。
 *
 * 纪律（T1 §四 + PRD-017）：
 * - 闸门只决定"人工看多细"，不决定"是否入库"：confidence < 0.7 →
 *   needsReview=true（低置信待确认，逐条核对）；入库永远要人工确认
 *  （requireHumanConfirm），本模块不碰入库逻辑。
 * - L1 无法判定 → null，不硬编（扣分见惩罚项）。
 * - 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），node --test 可直接运行。
 */

import type { WikiEntry, WikiOpportunityType } from "./schema.ts";
import { WIKI_DIRECTIONS } from "../mcp/tools.ts";
import { tokenize } from "./rag.ts";

// ── 常量 ────────────────────────────────────────────────────────────────

/** 规则版本：增量流水线的全量回算只认这个版本号（见 auto-organize.ts）。 */
export const CLASSIFY_RULE_VERSION = "0.1";

/** 综合置信度权重（T1 §四初值：L3 信息量最大，权重最高）。 */
export const CLASSIFY_WEIGHTS = { l1: 0.3, l2: 0.3, l3: 0.4 } as const;

/** 置信度闸门（T1 §四初值）：< 0.7 → 低置信待确认（needsReview=true）。 */
export const CONFIDENCE_GATE = 0.7;

/** L1 机构类型（T1 §二：新轴，与 region 地理维度正交）。 */
export const ORG_TYPES = ["高校", "研究所", "企业", "政府项目"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

// ── 词典 ────────────────────────────────────────────────────────────────

export type DictTerm<TValue extends string = string> = {
  term: string;
  value: TValue;
  weight: number;
};

export type ClassifierDicts = {
  /** 词 → L1（机构类型）。 */
  l1: DictTerm<OrgType>[];
  /** 词 → L2（值域 = WIKI_OPPORTUNITY_TYPES）。 */
  l2: DictTerm<WikiOpportunityType>[];
  /** 词 → L3（值域 = L3 词表，种子 = WIKI_DIRECTIONS v0.1）。 */
  l3: DictTerm<string>[];
  /** 机构名变体 → L1（T1 §三；T2 的机构名归一化白名单是它的前置资产）。 */
  orgAllowlist: Array<{ names: string[]; l1: OrgType }>;
};

/** L1 关键词（T1 §二初版，字面收录）。 */
const L1_DICT: DictTerm<OrgType>[] = [
  { term: "大学", value: "高校", weight: 1.0 },
  { term: "University", value: "高校", weight: 1.0 },
  { term: "学院", value: "高校", weight: 1.0 },
  { term: "研究所", value: "研究所", weight: 1.0 },
  { term: "研究院", value: "研究所", weight: 1.0 },
  { term: "Lab", value: "研究所", weight: 1.0 },
  { term: "实验室", value: "研究所", weight: 1.0 },
  { term: "公司", value: "企业", weight: 1.0 },
  { term: "Inc", value: "企业", weight: 1.0 },
  { term: "Ltd", value: "企业", weight: 1.0 },
  { term: "有限公司", value: "企业", weight: 1.0 },
  { term: "基金委", value: "政府项目", weight: 1.0 },
  { term: "科技部", value: "政府项目", weight: 1.0 },
  { term: "重点研发", value: "政府项目", weight: 1.0 },
];

/**
 * L2 关键词（T1 §二初版，值域 = WIKI_OPPORTUNITY_TYPES）。
 * "访问学者/visiting → research"是 T1 定的暂归（等 postdoc/faculty 枚举扩展提案）。
 */
const L2_DICT: DictTerm<WikiOpportunityType>[] = [
  { term: "联培", value: "joint_phd", weight: 1.0 },
  { term: "联合培养", value: "joint_phd", weight: 1.0 },
  { term: "joint", value: "joint_phd", weight: 1.0 },
  { term: "博士", value: "phd", weight: 1.0 },
  { term: "PhD", value: "phd", weight: 1.0 },
  { term: "doctoral", value: "phd", weight: 1.0 },
  { term: "助理", value: "ra", weight: 1.0 },
  { term: "RA", value: "ra", weight: 1.0 },
  { term: "research assistant", value: "ra", weight: 1.0 },
  { term: "校招", value: "campus", weight: 1.0 },
  { term: "校园招聘", value: "campus", weight: 1.0 },
  { term: "campus", value: "campus", weight: 1.0 },
  { term: "实习", value: "intern", weight: 1.0 },
  { term: "intern", value: "intern", weight: 1.0 },
  { term: "访问学者", value: "research", weight: 1.0 },
  { term: "visiting", value: "research", weight: 1.0 },
];

/** 联培家族：出现这些词时，"博士/PhD/doctoral → phd"的映射被抑制（T1 §二）。 */
const JOINT_FAMILY = ["联培", "联合培养", "joint"];

/** L3 种子词典：WIKI_DIRECTIONS v0.1 逐字复用（T1 §二评审意见 2），1:1 映射。 */
const L3_DICT: DictTerm<string>[] = (WIKI_DIRECTIONS as readonly string[]).map(
  (d) => ({ term: d, value: d, weight: 1.0 }),
);

/**
 * 机构白名单种子（T1 §三 §七不确定项 4：冷启动种子，T5 从 D1 sources 表扩充）。
 * 与 T2 fuzzy-dedup.ts 的归一化白名单同源（同一批机构），此处多一个 →L1 映射。
 */
const ORG_ALLOWLIST: ClassifierDicts["orgAllowlist"] = [
  { names: ["UCL", "伦敦大学学院", "University College London"], l1: "高校" },
  { names: ["MIT", "麻省理工学院", "Massachusetts Institute of Technology"], l1: "高校" },
  { names: ["Oxford", "牛津大学", "University of Oxford"], l1: "高校" },
  { names: ["Cambridge", "剑桥大学", "University of Cambridge"], l1: "高校" },
  { names: ["清华大学", "Tsinghua University"], l1: "高校" },
];

export const DEFAULT_DICTS: ClassifierDicts = {
  l1: L1_DICT,
  l2: L2_DICT,
  l3: L3_DICT,
  orgAllowlist: ORG_ALLOWLIST,
};

/** 低可信来源启发式（T1 未定义判定法，v0.1 初值，可覆盖）。 */
const LOW_TRUST_SOURCE_HINTS = ["未知", "unknown", "rss", "feed"];

// ── 匹配 ────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAscii(s: string): boolean {
  return /^[\x00-\x7f]+$/.test(s);
}

/**
 * 词项命中：ASCII 词用词边界（防 "RA" 误命中 "moral" 之类），
 * CJK 词用子串。大小写不敏感（输入已小写化，CJK 不受影响）。
 */
function termHit(term: string, textNorm: string, tokens: Set<string>): boolean {
  const t = term.toLowerCase();
  if (tokens.has(t)) return true;
  if (isAscii(t)) return new RegExp(`\\b${escapeRegExp(t)}\\b`).test(textNorm);
  return textNorm.includes(t);
}

type LayerInput = { textNorm: string; tokens: Set<string> };

function matchDict<TValue extends string>(
  dict: DictTerm<TValue>[],
  input: LayerInput,
): Array<{ value: TValue; weight: number; term: string }> {
  const hits: Array<{ value: TValue; weight: number; term: string }> = [];
  for (const d of dict) {
    if (termHit(d.term, input.textNorm, input.tokens)) {
      hits.push({ value: d.value, weight: d.weight, term: d.term });
    }
  }
  return hits;
}

// ── 归类 ────────────────────────────────────────────────────────────────

export type Classification = {
  l1: OrgType | null;
  l2: WikiOpportunityType | null;
  /** L3 多选（无命中为空数组）。 */
  l3: string[];
  scores: { l1: number; l2: number; l3: number };
  /** 综合置信度 0~1（含惩罚项，下限 0）。 */
  confidence: number;
  /** 命中的词项（含白名单变体），人工确认时可审计。 */
  hits: string[];
  /** < 0.7 → 低置信待确认（逐条核对）。 */
  needsReview: boolean;
};

export type ClassifiedEntry = WikiEntry & { classification: Classification };

export type ClassifyOptions = {
  dicts?: ClassifierDicts;
  /** 低可信来源判定（缺省用 LOW_TRUST_SOURCE_HINTS 启发式）。 */
  isLowTrustSource?: (source: string) => boolean;
};

function defaultIsLowTrustSource(source: string): boolean {
  const s = source.toLowerCase();
  return LOW_TRUST_SOURCE_HINTS.some((h) => s.includes(h.toLowerCase()));
}

/**
 * 归类引擎：按 T1 设计 §二–§四 对单条目打三层分类 + 置信度。
 * 返回新对象（原条目不动），分类结果挂在 classification 上。
 */
export function classify(entry: WikiEntry, opts: ClassifyOptions = {}): ClassifiedEntry {
  const dicts = opts.dicts ?? DEFAULT_DICTS;
  const isLowTrustSource = opts.isLowTrustSource ?? defaultIsLowTrustSource;

  const text = `${entry.title}\n${entry.body}\n${entry.source}`;
  const textNorm = text.toLowerCase();
  const tokens = new Set(tokenize(text));
  const input: LayerInput = { textNorm, tokens };

  const titleNorm = entry.title.toLowerCase();
  const titleTokens = new Set(tokenize(entry.title));

  const hits: string[] = [];
  const titleHits: string[] = [];
  const recordHit = (term: string) => {
    hits.push(term);
    if (termHit(term, titleNorm, titleTokens)) titleHits.push(term);
  };

  // —— L1：白名单优先（命中直接定 L1，不参与权重竞争）——
  let l1: OrgType | null = null;
  let l1Score = 0;
  let allowHit: string | null = null;
  outer: for (const a of dicts.orgAllowlist) {
    for (const name of a.names) {
      if (termHit(name, textNorm, tokens)) {
        l1 = a.l1;
        l1Score = 1.0;
        allowHit = name;
        break outer;
      }
    }
  }
  if (allowHit) {
    recordHit(allowHit);
  } else {
    const l1Hits = matchDict(dicts.l1, input);
    // 按值聚合权重，取最高者；得分平局时更长的命中词优先（更具体的证据，
    // 如"研究所"胜过"科学院"里的"学院"），仍平局按词典顺序（确定性）。
    const byValue = new Map<OrgType, { score: number; maxLen: number }>();
    for (const h of l1Hits) {
      recordHit(h.term);
      const cur = byValue.get(h.value) ?? { score: 0, maxLen: 0 };
      cur.score += h.weight;
      if (h.term.length > cur.maxLen) cur.maxLen = h.term.length;
      byValue.set(h.value, cur);
    }
    let best: OrgType | null = null;
    let bestScore = 0;
    let bestLen = 0;
    for (const d of dicts.l1) {
      const agg = byValue.get(d.value);
      const s = Math.min(1, agg?.score ?? 0);
      const len = agg?.maxLen ?? 0;
      if (s > bestScore || (s === bestScore && s > 0 && len > bestLen)) {
        bestScore = s;
        bestLen = len;
        best = d.value;
      }
    }
    l1 = best;
    l1Score = bestScore;
  }

  // —— L2：值域 = WIKI_OPPORTUNITY_TYPES；联培家族抑制 phd ——
  const jointPresent = JOINT_FAMILY.some((t) =>
    termHit(t, textNorm, tokens),
  );
  const l2Hits = matchDict(dicts.l2, input).filter(
    (h) => !(h.value === "phd" && jointPresent),
  );
  const l2ByValue = new Map<WikiOpportunityType, { score: number; maxLen: number }>();
  for (const h of l2Hits) {
    recordHit(h.term);
    const cur = l2ByValue.get(h.value) ?? { score: 0, maxLen: 0 };
    cur.score += h.weight;
    if (h.term.length > cur.maxLen) cur.maxLen = h.term.length;
    l2ByValue.set(h.value, cur);
  }
  // 得分最高者胜；平局时更长命中词优先，仍平局按词典首次出现顺序（确定性）。
  const l2Order: WikiOpportunityType[] = [];
  for (const d of dicts.l2) {
    if (!l2Order.includes(d.value)) l2Order.push(d.value);
  }
  let l2: WikiOpportunityType | null = null;
  let l2Score = 0;
  let l2BestLen = 0;
  for (const v of l2Order) {
    const agg = l2ByValue.get(v);
    const s = Math.min(1, agg?.score ?? 0);
    const len = agg?.maxLen ?? 0;
    if (s > l2Score || (s === l2Score && s > 0 && len > l2BestLen)) {
      l2Score = s;
      l2BestLen = len;
      l2 = v;
    }
  }

  // —— L3：多选，得分 > 0 的全收；层得分取最高分 ——
  const l3ByValue = new Map<string, number>();
  for (const h of matchDict(dicts.l3, input)) {
    recordHit(h.term);
    l3ByValue.set(h.value, (l3ByValue.get(h.value) ?? 0) + h.weight);
  }
  const l3: string[] = [];
  let l3Score = 0;
  for (const [value, w] of l3ByValue) {
    const s = Math.min(1, w);
    if (s > 0) {
      l3.push(value);
      if (s > l3Score) l3Score = s;
    }
  }
  l3.sort();

  // —— 综合置信度 + 惩罚项（T1 §四）——
  let confidence =
    CLASSIFY_WEIGHTS.l1 * l1Score +
    CLASSIFY_WEIGHTS.l2 * l2Score +
    CLASSIFY_WEIGHTS.l3 * l3Score;
  if (l1 === null) confidence -= 0.1; // L1 未判定
  if (titleHits.length === 0) confidence -= 0.2; // 标题零命中
  if (isLowTrustSource(entry.source)) confidence -= 0.1; // 低可信来源
  confidence = Math.max(0, confidence);

  const needsReview = confidence < CONFIDENCE_GATE;

  const classification: Classification = {
    l1,
    l2,
    l3,
    scores: {
      l1: round2(l1Score),
      l2: round2(l2Score),
      l3: round2(l3Score),
    },
    confidence: round2(confidence),
    hits,
    needsReview,
  };
  return { ...entry, classification };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
