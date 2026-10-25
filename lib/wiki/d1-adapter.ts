/**
 * PRD-017/T5 · D1 适配器（trend #70）：D1 行 → WikiEntry。
 *
 * trend #70 要求：Wiki 条目与 D1 快照/候选记录双向链接——条目引用 D1 证据，
 * D1 记录可跳转 wiki 解读；不动现有 D1 采集流水线。
 *
 * D1 只读：本模块只做行 → 条目的纯映射，不写库。
 * 表结构依据 drizzle/migrations 原文：
 *   0000: opportunities / source_snapshots / review_queue / sources
 *   0003: candidate_records
 *   0018: intelligence_reports（T3 消费）
 *   0020: organization_candidates
 * kind（中文）→ type、location → region 的映射是适配器约定 v0.1
 * （KIND_TO_TYPE / locationToRegion），未知值不硬编 → 留空待人工/T4 补。
 *
 * 双向链接约定：条目 id 固定为 `wiki-d1-opp-{rowId}` / `wiki-d1-cand-{rowId}`，
 * 由 D1 行 id 可直接算出 wiki 条目 id；d1_evidence 指回 D1 行/快照。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */
import type {
  WikiEntry,
  WikiFunding,
  WikiOpportunityType,
  WikiRegion,
  WikiVerdict,
} from "./schema.ts";
import { normalizeAuthenticityState, verdictToConfidence } from "./schema.ts";
import type { WikiAuthenticityState } from "./schema.ts";

/** D1 opportunities 表行（0000_robust_iron_patriot.sql；authenticity_state 列来自 PRD-176/T2 迁移 0026）。 */
export type D1OpportunityRow = {
  id: string;
  source_id: string | null;
  name: string;
  org: string;
  kind: string;
  status: string;
  fit: string;
  location: string;
  deadline: string;
  why: string;
  action: string;
  tags_json: string;
  url: string;
  published: number;
  source_verified_at: string | null;
  created_at: string;
  /** 真实性复核状态（PRD-176/T2 列；旧调用方不选该列时缺省 → 条目不携带，MCP 层按 unverified 呈现）。 */
  authenticity_state?: string | null;
};

/** D1 candidate_records 表行（0003_futuristic_inhumans.sql）。 */
export type D1CandidateRow = {
  id: string;
  source_id: string;
  snapshot_id: string | null;
  canonical_url: string;
  dedupe_key: string;
  title: string;
  org: string;
  kind: string | null;
  location: string | null;
  deadline: string | null;
  opportunity_status: string | null;
  extracted_json: string;
  state: string;
  first_seen_at: string;
  last_seen_at: string;
};

/** D1 review_queue 表行（0000）。 */
export type D1ReviewRow = {
  id: string;
  status: string;
  reason: string;
  payload_json: string;
};

/** D1 sources 表行（0000，取 name/url 供条目来源展示）。 */
export type D1SourceRow = {
  id: string;
  name: string;
  url: string;
};

/**
 * D1 kind（中文）→ Wiki type（PRD-018 枚举）。
 * 未知 kind 不硬编 → undefined（人工确认或 T4 自维护时补）。
 */
export const KIND_TO_TYPE: Record<string, WikiOpportunityType> = {
  博士: "phd",
  联培博士: "joint_phd",
  联合培养博士: "joint_phd",
  科研助理: "ra",
  研究助理: "ra",
  校招: "campus",
  校园招聘: "campus",
  实习: "intern",
};

const MAINLAND_CITY_HINTS = [
  "北京",
  "上海",
  "深圳",
  "广州",
  "杭州",
  "南京",
  "武汉",
  "成都",
  "西安",
  "天津",
  "重庆",
  "苏州",
  "合肥",
  "长沙",
  "郑州",
  "青岛",
];

/**
 * D1 location → Wiki region（PRD-018 枚举）。
 * 规则按特例优先；无法判断的不硬编 → undefined。
 */
export function locationToRegion(location: string): WikiRegion | undefined {
  const l = (location || "").trim();
  if (!l) return undefined;
  if (l.includes("香港")) return "中国香港";
  if (l.includes("英国") || l.includes("伦敦")) return "英国";
  if (l.includes("爱尔兰") || l.includes("都柏林")) return "爱尔兰";
  if (l === "全球" || /remote/i.test(l)) return "全球";
  if (MAINLAND_CITY_HINTS.some((c) => l.includes(c))) return "中国大陆";
  return undefined;
}

/**
 * 审核结论映射：review_queue 行 → WikiVerdict。
 * 主信号：payload_json.verdict（confirmed/pending/debunked/rumor）；
 * 兜底：reason 关键词；默认 pending（待核验）。
 */
