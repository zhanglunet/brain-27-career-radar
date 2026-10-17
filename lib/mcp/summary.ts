/**
 * PRD-019/T2 · 列表 API 摘要模式（trend #80）。
 *
 * T1 设计：trend #78 / brain-27 PR #18《docs/plans/2026-10-17-summary-format.md》。
 * 三段式摘要：统计段 / 截止临近 Top N / 下钻入口。默认返回摘要，
 * full=true（对应 `?full=1`）时返回全量列表（T1 §四：兼容老调用方）。
 *
 * 数据来源：WikiEntry[]（PRD-017）+ MCP 扩展字段（PRD-018）。
 * - 统计段计数：直接对传入数组按 facets 分组（与全量天然一致，T1 防误判 #2）。
 * - Top N 段：复用 lib/mcp/tools.ts 的 handleUpcomingDeadlines（分组/排序语义
 *   与只读 MCP 一致）；Top N 语义裁决（T1 review comment 1）：Top N =
 *   upcomingDays（默认 30 天）窗口内的 fixed 截止。T1 示例中 days_left 44/83
 *   的条目按此口径不在 Top N 内（示例已过时，以本裁决为准）。
 * - incomplete 降级（T1 防误判 #3）：Top N 条目 deadline / funding / org 任一
 *   缺失 → incomplete: true 并沉底，不静默丢弃。
 * - 顶部强制标注 SUMMARY_NOTICE（T1 防误判 #1：agent 不得把摘要当全量引用）。
 *
 * 生产 D1 只读：本模块只消费条目数组；D1 行 → WikiEntry 的真实映射由
 * PRD-017/T5（trend #70）实现。
 *
 * 接线说明：现有 app/api/opportunities/route.ts 是 D1 直连的老路由，其数据
 * 模型（中文 kind 枚举）与 WikiEntry 模型不同，且 OpportunitiesExplorer 前端
 * 消费其现有返回形状——T2 不翻转该路由的默认行为。待 T5 落地 D1→WikiEntry
 * 映射后，接线方式见文末示例。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */
import { handleUpcomingDeadlines } from "./tools.ts";
import type { DeadlineItem, McpContext, McpOpportunity } from "./tools.ts";

/** 摘要顶部强制标注（T1 防误判 #1）。 */
export const SUMMARY_NOTICE = "完整数据在详情页，可下钻";

/**
 * 分类计数缺失面的兜底桶。T2 决策：facets 缺失的条目计入 "unknown"，
 * 保证各 breakdown 加总恒等于 total（T1 防误判 #2 对账友好）。
 */
export const UNKNOWN_BUCKET = "unknown";

export type SummaryOptions = {
  /** Top N 数量（T1 默认 10）。 */
  topN?: number;
  /** "临近"天数窗口（T1 默认 30；见模块头语义裁决）。 */
  upcomingDays?: number;
  /** "今天"（YYYY-MM-DD），默认取当前 UTC 日期；测试可注入。 */
  nowIso?: string;
};

export type SummaryStats = {
  total: number;
  by_type: Record<string, number>;
  by_region: Record<string, number>;
  by_funding: Record<string, number>;
  note: typeof SUMMARY_NOTICE;
};

export type SummaryItem = {
  id: string;
  title: string;
  org: string | null;
  /** ISO 日期；"rolling" 滚动申请；null 待确认。 */
  deadline: string | null;
  /** 距今天数；rolling / 待确认为 null。 */
  days_left: number | null;
  funding: string | null;
  /** T1 防误判 #3：缺失字段的条目降级沉底，不丢弃。 */
  incomplete?: true;
};

export type UpcomingSegment = {
  items: SummaryItem[];
  top_n: number;
  more_available: boolean;
};

export type OpportunitySummary = {
  mode: "summary";
  /** 顶部强制标注（T1 防误判 #1）。 */
  notice: typeof SUMMARY_NOTICE;
  /** 第一段：统计段。 */
  stats: SummaryStats;
  /** 第二段：截止临近 Top N。 */
  upcoming: UpcomingSegment;
  /** 第三段：下钻入口。detail 指向 T3（trend #82，待实现）。 */
  drill_down: string;
  full_list: string;
};

export type OpportunityFullList = {
  mode: "full";
  total: number;
  items: McpOpportunity[];
};

export type ListOpportunitiesOptions = SummaryOptions & {
  /** true → 全量列表（T1 §四：`?full=1` 兼容老调用方）；默认 false → 摘要。 */
  full?: boolean;
};

const DEFAULT_TOP_N = 10;
const DEFAULT_UPCOMING_DAYS = 30;
const MAX_TOP_N = 50;

function checkOptions(opts: SummaryOptions): { topN: number; days: number } {
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const days = opts.upcomingDays ?? DEFAULT_UPCOMING_DAYS;
  if (!Number.isInteger(topN) || topN < 1 || topN > MAX_TOP_N) {
    throw new Error(`非法 topN（须为 1..${MAX_TOP_N} 的整数）: ${opts.topN}`);
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error(`非法 upcomingDays（须为 1..365 的整数）: ${opts.upcomingDays}`);
  }
  return { topN, days };
}

