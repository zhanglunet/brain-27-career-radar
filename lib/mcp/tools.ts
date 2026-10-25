/**
 * PRD-018/T2+T3 · 只读 MCP tools 实现（trend #72 / #73）。
 *
 * T1 设计：trend #71 / brain-27 PR #17《docs/plans/2026-10-17-mcp-api.md》。
 * 实现两个只读 tool 的 JSON Schema + 处理函数：
 *   - search_opportunities（T2）：机会查询，复用 lib/wiki/rag.ts 的检索层
 *   - upcoming_deadlines（T3）：截止日查询，截止日数学见 ./deadlines.ts
 *
 * 只读纪律：本模块无任何写入操作；只消费 WikiEntry[]（生产 D1 只读），
 * D1 行 → WikiEntry 的真实映射由 PRD-017/T5（trend #70）实现。
 *
 * 接线说明：仓库内暂无 MCP server（package.json 无 @modelcontextprotocol/sdk），
 * 故本模块只导出标准 MCP tool 定义 + 纯函数 handler，不自造 server 框架；
 * 接入 SDK 时见文末 wiring 示例。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */
import { buildIndex, search } from "../wiki/rag.ts";
import type { WikiEntry } from "../wiki/schema.ts";
import {
  WIKI_FUNDINGS,
  WIKI_OPPORTUNITY_TYPES,
  WIKI_REGIONS,
} from "../wiki/schema.ts";
import type { WikiAuthenticityState } from "../wiki/schema.ts";
import { compareDeadline, parseDeadline, todayIso } from "./deadlines.ts";
import type { WikiDeadlineKind } from "./deadlines.ts";

// ── 方向受控词表（T1 review comment 2）────────────────────────────────────
// T1 评审意见：direction 不能是自由字符串，否则"脑机接口" vs "BCI" 对不上；
// 须与 Wiki 层 facets.keywords 共用同一份受控词表。v0.1，先覆盖雷达现有方向，
// maintainer 可扩展（扩展后 facets.keywords 的使用保持同步）。
export const WIKI_DIRECTIONS = [
  "脑机接口",
  "认知神经科学",
  "脑成像",
  "计算神经科学",
  "神经调控",
  "脑疾病",
  "类脑智能",
  "神经影像",
  "fMRI",
  "EEG",
] as const;
export type WikiDirection = (typeof WIKI_DIRECTIONS)[number];

/**
 * MCP 视角的机会条目 = WikiEntry + MCP 展示所需扩展字段。
 * org / deadline / funding_note 暂不在 WikiEntry 本体中（由 PRD-017/T5 的
 * D1 适配层补齐）；缺失时按 null / "tbd" 处理，不编造。
 */
export type McpOpportunity = WikiEntry & {
  /** 机构名；D1 适配前为 null。 */
  org?: string | null;
  /** 资助说明，如国际学生学费差额风险提示。 */
  funding_note?: string | null;
  /**
   * 截止日表达：ISO 日期 | "rolling"（滚动申请）| "tbd"（待确认）| null（未知）。
   * 缺失时 upcoming_deadlines 按 "tbd" 分组。
   */
  deadline?: string | null;
  deadline_kind?: WikiDeadlineKind;
  /**
   * 真实性复核状态（PRD-176/T3，trend #882；T1 §2.1/§5.1，只读透传）。
   * 条目缺省该字段时 search_opportunities 响应按 "unverified" 下发
   * （老客户端零破坏：纯新增字段，不改既有字段）。
   */
  authenticity_state?: WikiAuthenticityState;
};

