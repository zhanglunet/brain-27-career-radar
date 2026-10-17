/**
 * PRD-018/T2+T3 · 截止日数学（trend #73）。
 *
 * T1 设计（trend #71 / brain-27 PR #17 §三）：deadline_kind 四态
 * fixed | rolling | tbd | estimated；fixed 按 days_left 升序；
 * rolling 降权排后并标注；tbd / estimated 单独分组，不混入"临近"排序。
 *
 * 纯函数 + 可擦除 TypeScript，可被 node --test 直接运行。
 */

export const WIKI_DEADLINE_KINDS = ["fixed", "rolling", "tbd", "estimated"] as const;
export type WikiDeadlineKind = (typeof WIKI_DEADLINE_KINDS)[number];

export type DeadlineInfo = {
  kind: WikiDeadlineKind;
  /** ISO 日期（YYYY-MM-DD）；rolling / tbd / 未知为 null。 */
  date: string | null;
  /** 距今天数（向上取整，过去为负）；rolling / tbd / 非法日期为 null。 */
  daysLeft: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** "2027-01-08" → 当天 UTC 零点毫秒数；非法返回 null（按 UTC 算，避免时区漂移）。 */
export function parseIsoDate(s: string): number | null {
  if (!ISO_DATE.test(s)) return null;
  const ms = Date.parse(s + "T00:00:00Z");
  return Number.isNaN(ms) ? null : ms;
}

/** "今天"（UTC 日期部分）。调用方可注入 nowIso 以便测试确定性。 */
export function todayIso(nowIso?: string): string {
  if (nowIso !== undefined && ISO_DATE.test(nowIso)) return nowIso;
  return new Date().toISOString().slice(0, 10);
}

/** 截止日距今天数（向上取整；过去为负；非法日期返回 null）。 */
export function daysUntil(dateIso: string, nowIso?: string): number | null {
  const target = parseIsoDate(dateIso);
  if (target === null) return null;
  const today = parseIsoDate(todayIso(nowIso));
  if (today === null) return null;
  return Math.ceil((target - today) / DAY_MS);
}

/**
 * 解析条目的 deadline 表达。
 * deadline 取值：ISO 日期 | "rolling"（滚动申请）| "tbd"（待确认）| null（未知）；
 * deadlineKind 缺省时按 deadline 字面推断（ISO→fixed，rolling→rolling，其余→tbd）。
 */
export function parseDeadline(
  deadline: string | null | undefined,
  deadlineKind?: WikiDeadlineKind,
  nowIso?: string,
): DeadlineInfo {
  const d = deadline ?? null;
  let kind: WikiDeadlineKind;
  if (
    deadlineKind !== undefined &&
    (WIKI_DEADLINE_KINDS as readonly string[]).includes(deadlineKind)
  ) {
    kind = deadlineKind;
  } else if (d === "rolling") {
    kind = "rolling";
  } else if (d !== null && parseIsoDate(d) !== null) {
    kind = "fixed";
  } else {
    kind = "tbd";
  }
  if (kind === "fixed" || kind === "estimated") {
    const date = d !== null && parseIsoDate(d) !== null ? d : null;
    return { kind, date, daysLeft: date === null ? null : daysUntil(date, nowIso) };
  }
  return { kind, date: null, daysLeft: null };
}

const KIND_RANK: Record<WikiDeadlineKind, number> = {
  fixed: 0,
  estimated: 1,
  rolling: 2,
  tbd: 3,
};

/**
 * T1 §三排序：fixed 在前（daysLeft 升序），estimated 次之，
 * rolling 降权排后，tbd 最后单独分组。
 */
export function compareDeadline(a: DeadlineInfo, b: DeadlineInfo): number {
  if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  const ad = a.daysLeft ?? Number.POSITIVE_INFINITY;
  const bd = b.daysLeft ?? Number.POSITIVE_INFINITY;
  return ad - bd;
}
