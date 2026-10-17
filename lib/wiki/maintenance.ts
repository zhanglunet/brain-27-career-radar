/**
 * PRD-017/T4 · Wiki 自维护 agent（trend #69）：去重合并 / 过期标记 / 矛盾检测。
 *
 * trend #69 要求：定期 agent 做去重合并、过期机会标记（已过截止日）、矛盾检测；
 * 过期条目保留可追溯，默认检索过滤（T1 纪律）。
 *
 * 本模块是纯函数：输入 WikiEntry[]，输出更新后的数组 + 维护报告。
 * 不写库、不调网络。截止日来自可选的 deadlineOf 访问器（WikiEntry 本体无
 * deadline 字段；MCP 扩展 McpOpportunity 有；T5 的 D1 适配产出也带 deadline）。
 * 无 deadlineOf 时，去重退化为 title+source+type+region 口径，并在报告中注明。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */
import type { WikiEntry, WikiStatus } from "./schema.ts";

/** 条目截止日访问器：ISO 日期 | "rolling"（滚动申请）| null（未知/待确认）。 */
export type DeadlineOf = (entry: WikiEntry) => string | null;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 去重键（T1 纪律：同一机会 = 机构+项目+截止日）。
 * WikiEntry 层近似：title + source + type + region；有 deadlineOf 时再加截止日，
 * 口径更严。返回 key 时同时用于合并与矛盾检测。
 */
export function dedupeKey(entry: WikiEntry, deadlineOf?: DeadlineOf): string {
  const f = entry.facets;
  return [
    norm(entry.title),
    norm(entry.source),
    f.type ?? "",
    f.region ?? "",
    deadlineOf?.(entry) ?? "",
  ].join("|");
}

export type MergeAction = {
  keptId: string;
  mergedIds: string[];
  key: string;
};

/**
 * 去重合并：同 key 的 active 条目只留一条，其余 status → "merged"（去重指针，
 * 保留可追溯，不进检索）。保留规则：last_verified 最新者；并列取 confidence 高者。
 */
export function dedupeEntries(
  entries: WikiEntry[],
  deadlineOf?: DeadlineOf,
): { entries: WikiEntry[]; merges: MergeAction[] } {
  const groups = new Map<string, WikiEntry[]>();
  for (const e of entries) {
    if (e.status !== "active") continue;
    const k = dedupeKey(e, deadlineOf);
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  const confRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const mergedIds = new Set<string>();
  const merges: MergeAction[] = [];
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    const [kept, ...rest] = [...g].sort(
      (a, b) =>
        b.last_verified.localeCompare(a.last_verified) ||
        (confRank[a.confidence] ?? 9) - (confRank[b.confidence] ?? 9),
    );
    for (const r of rest) mergedIds.add(r.id);
    merges.push({ keptId: kept.id, mergedIds: rest.map((r) => r.id), key });
  }
  const out = entries.map((e) =>
    mergedIds.has(e.id) ? { ...e, status: "merged" as WikiStatus } : e,
  );
  return { entries: out, merges };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 过期标记：fixed 截止日 < 今天 且 status=active → "expired"。
 * 保留可追溯（T1 纪律：expired 默认检索过滤）。rolling / 未知截止日不动。
 * 无 deadlineOf 时无法判断，直接返回原样（expiredIds 为空）。
 */
export function markExpired(
  entries: WikiEntry[],
  nowIso: string,
  deadlineOf?: DeadlineOf,
): { entries: WikiEntry[]; expiredIds: string[] } {
  if (!deadlineOf || !ISO_DATE.test(nowIso)) return { entries, expiredIds: [] };
  const expiredIds: string[] = [];
  const out = entries.map((e) => {
    if (e.status !== "active") return e;
    const d = deadlineOf(e);
    if (d === null || d === "rolling" || !ISO_DATE.test(d)) return e;
    if (d < nowIso) {
      expiredIds.push(e.id);
      return { ...e, status: "expired" as WikiStatus };
    }
    return e;
  });
  return { entries: out, expiredIds };
}

export type MaintenanceConflict = {
  kind: "deadline_mismatch";
  /** 不含截止日的 base key。 */
  key: string;
  entryIds: string[];
  detail: string;
};

/**
 * 矛盾检测（只报告，不自动改）。
 * 同一机会（title+source+type+region 相同）出现多种不同截止日 → 需人工核对。
 */
export function detectConflicts(
  entries: WikiEntry[],
  deadlineOf?: DeadlineOf,
): MaintenanceConflict[] {
  if (!deadlineOf) return [];
  const byBase = new Map<string, Map<string, string[]>>();
  for (const e of entries) {
    if (e.status !== "active") continue;
    const base = [
      norm(e.title),
      norm(e.source),
      e.facets.type ?? "",
      e.facets.region ?? "",
    ].join("|");
    const dl = deadlineOf(e) ?? "";
    let m = byBase.get(base);
    if (!m) {
      m = new Map();
      byBase.set(base, m);
    }
    const ids = m.get(dl);
    if (ids) ids.push(e.id);
    else m.set(dl, [e.id]);
  }
  const conflicts: MaintenanceConflict[] = [];
  for (const [base, m] of byBase) {
    if (m.size > 1) {
      conflicts.push({
        kind: "deadline_mismatch",
        key: base,
        entryIds: [...m.values()].flat(),
        detail: `同一机会存在 ${m.size} 种不同截止日（${[...m.keys()].join(" / ") || "未知"}），需人工核对`,
      });
    }
  }
  return conflicts;
}

export type MaintenanceReport = {
  ranAt: string;
  merges: MergeAction[];
  expiredIds: string[];
  conflicts: MaintenanceConflict[];
  total: number;
  changed: number;
};

/**
 * 一次自维护：去重 → 过期标记 → 矛盾检测（纯函数）。
 */
export function runMaintenance(
  entries: WikiEntry[],
  opts: { nowIso?: string; deadlineOf?: DeadlineOf } = {},
): { entries: WikiEntry[]; report: MaintenanceReport } {
  const nowIso = opts.nowIso ?? new Date().toISOString().slice(0, 10);
  const d1 = dedupeEntries(entries, opts.deadlineOf);
  const d2 = markExpired(d1.entries, nowIso, opts.deadlineOf);
  const conflicts = detectConflicts(d2.entries, opts.deadlineOf);
  const changed =
    d1.merges.reduce((n, m) => n + m.mergedIds.length, 0) + d2.expiredIds.length;
  return {
    entries: d2.entries,
    report: {
      ranAt: nowIso,
      merges: d1.merges,
      expiredIds: d2.expiredIds,
      conflicts,
      total: entries.length,
      changed,
    },
  };
}