/** T1 §四错误码。404 不单独抛——无结果时按 T1 返回空数组 + total=0。 */
export class McpError extends Error {
  code: 400 | 429 | 503;
  data?: Record<string, unknown>;
  constructor(code: 400 | 429 | 503, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

/** T1 §四错误码表（429 / 503 为传输层，由 T4 鉴权限流实现，此处列出以便 server 层复用）。 */
export const MCP_ERROR_CODES = {
  400: "参数非法：返回合法枚举值",
  404: "无符合条件的结果：返回空数组 + total=0，不报错",
  429: "触发限流：返回 retry_after 秒数（T4 实现）",
  503: "数据源暂不可用：返回 last_good 数据 + stale 标记（T4 实现）",
} as const;

// ── 游标（T1 review comment 3）────────────────────────────────────────────
// 翻页游标 = base64url(JSON({v, after}))，after 为上一页最后一条的 id。
// 同一查询内顺序稳定（文本检索按 score，列表按 last_verified，截止日按分组排序），
// 故"跳到 after 之后"可稳定翻页。手工 base64url，不依赖 Buffer（Workers 兼容）。
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const CURSOR_VERSION = 1;

export function encodeCursor(afterId: string): string {
  return b64urlEncode(JSON.stringify({ v: CURSOR_VERSION, after: afterId }));
}

export function decodeCursor(cursor: string): string {
  let parsed: { v?: unknown; after?: unknown };
  try {
    parsed = JSON.parse(b64urlDecode(cursor)) as { v?: unknown; after?: unknown };
  } catch {
    throw new McpError(400, "非法 cursor", { hint: "cursor 须为本 tool 返回的 next_cursor" });
  }
  if (parsed?.v !== CURSOR_VERSION || typeof parsed.after !== "string" || !parsed.after) {
    throw new McpError(400, "非法 cursor", { hint: "cursor 须为本 tool 返回的 next_cursor" });
  }
  return parsed.after;
}

// ── 参数校验 ─────────────────────────────────────────────────────────────

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new McpError(400, `非法参数 ${field}`, { field, allowed: [...allowed] });
}

function asLimit(value: unknown, def: number): number {
  if (value === undefined || value === null) return def;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
    throw new McpError(400, "非法参数 limit", { field: "limit", allowed: "1..50 的整数" });
  }
  return value;
}

function asDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 365) {
    throw new McpError(400, "非法参数 days", { field: "days", allowed: "1..365 的整数" });
  }
  return value;
}

// ── Tool 定义（MCP JSON Schema）───────────────────────────────────────────

export const SEARCH_OPPORTUNITIES_TOOL = {
  name: "search_opportunities",
  description: "按研究方向/地区/类型/资助筛选机会，返回机会摘要 + 证据链接（只读）。",
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: [...WIKI_DIRECTIONS],
        description: "研究方向关键词（受控词表，如 脑机接口 / 认知神经科学 / 脑成像）",
      },
      region: { type: "string", enum: [...WIKI_REGIONS] },
      type: { type: "string", enum: [...WIKI_OPPORTUNITY_TYPES] },
      funding: { type: "string", enum: [...WIKI_FUNDINGS] },
      limit: { type: "integer", default: 10, minimum: 1, maximum: 50 },
      cursor: { type: "string", description: "翻页游标：上一页返回的 next_cursor" },
    },
  },
} as const;

export const UPCOMING_DEADLINES_TOOL = {
  name: "upcoming_deadlines",
  description: "查询临近截止的机会：N 天内截止 Top N，按月聚合计数（只读）。",
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "integer", default: 30, minimum: 1, description: "未来 N 天内截止" },
      direction: {
        type: "string",
        enum: [...WIKI_DIRECTIONS],
        description: "可选，方向过滤（受控词表）",
      },
      limit: { type: "integer", default: 10, minimum: 1, maximum: 50 },
      cursor: { type: "string", description: "翻页游标：上一页返回的 next_cursor" },
    },
  },
} as const;

export const MCP_TOOLS = [SEARCH_OPPORTUNITIES_TOOL, UPCOMING_DEADLINES_TOOL] as const;

// ── 上下文 ───────────────────────────────────────────────────────────────

export type McpContext = {
  /** 只读消费的 Wiki 条目（含 MCP 扩展字段）。 */
  entries: McpOpportunity[];
  /** "今天"（YYYY-MM-DD），默认取当前 UTC 日期；测试可注入。 */
  now?: string;
};

// ── Tool 1：search_opportunities（T2）─────────────────────────────────────

export type SearchOpportunitiesArgs = {
  direction?: string;
  region?: string;
  type?: string;
  funding?: string;
  limit?: number;
  cursor?: string;
};

export type OpportunitySummary = {
  id: string;
  title: string;
  org: string | null;
  type: string | null;
  funding: string | null;
  funding_note: string | null;
  /** ISO 日期；滚动申请为 "rolling"；待确认为 "tbd"。 */
  deadline: string | null;
  deadline_kind: WikiDeadlineKind;
  evidence_url: string;
  confidence: string;
  last_verified: string;
  /**
   * 真实性复核状态（PRD-176/T3，trend #882；T1 §5.1）。条目未携带复核
   * 结论时缺省 "unverified"（从未复核 ≠ 复核中；展示口径 T1 §3.3）。
   * 纯新增字段，老客户端零破坏。
   */
  authenticity_state: WikiAuthenticityState;
};

export type SearchOpportunitiesResult = {
  total: number;
  opportunities: OpportunitySummary[];
  next_cursor: string | null;
};

