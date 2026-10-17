/**
 * PRD-019/T3 · 详情下钻（trend #82）。
 *
 * T1 设计（trend #78 / brain-27 PR #18 §二第三段）：摘要条目可下钻到完整机会
 * 详情——GET /opportunities/:id 返回完整详情（含 D1 证据链接、历次核验记录）。
 * 本模块实现该契约背后的解析器：纯函数 getOpportunityDetail(id, entries)。
 *
 * - 找到：返回全部字段 + 证据链 + 解析后的截止日信息（days_left 等）。
 * - 未找到：返回 { found: false, id }，不抛错——路由层映射为 404。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */
import { parseDeadline } from "./deadlines.ts";
import type { WikiDeadlineKind } from "./deadlines.ts";
import type {
  WikiConfidence,
  WikiFacets,
  WikiFunding,
  WikiSourceType,
  WikiStatus,
} from "../wiki/schema.ts";
import type { McpOpportunity } from "./tools.ts";

/** 历次核验记录。 */
export type VerificationRecord = {
  /** 首次入库（ISO 日期）。 */
  created: string;
  /** 最后核验（ISO 日期）。 */
  last_verified: string;
  /**
   * 说明：当前可用字段只有 created / last_verified 两个时间点；
   * 完整历次核验历史待 PRD-017/T5（trend #70）的 D1 适配层补齐。
   */
  note: string;
};

/** 机会完整详情（下钻结果）。 */
export type OpportunityDetail = {
  id: string;
  title: string;
  body: string;
  org: string | null;
  /** 来源名称，如 "UCL 官网博士招生页"。 */
  source: string;
  source_url: string;
  source_type: WikiSourceType;
  /** D1 证据链接；非 S1 来源可为 null。 */
  d1_evidence: string | null;
  confidence: WikiConfidence;
  status: WikiStatus;
  verification: VerificationRecord;
  /** 截止日原始表达：ISO 日期 | "rolling"（滚动申请）| "tbd"（待确认）| null（未知）。 */
  deadline: string | null;
  /** 解析后的截止日类型（缺省时按 deadline 字面推断）。 */
  deadline_kind: WikiDeadlineKind;
  /** 距今天数；rolling / tbd / 未知为 null。 */
  days_left: number | null;
  funding: WikiFunding | null;
  funding_note: string | null;
  facets: WikiFacets;
};

export type DetailResult =
  | { found: true; detail: OpportunityDetail }
  | { found: false; id: string };

/**
 * 按 id 取完整详情。nowIso 可注入以便测试确定性（默认取当前 UTC 日期）。
 */
export function getOpportunityDetail(
  id: string,
  entries: McpOpportunity[],
  nowIso?: string,
): DetailResult {
  const e = entries.find((x) => x.id === id);
  if (!e) return { found: false, id };
  const info = parseDeadline(e.deadline ?? null, e.deadline_kind, nowIso);
  return {
    found: true,
    detail: {
      id: e.id,
      title: e.title,
      body: e.body,
      org: e.org ?? null,
      source: e.source,
      source_url: e.source_url,
      source_type: e.source_type,
      d1_evidence: e.d1_evidence,
      confidence: e.confidence,
      status: e.status,
      verification: {
        created: e.created,
        last_verified: e.last_verified,
        note: "当前仅记录首次入库与最后核验两个时间点；完整历次核验历史待 PRD-017/T5（trend #70）补齐。",
      },
      deadline: e.deadline ?? null,
      deadline_kind: info.kind,
      days_left: info.daysLeft,
      funding: e.facets.funding ?? null,
      funding_note: e.funding_note ?? null,
      facets: e.facets,
    },
  };
}

/*
 * ── 路由接线示例（有 HTTP 层时）──
 *
 *   import { getOpportunityDetail } from "@/lib/mcp/detail";
 *
 *   // GET /opportunities/:id
 *   export async function GET(_req: Request, { params }: { params: { id: string } }) {
 *     const entries = await loadEntries(); // PRD-017/T5：D1 行 → McpOpportunity[]
 *     const r = getOpportunityDetail(params.id, entries);
 *     if (!r.found) return Response.json({ error: "not_found", id: r.id }, { status: 404 });
 *     return Response.json(r.detail);
 *   }
 */
