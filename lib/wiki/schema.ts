/**
 * PRD-017/T2 · Wiki 条目 schema（T1 设计的可执行版本）。
 *
 * T1 设计：trend #66 / brain-27 PR #16《docs/plans/2026-10-17-wiki-schema.md》。
 * 本模块把 schema 落成类型 + 校验函数，供检索层（rag.ts）与后续 T3/T4/T5 消费。
 *
 * 约定：只用可擦除 TypeScript 语法（无 enum），保证 `node --test` 可直接运行。
 */

// ── 枚举：复用 PRD-018（brain-27 PR #17 只读 MCP 接口设计）的定义 ─────────────
// review comment 2：type / region / funding 三个过滤面必须与 PRD-018 枚举一致，
// 不自行发明新词。

/** 地区枚举（PRD-018 search_opportunities.region）。 */
export const WIKI_REGIONS = ["英国", "中国大陆", "中国香港", "爱尔兰", "全球"] as const;
export type WikiRegion = (typeof WIKI_REGIONS)[number];

/** 机会类型枚举（PRD-018 search_opportunities.type）。 */
export const WIKI_OPPORTUNITY_TYPES = ["phd", "joint_phd", "ra", "campus", "intern", "research"] as const;
export type WikiOpportunityType = (typeof WIKI_OPPORTUNITY_TYPES)[number];

/** 资助类型枚举（PRD-018 search_opportunities.funding）。 */
export const WIKI_FUNDINGS = ["full", "partial", "mixed", "self", "tbd"] as const;
export type WikiFunding = (typeof WIKI_FUNDINGS)[number];

/** 来源类型（T1 schema source_type）。 */
export const WIKI_SOURCE_TYPES = ["d1_snapshot", "daily_report", "conference_calendar", "manual"] as const;
export type WikiSourceType = (typeof WIKI_SOURCE_TYPES)[number];

/** 可信度（T1 schema confidence）。 */
export const WIKI_CONFIDENCES = ["high", "medium", "low"] as const;
export type WikiConfidence = (typeof WIKI_CONFIDENCES)[number];

/** 条目状态（T1 schema status）。 */
export const WIKI_STATUSES = ["active", "expired", "merged"] as const;
export type WikiStatus = (typeof WIKI_STATUSES)[number];

// ── 审核结论 verdict → confidence 映射（review comment 1）────────────────────
// T1 评审意见：confidence 必须从审核结论的 verdict 映射而来，不能是"审核过 ⇒ high"。
// 证实 confirmed → high；待核验 pending → medium；证伪 debunked / 传闻 rumor → low。

export const WIKI_VERDICTS = ["confirmed", "pending", "debunked", "rumor"] as const;
export type WikiVerdict = (typeof WIKI_VERDICTS)[number];

const VERDICT_TO_CONFIDENCE: Record<WikiVerdict, WikiConfidence> = {
  confirmed: "high",
  pending: "medium",
  debunked: "low",
  rumor: "low",
};

/** 审核结论 → 条目可信度。 */
export function verdictToConfidence(verdict: WikiVerdict): WikiConfidence {
  return VERDICT_TO_CONFIDENCE[verdict];
}

/** 检索排序权重（T1 纪律：low 默认降权、不进 Top 结果，见 rag.ts）。 */
export const CONFIDENCE_WEIGHTS: Record<WikiConfidence, number> = {
  high: 1.0,
  medium: 0.7,
  low: 0.35,
};

// ── 真实性复核状态（PRD-176/T1 §2.1；展示口径 §3.3）────────────────────────
// 三态（trusted/pending/suspicious）是复核结论值域；unverified 只表示
// "从未复核"，单列第五态（T1 §2.1：不把"未复核"冒充"复核中"）。

export const AUTHENTICITY_STATES = ["unverified", "trusted", "pending", "suspicious"] as const;
export type WikiAuthenticityState = (typeof AUTHENTICITY_STATES)[number];

/** 非法/缺失值返回 undefined（由消费方决定缺省口径，MCP 层缺省 unverified）。 */
export function normalizeAuthenticityState(value: unknown): WikiAuthenticityState | undefined {
  return typeof value === "string" && (AUTHENTICITY_STATES as readonly string[]).includes(value)
    ? (value as WikiAuthenticityState)
    : undefined;
}

// ── 条目类型 ────────────────────────────────────────────────────────────────

export type WikiFacets = {
  type?: WikiOpportunityType;
  region?: WikiRegion;
  funding?: WikiFunding;
  /**
   * 方向关键词（自由词，如 "脑机接口"）；type / region / funding 三个
   * 结构化面必须用上面的枚举（review comment 2）。
   */
  keywords?: string[];
};

export type WikiEntry = {
  id: string;
  title: string;
  /** 来源名称，如 "UCL 官网博士招生页"。 */
  source: string;
  source_url: string;
  source_type: WikiSourceType;
  /** D1 证据链接；S1（d1_snapshot）必填，其余可选。 */
  d1_evidence: string | null;
  confidence: WikiConfidence;
  /** ISO 日期。 */
  created: string;
  /** ISO 日期：最后核验日期。 */
  last_verified: string;
  status: WikiStatus;
  facets: WikiFacets;
  /** 正文，不超过 300 字（T1 schema）。 */
  body: string;
};

export type EntryIssue = {
  field: string;
  message: string;
};

const BODY_MAX_CHARS = 300;

/** 校验条目是否符合 schema；返回问题列表，空数组 = 通过。 */
export function validateEntry(entry: WikiEntry): EntryIssue[] {
  const issues: EntryIssue[] = [];
  if (!entry.id) issues.push({ field: "id", message: "id 不能为空" });
  if (!entry.title) issues.push({ field: "title", message: "title 不能为空" });
  if (!(WIKI_SOURCE_TYPES as readonly string[]).includes(entry.source_type)) {
    issues.push({ field: "source_type", message: `非法 source_type: ${entry.source_type}` });
  }
  if (!(WIKI_CONFIDENCES as readonly string[]).includes(entry.confidence)) {
    issues.push({ field: "confidence", message: `非法 confidence: ${entry.confidence}` });
  }
  if (!(WIKI_STATUSES as readonly string[]).includes(entry.status)) {
    issues.push({ field: "status", message: `非法 status: ${entry.status}` });
  }
  const { facets } = entry;
  if (facets.type !== undefined && !(WIKI_OPPORTUNITY_TYPES as readonly string[]).includes(facets.type)) {
    issues.push({ field: "facets.type", message: `非法 type（须复用 PRD-018 枚举）: ${facets.type}` });
  }
  if (facets.region !== undefined && !(WIKI_REGIONS as readonly string[]).includes(facets.region)) {
    issues.push({ field: "facets.region", message: `非法 region（须复用 PRD-018 枚举）: ${facets.region}` });
  }
  if (facets.funding !== undefined && !(WIKI_FUNDINGS as readonly string[]).includes(facets.funding)) {
    issues.push({ field: "facets.funding", message: `非法 funding（须复用 PRD-018 枚举）: ${facets.funding}` });
  }
  // S1（d1_snapshot）证据必填：只引用不复制，链不能断。
  if (entry.source_type === "d1_snapshot" && !entry.d1_evidence) {
    issues.push({ field: "d1_evidence", message: "source_type=d1_snapshot 时 d1_evidence 必填" });
  }
  if ([...entry.body].length > BODY_MAX_CHARS) {
    issues.push({ field: "body", message: `正文超过 ${BODY_MAX_CHARS} 字` });
  }
  return issues;
}