function toSummary(e: McpOpportunity): OpportunitySummary {
  const info = parseDeadline(e.deadline ?? null, e.deadline_kind);
  return {
    id: e.id,
    title: e.title,
    org: e.org ?? null,
    type: e.facets.type ?? null,
    funding: e.facets.funding ?? null,
    funding_note: e.funding_note ?? null,
    deadline: info.kind === "rolling" ? "rolling" : (info.date ?? "tbd"),
    deadline_kind: info.kind,
    evidence_url: e.source_url,
    confidence: e.confidence,
    last_verified: e.last_verified,
    authenticity_state: e.authenticity_state ?? "unverified",
  };
}

/**
 * T2 实现：复用 lib/wiki/rag.ts 的检索层（facets 过滤 + confidence 加权 +
 * status 过滤），不另起一套排序逻辑。无 direction 时为纯列表模式
 * （同样的过滤面，按 last_verified 新鲜度排序）。
 */
export function handleSearchOpportunities(
  args: SearchOpportunitiesArgs,
  ctx: McpContext,
): SearchOpportunitiesResult {
  const direction = asEnum(args.direction, WIKI_DIRECTIONS, "direction");
  const region = asEnum(args.region, WIKI_REGIONS, "region");
  const type = asEnum(args.type, WIKI_OPPORTUNITY_TYPES, "type");
  const funding = asEnum(args.funding, WIKI_FUNDINGS, "funding");
  const limit = asLimit(args.limit, 10);
  const afterId = args.cursor === undefined ? null : decodeCursor(args.cursor);

  const index = buildIndex(ctx.entries);
  let ordered: McpOpportunity[];
  if (direction !== undefined) {
    const hits = search(index, direction, {
      facets: { type, region, funding },
      limit: Math.max(ctx.entries.length, 1),
    });
    ordered = hits.map((h) => h.entry as McpOpportunity);
  } else {
    ordered = ctx.entries
      .filter((e) => e.status === "active")
      .filter((e) => e.confidence !== "low")
      .filter((e) => type === undefined || e.facets.type === type)
      .filter((e) => region === undefined || e.facets.region === region)
      .filter((e) => funding === undefined || e.facets.funding === funding)
      .sort((a, b) =>
        a.last_verified < b.last_verified ? 1 : a.last_verified > b.last_verified ? -1 : 0,
      );
  }

  const total = ordered.length;
  let start = 0;
  if (afterId !== null) {
    const idx = ordered.findIndex((e) => e.id === afterId);
    start = idx === -1 ? total : idx + 1; // 游标过期（数据变化）→ 空页，total 照实返回
  }
  const page = ordered.slice(start, start + limit);
  const next_cursor =
    start + limit < total && page.length > 0 ? encodeCursor(page[page.length - 1].id) : null;
  return { total, opportunities: page.map(toSummary), next_cursor };
}

// ── Tool 2：upcoming_deadlines（T3）──────────────────────────────────────

export type UpcomingDeadlinesArgs = {
  days?: number;
  direction?: string;
  limit?: number;
  cursor?: string;
};

export type DeadlineItem = {
  id: string;
  title: string;
  org: string | null;
  /** ISO 日期；滚动申请为 "rolling"；待确认为 "tbd"。 */
  deadline: string | null;
  deadline_kind: WikiDeadlineKind;
  /** 距今天数；rolling / tbd 为 null。 */
  days_left: number | null;
  /** T1 review comment 1：Tool 2 条目也必须带 confidence + last_verified。 */
  confidence: string;
  last_verified: string;
  evidence_url: string;
  /**
   * 分组：upcoming（N 天内）| past（已过截止）| 其余为 deadline_kind 本体
   * （fixed=窗口外未来的硬截止，estimated=预计，rolling=滚动，tbd=待确认）。
   */
  group: "upcoming" | "past" | WikiDeadlineKind;
};

export type UpcomingDeadlinesResult = {
  total: number;
  items: DeadlineItem[];
  /** 按月聚合计数，如 {"2026-11": 12}（仅 fixed / estimated 的有效日期）。 */
  by_month: Record<string, number>;
  next_cursor: string | null;
};

function matchesDirection(e: McpOpportunity, direction: string): boolean {
  if (e.facets.keywords?.includes(direction)) return true;
  return `${e.title}\n${e.body}`.includes(direction);
}