export function reviewRowToVerdict(row: D1ReviewRow): WikiVerdict {
  if (row.status === "pending") return "pending";
  try {
    const p = JSON.parse(row.payload_json || "{}") as { verdict?: unknown };
    if (
      p.verdict === "confirmed" ||
      p.verdict === "pending" ||
      p.verdict === "debunked" ||
      p.verdict === "rumor"
    ) {
      return p.verdict;
    }
  } catch {
    /* 忽略坏 JSON，走兜底 */
  }
  const r = row.reason || "";
  if (/证实|确认属实|verified/i.test(r)) return "confirmed";
  if (/证伪|不实|debunk/i.test(r)) return "debunked";
  if (/传闻|rumor/i.test(r)) return "rumor";
  return "pending";
}

/** Wiki 条目 + D1 直出扩展字段（org/deadline/funding 供 MCP 层消费）。 */
export type D1WikiEntry = WikiEntry & {
  org: string | null;
  /** D1 原文 deadline（ISO 日期 / "预计 2026.10—11 发布" / "已启动｜滚动初筛" 等）。 */
  deadline: string | null;
  funding: WikiFunding | null;
  /**
   * 真实性复核状态（PRD-176/T3，trend #882；T1 §5.1）。值经
   * normalizeAuthenticityState 校验：缺列/非法值不携带该字段（MCP 下发时
   * 缺省 unverified，老客户端零破坏）。
   */
  authenticity_state?: WikiAuthenticityState;
};

function keywordsOf(tagsJson: string): string[] {
  try {
    const v: unknown = JSON.parse(tagsJson || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function excerpt(s: string, n = 300): string {
  const t = (s || "").trim().replace(/\s+/g, " ");
  return [...t].length <= n ? t : [...t].slice(0, n).join("") + "…";
}

function dateOf(ts: string): string {
  return (ts || "").slice(0, 10);
}

/**
 * opportunities 行 → WikiEntry。未发布（published != 1）返回 null（不入库）。
 * confidence 默认 pending（待核验）；调用方可传入 review_queue 关联出的 verdict。
 * 双向链接：id = `wiki-d1-opp-{rowId}`，d1_evidence 指回 D1 行。
 */
export function opportunityToEntry(
  row: D1OpportunityRow,
  opts: { sources?: Map<string, D1SourceRow>; verdict?: WikiVerdict } = {},
): D1WikiEntry | null {
  if (row.published !== 1) return null;
  const src = row.source_id ? opts.sources?.get(row.source_id) : undefined;
  const type = KIND_TO_TYPE[row.kind];
  const region = locationToRegion(row.location);
  const verdict = opts.verdict ?? "pending";
  // PRD-176/T3（T1 §5.1）：真实性状态只读透传；缺列/非法值不携带字段。
  const authenticityState = normalizeAuthenticityState(row.authenticity_state);
  return {
    id: `wiki-d1-opp-${row.id}`,
    title: excerpt(row.name, 80),
    source: src?.name ?? "D1 opportunities",
    source_url: row.url || src?.url || "",
    source_type: "d1_snapshot",
    d1_evidence: `d1://opportunities/${row.id}`,
    confidence: verdictToConfidence(verdict),
    created: dateOf(row.created_at),
    last_verified: dateOf(row.source_verified_at || row.created_at),
    status: "active",
    facets: {
      ...(type ? { type } : {}),
      ...(region ? { region } : {}),
      keywords: keywordsOf(row.tags_json),
    },
    body: excerpt(`${row.why} ${row.action}`.trim() || row.name),
    org: row.org || null,
    deadline: row.deadline || null,
    funding: null,
    ...(authenticityState ? { authenticity_state: authenticityState } : {}),
  };
}

/**
 * candidate_records 行 → WikiEntry。
 * T1 纪律：未审核的候选不入库 → verdict 缺省时返回 null。
 * 双向链接：id = `wiki-d1-cand-{rowId}`；有 snapshot_id 时 d1_evidence 指快照。
 */
export function candidateToEntry(
  row: D1CandidateRow,
  opts: { verdict?: WikiVerdict; sources?: Map<string, D1SourceRow> } = {},
): D1WikiEntry | null {
  const { verdict } = opts;
  if (verdict === undefined) return null;
  const src = opts.sources?.get(row.source_id);
  const type = row.kind ? KIND_TO_TYPE[row.kind] : undefined;
  const region = row.location ? locationToRegion(row.location) : undefined;
  return {
    id: `wiki-d1-cand-${row.id}`,
    title: excerpt(row.title, 80),
    source: src?.name ?? "D1 candidate_records",
    source_url: row.canonical_url,
    source_type: "d1_snapshot",
    d1_evidence: row.snapshot_id
      ? `d1://snapshots/${row.snapshot_id}`
      : `d1://candidates/${row.id}`,
    confidence: verdictToConfidence(verdict),
    created: dateOf(row.first_seen_at),
    last_verified: dateOf(row.last_seen_at),
    status: "active",
    facets: {
      ...(type ? { type } : {}),
      ...(region ? { region } : {}),
      keywords: [],
    },
    body: excerpt(row.title),
    org: row.org || null,
    deadline: row.deadline,
    funding: null,
  };
}