function countBy(
  entries: McpOpportunity[],
  pick: (e: McpOpportunity) => string | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    const k = pick(e) ?? UNKNOWN_BUCKET;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/** 第一段：统计段。直接对传入数组计数，与全量列表天然一致（T1 防误判 #2）。 */
export function buildStats(entries: McpOpportunity[]): SummaryStats {
  return {
    total: entries.length,
    by_type: countBy(entries, (e) => e.facets.type),
    by_region: countBy(entries, (e) => e.facets.region),
    by_funding: countBy(entries, (e) => e.facets.funding),
    note: SUMMARY_NOTICE,
  };
}

function toSummaryItem(item: DeadlineItem, funding: string | null): SummaryItem {
  const deadline = item.deadline === "tbd" ? null : item.deadline;
  const missing = deadline === null || funding === null || item.org === null;
  return {
    id: item.id,
    title: item.title,
    org: item.org,
    deadline,
    days_left: item.days_left,
    funding,
    ...(missing ? { incomplete: true as const } : {}),
  };
}

/**
 * 第二段：截止临近 Top N。
 * 复用 handleUpcomingDeadlines（与只读 MCP 同一套分组/排序）；其 limit 上限
 * 为 50，条目更多时用 cursor 翻页取全量后再截 Top N。
 */
export function buildUpcoming(
  entries: McpOpportunity[],
  opts: SummaryOptions = {},
): UpcomingSegment {
  const { topN, days } = checkOptions(opts);
  const ctx: McpContext = { entries };
  if (opts.nowIso !== undefined) ctx.now = opts.nowIso;

  const all: DeadlineItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = handleUpcomingDeadlines({ days, limit: 50, cursor }, ctx);
    all.push(...page.items);
    if (page.next_cursor == null) break;
    cursor = page.next_cursor;
  }

  const upcoming = all.filter((i) => i.group === "upcoming");
  const byId = new Map(entries.map((e) => [e.id, e]));
  const items = upcoming
    .slice(0, topN)
    .map((i) => toSummaryItem(i, byId.get(i.id)?.facets.funding ?? null));
  // incomplete 沉底（稳定排序，T1 防误判 #3）。
  const ordered = [
    ...items.filter((i) => !i.incomplete),
    ...items.filter((i) => i.incomplete),
  ];
  return {
    items: ordered,
    top_n: topN,
    more_available: upcoming.length > topN,
  };
}

/** 三段式摘要组装（T1 §二）。 */
export function buildSummary(
  entries: McpOpportunity[],
  opts: SummaryOptions = {},
): OpportunitySummary {
  checkOptions(opts);
  return {
    mode: "summary",
    notice: SUMMARY_NOTICE,
    stats: buildStats(entries),
    upcoming: buildUpcoming(entries, opts),
    drill_down:
      "GET /opportunities/:id 返回完整详情（含 D1 证据链接、历次核验记录）",
    full_list: "GET /opportunities?full=1 返回全量列表（兼容老调用方）",
  };
}

/**
 * 全量列表。与 buildSummary 并列，供 T5 回归脚本逐项对账（T1 防误判 #2）
 * 与 token 1/10 断言（T1 review comment 2）使用。
 */
export function buildFullList(entries: McpOpportunity[]): OpportunityFullList {
  return { mode: "full", total: entries.length, items: entries };
}

/**
 * JSON 字节数（T1 review comment 2：供 T5 回归脚本做 token 1/10 断言）。
 * 用法：measureJsonBytes(buildSummary(entries)) * 10 <= measureJsonBytes(buildFullList(entries))。
 * 注意：1/10 目标针对生产量级（数十条）数据；条目过少时比例不具代表性，
 * T5 须用真实量级数据验证。
 */
export function measureJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * 机会列表接口（PRD-019/T2 的"列表 API"）：默认返回三段式摘要，
 * full=true 时返回全量。纯函数；路由接线见模块头说明。
 */
export function listOpportunities(
  entries: McpOpportunity[],
  opts: ListOpportunitiesOptions = {},
): OpportunitySummary | OpportunityFullList {
  if (opts.full) return buildFullList(entries);
  return buildSummary(entries, opts);
}

/*
 * ── 接入 app/api/opportunities/route.ts 的示例（待 PRD-017/T5 落地后）──
 *
 *   import { listOpportunities } from "@/lib/mcp/summary";
 *   import { adaptD1Rows } from "@/lib/wiki/d1-adapter"; // T5（trend #70）：D1 行 → McpOpportunity[]
 *
 *   export async function GET(request: Request) {
 *     const rows = await queryD1(...);              // 现有 D1 查询保持不变
 *     const entries = adaptD1Rows(rows);            // T5 的映射
 *     const full = new URL(request.url).searchParams.get("full") === "1";
 *     return Response.json(listOpportunities(entries, { full }));
 *   }
 *
 * 注意：不要把本模块直接套在现有路由的 D1 Row 上——数据模型不同
 * （中文 kind 枚举 vs WikiEntry 枚举），映射是 T5 的工作；且现有前端
 * 消费当前返回形状，默认翻转需同步改造前端，不在 T2 范围内。
 */