/**
 * T3 实现：临近截止 Top N + 按月聚合。
 * 分组排序遵循 T1 §三：N 天内的 fixed 按 days_left 升序在前；
 * estimated / rolling / tbd 单独分组在后（不混入"临近"排序）；
 * 已过截止日的 fixed 标为 past 组（T4 自维护 agent 会将其翻为 expired）。
 */
export function handleUpcomingDeadlines(
  args: UpcomingDeadlinesArgs,
  ctx: McpContext,
): UpcomingDeadlinesResult {
  const days = args.days === undefined ? 30 : asDays(args.days);
  const direction = asEnum(args.direction, WIKI_DIRECTIONS, "direction");
  const limit = asLimit(args.limit, 10);
  const afterId = args.cursor === undefined ? null : decodeCursor(args.cursor);
  const now = todayIso(ctx.now);

  let pool = ctx.entries
    .filter((e) => e.status === "active")
    .filter((e) => e.confidence !== "low");
  if (direction !== undefined) pool = pool.filter((e) => matchesDirection(e, direction));

  const by_month: Record<string, number> = {};
  const upcoming: DeadlineItem[] = [];
  const rest: DeadlineItem[] = [];

  for (const e of pool) {
    const info = parseDeadline(e.deadline ?? null, e.deadline_kind, now);
    if ((info.kind === "fixed" || info.kind === "estimated") && info.date !== null) {
      const ym = info.date.slice(0, 7);
      by_month[ym] = (by_month[ym] ?? 0) + 1;
    }
    const item: DeadlineItem = {
      id: e.id,
      title: e.title,
      org: e.org ?? null,
      deadline: info.kind === "rolling" ? "rolling" : (info.date ?? "tbd"),
      deadline_kind: info.kind,
      days_left: info.daysLeft,
      confidence: e.confidence,
      last_verified: e.last_verified,
      evidence_url: e.source_url,
      group:
        info.kind === "fixed" && info.daysLeft !== null && info.daysLeft >= 0 && info.daysLeft <= days
          ? "upcoming"
          : info.kind === "fixed" && info.daysLeft !== null && info.daysLeft < 0
            ? "past"
            : info.kind,
    };
    if (item.group === "upcoming") upcoming.push(item);
    else rest.push(item);
  }

  upcoming.sort(
    (a, b) => (a.days_left ?? Number.POSITIVE_INFINITY) - (b.days_left ?? Number.POSITIVE_INFINITY),
  );
  rest.sort((a, b) =>
    compareDeadline(
      parseDeadline(a.deadline === "rolling" ? "rolling" : a.deadline, a.deadline_kind, now),
      parseDeadline(b.deadline === "rolling" ? "rolling" : b.deadline, b.deadline_kind, now),
    ),
  );
  const ordered = [...upcoming, ...rest];

  const total = ordered.length;
  let start = 0;
  if (afterId !== null) {
    const idx = ordered.findIndex((i) => i.id === afterId);
    start = idx === -1 ? total : idx + 1;
  }
  const page = ordered.slice(start, start + limit);
  const next_cursor =
    start + limit < total && page.length > 0 ? encodeCursor(page[page.length - 1].id) : null;
  return { total, items: page, by_month, next_cursor };
}

// ── 分发 ─────────────────────────────────────────────────────────────────

export function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): unknown {
  if (name === "search_opportunities") {
    return handleSearchOpportunities(args as SearchOpportunitiesArgs, ctx);
  }
  if (name === "upcoming_deadlines") {
    return handleUpcomingDeadlines(args as UpcomingDeadlinesArgs, ctx);
  }
  throw new McpError(400, `未知 tool: ${name}`, {
    allowed: ["search_opportunities", "upcoming_deadlines"],
  });
}

/*
 * ── 接入 @modelcontextprotocol/sdk 的 wiring 示例（仓库暂无 server，本模块不自造框架）──
 *
 *   import { Server } from "@modelcontextprotocol/sdk/server/index.js";
 *   import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
 *   import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
 *   import { MCP_TOOLS, dispatchToolCall } from "./lib/mcp/tools.ts";
 *
 *   const server = new Server({ name: "brain-27", version: "0.1.0" }, { capabilities: { tools: {} } });
 *   server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...MCP_TOOLS] }));
 *   server.setRequestHandler(CallToolRequestSchema, async (req) => {
 *     const entries = await loadWikiEntries(); // D1 → WikiEntry[]（PRD-017/T5，trend #70）
 *     const result = dispatchToolCall(req.params.name, req.params.arguments ?? {}, { entries });
 *     return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
 *   });
 *   await server.connect(new StdioServerTransport());
 */
