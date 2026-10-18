/**
 * PRD-061/T2 · 跨来源模糊去重（trend #275）。
 *
 * 叠在 PRD-017/T4 精确去重（maintenance.ts 的 dedupeKey/dedupeEntries）之上：
 * 精确去重管"同一机会同一截止日"的字面重复，本层管"同一机会不同来源"的
 * 模糊重复（机构名写法不同、标题措辞不同）。
 *
 * 设计依据：T1 设计 docs/plans/2026-10-18-autoclass-rules.md §六
 * （机构名归一化复用 §三 机构白名单；标题相似度 token 交集/Jaccard，
 * 阈值 0.8 起保守；合并后 source 变数组保留多源证据链；合并走人工确认、可拆分回滚）。
 *
 * 纪律（PRD-061 非目标 + PRD-017 人工确认闸门）：
 * - 不动 schema.ts：WikiEntry 本体一个字段不加。合并条目 = WikiEntry & 加法字段
 *   （sources / sourceUrls / needsReview / mergeEvidence），类型定义在本模块。
 * - source: string 保持原样（主来源 = 被保留条目的来源）；多源证据链放在加法
 *   字段 sources 里。原因：D1 适配器与 merged schema 都按 source: string 消费，
 *   改类型会连锁破坏；加法字段向后兼容。
 * - 合并只提议、不入库：合并条目 needsReview=true，必须人工确认（PRD-017
 *   requireHumanConfirm 纪律）。fail-closed：拿不准就不并。
 * - 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */
import type { WikiEntry, WikiStatus } from "./schema.ts";
import type { DeadlineOf } from "./maintenance.ts";
import { tokenize } from "./rag.ts";

/** 相似度阈值下限（T1 设计：0.8 起，保守）。低于此值一律不并。 */
export const FUZZY_SIM_THRESHOLD = 0.8;

/** 截止日窗口（天）：双方都是确定日期且差值超过此值 → 视为不同届/不同批次，不并。 */
export const FUZZY_DEADLINE_WINDOW_DAYS = 30;

/**
 * 条目所属机构名访问器（WikiEntry 本体无 org 字段；MCP 扩展 McpOpportunity 有）。
 * 返回 null = 机构未知 → fail-closed（isFuzzyDuplicate 直接判不并）。
 */
export type OrgOf = (entry: WikiEntry) => string | null;

// ── 机构名归一化 ──────────────────────────────────────────────────────────

type OrgAlias = { canonical: string; variants: string[] };

/**
 * 机构白名单（种子版）：名称变体 → 统一 canonical。
 * canonical 规则：有 ASCII 简称的取小写去分隔符（如 "ucl"）；纯中文机构取
 * 去空白标点后的中文名。所有比较都走 canonical，不直接比原文。
 *
 * 冷启动说明（T1 §七不确定项 4）：种子只有几家；T5 验收后从 D1 sources 表
 * 反推 Top 机构扩充。未命中白名单的机构不猜测、不编造。
 */
const ORG_ALLOWLIST: OrgAlias[] = [
  { canonical: "ucl", variants: ["UCL", "伦敦大学学院", "University College London"] },
  { canonical: "mit", variants: ["MIT", "麻省理工学院", "Massachusetts Institute of Technology"] },
  { canonical: "oxford", variants: ["Oxford", "牛津大学", "University of Oxford"] },
  { canonical: "cambridge", variants: ["Cambridge", "剑桥大学", "University of Cambridge"] },
  { canonical: "tsinghua", variants: ["清华大学", "Tsinghua University"] },
];

/** 基础归一化：去首尾空白 → 小写 → 去掉所有空白与标点（保留字母数字，含 CJK）。 */
function basicNorm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const aliasIndex = new Map<string, string>();
for (const { canonical, variants } of ORG_ALLOWLIST) {
  for (const v of variants) aliasIndex.set(basicNorm(v), canonical);
}

/**
 * 机构名归一化：白名单命中 → canonical；未命中 → 基础归一化后的原样（不编造）。
 * 例：normalizeOrg("U.C.L.") === normalizeOrg("伦敦大学学院") === "ucl"。
 */
export function normalizeOrg(name: string): string {
  const n = basicNorm(name);
  return aliasIndex.get(n) ?? n;
}

// ── 标题相似度 ────────────────────────────────────────────────────────────

/**
 * 标题相似度：tokenize() 词项集合的 Jaccard 系数，0~1。
 * 复用 rag.ts 的 tokenize（中文 bigram + 英文词切分），与检索层同一分词口径。
 * 任意一方无词项 → 0（由调用方 fail-closed，不并）。
 */
export function titleSimilarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// ── 模糊重复判定 ──────────────────────────────────────────────────────────

export type FuzzyCheckOptions = {
  /** 相似度阈值，默认 FUZZY_SIM_THRESHOLD（0.8，保守）。 */
  simThreshold?: number;
  /** 截止日窗口（天），默认 FUZZY_DEADLINE_WINDOW_DAYS（30）。 */
  deadlineWindowDays?: number;
  /** 机构名访问器；缺省 → 机构未知 → fail-closed（不并）。 */
  orgOf?: OrgOf;
  /** 截止日访问器；缺省 → 截止日视为未知 → 跳过窗口检查。 */
  deadlineOf?: DeadlineOf;
};

export type FuzzyCheckReason =
  | "match"
  | "org_unknown"
  | "org_mismatch"
  | "type_mismatch"
  | "similarity_below_threshold"
  | "deadline_window_exceeded";

export type FuzzyCheckEvidence = {
  reason: FuzzyCheckReason;
  /** 归一化后的机构名（双方一致时才非空）。 */
  normalizedOrg: string | null;
  orgA: string | null;
  orgB: string | null;
  similarity: number;
  threshold: number;
  deadlineA: string | null;
  deadlineB: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

/**
 * 模糊重复判定：同一机构（归一化后一致）+ 标题相似度 ≥ 阈值 + 截止日窗口内。
 *
 * 防误合并（PRD-061 风险项）四道闸：
 * 1. 机构必须双方可归一化且一致 —— 光标题像不够（不同机构的同名项目不并）。
 * 2. 截止日：双方都是确定日期 → 差值必须 ≤ 窗口（防"同名不同届"误并，如
 *    2026 版 vs 2027 版）。一方未知（null / "rolling" / 非 ISO）→ 无法证伪，
 *    放行（机构 + 相似度仍在把关）。
 * 3. 机会类型：双方都标了 facets.type 且不同 → 不并（同一机会不可能是两种
 *    类型；防"博士 vs 博士后"这种同机构近似标题误并）。
 * 4. 相似度阈值 0.8 起，保守。
 */
export function isFuzzyDuplicate(
  a: WikiEntry,
  b: WikiEntry,
  opts: FuzzyCheckOptions = {},
): { duplicate: boolean; evidence: FuzzyCheckEvidence } {
  const threshold = opts.simThreshold ?? FUZZY_SIM_THRESHOLD;
  const windowDays = opts.deadlineWindowDays ?? FUZZY_DEADLINE_WINDOW_DAYS;
  const orgA = opts.orgOf?.(a) ?? null;
  const orgB = opts.orgOf?.(b) ?? null;
  const deadlineA = opts.deadlineOf?.(a) ?? null;
  const deadlineB = opts.deadlineOf?.(b) ?? null;
  const ev: FuzzyCheckEvidence = {
    reason: "match",
    normalizedOrg: null,
    orgA,
    orgB,
    similarity: 0,
    threshold,
    deadlineA,
    deadlineB,
  };

  // 1) 机构：必须双方可归一化且一致（fail-closed）。
  if (!orgA || !orgB) {
    ev.reason = "org_unknown";
    return { duplicate: false, evidence: ev };
  }
  const norg = normalizeOrg(orgA);
  if (norg !== normalizeOrg(orgB)) {
    ev.reason = "org_mismatch";
    return { duplicate: false, evidence: ev };
  }
  ev.normalizedOrg = norg;

  // 2) 截止日窗口：双方都是确定日期 → 差值必须 ≤ 窗口。
  if (
    deadlineA !== null &&
    deadlineB !== null &&
    ISO_DATE.test(deadlineA) &&
    ISO_DATE.test(deadlineB) &&
    daysBetween(deadlineA, deadlineB) > windowDays
  ) {
    ev.reason = "deadline_window_exceeded";
    return { duplicate: false, evidence: ev };
  }

  // 3) 机会类型：双方都标了且不同 → 不并。
  if (a.facets.type && b.facets.type && a.facets.type !== b.facets.type) {
    ev.reason = "type_mismatch";
    return { duplicate: false, evidence: ev };
  }

  // 4) 标题相似度。
  const sim = titleSimilarity(a.title, b.title);
  ev.similarity = sim;
  if (sim < threshold) {
    ev.reason = "similarity_below_threshold";
    return { duplicate: false, evidence: ev };
  }

  return { duplicate: true, evidence: ev };
}

// ── 模糊去重 ──────────────────────────────────────────────────────────────

/** 合并条目：WikiEntry 本体不变 + 加法字段（定义在本模块，不动 schema.ts）。 */
export type FuzzyMergedEntry = WikiEntry & {
  /**
   * 多源证据链：合并涉及的全部来源名（含主来源 source）。
   * T1 设计说的"source 变数组"落在这里 —— source: string 本体不动（D1 适配器
   * 与 merged schema 都按 string 消费），证据链走加法字段，向后兼容。
   */
  sources: string[];
  /** 与 sources 一一对应的 source_url。 */
  sourceUrls: string[];
  /**
   * 人工确认标记：合并条目必须人工确认才能入库（PRD-017 requireHumanConfirm 纪律）。
   * T4 流水线消费此标记，把合并条目送进待确认区。
   */
  needsReview: true;
  /** 合并证据：拆分回滚的全部依据。 */
  mergeEvidence: FuzzyMergeEvidence;
};

export type FuzzyMergeEvidence = {
  mergedIds: string[];
  keptId: string;
  normalizedOrg: string;
  /** 每个被合并条目与 kept 的标题相似度（与 mergedIds 一一对应）。 */
  similarities: number[];
  threshold: number;
  /** 回滚快照：合并前的原始条目（含 kept 原样），splitMerge 用它恢复。 */
  originals: WikiEntry[];
  /** ISO 日期：合并执行日。 */
  mergedAt: string;
};

export type FuzzyMergeReport = {
  keptId: string;
  mergedIds: string[];
  normalizedOrg: string;
  similarities: number[];
  threshold: number;
};

const CONF_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * 模糊去重：输入应为精确去重之后（dedupeEntries）的条目，本层只做模糊合并。
 * 组合用法：fuzzyDedupe(dedupeEntries(entries, deadlineOf).entries, { orgOf, deadlineOf })。
 *
 * 只处理 status="active" 的条目。贪心聚类（O(n²)，日报批处理量级够用）：
 * 每组保留一条（kept 选择规则与 T4 一致：last_verified 最新者，并列 confidence 高者），
 * 其余在返回的 entries 数组中标 status="merged"（T4 去重指针模式，保留可追溯），
 * 合成条目替换 kept 的位置（同 id），携带多源证据链 + needsReview。
 */
export function fuzzyDedupe(
  entries: WikiEntry[],
  opts: FuzzyCheckOptions = {},
): {
  entries: WikiEntry[];
  merged: FuzzyMergedEntry[];
  merges: FuzzyMergeReport[];
} {
  const threshold = opts.simThreshold ?? FUZZY_SIM_THRESHOLD;
  const actives = entries.filter((e) => e.status === "active");
  const absorbed = new Set<string>();
  const mergedOut: FuzzyMergedEntry[] = [];
  const merges: FuzzyMergeReport[] = [];

  for (const rep of actives) {
    if (absorbed.has(rep.id)) continue;
    const group: WikiEntry[] = [rep];
    for (const cand of actives) {
      if (cand.id === rep.id || absorbed.has(cand.id)) continue;
      if (isFuzzyDuplicate(rep, cand, opts).duplicate) {
        group.push(cand);
        absorbed.add(cand.id);
      }
    }
    if (group.length < 2) continue;
    absorbed.add(rep.id);

    // kept 选择：与 T4 一致 —— last_verified 最新者，并列 confidence 高者。
    const [kept] = [...group].sort(
      (x, y) =>
        y.last_verified.localeCompare(x.last_verified) ||
        (CONF_RANK[x.confidence] ?? 9) - (CONF_RANK[y.confidence] ?? 9),
    );
    const rest = group.filter((g) => g.id !== kept.id);
    const mergedIds = rest.map((g) => g.id);
    const similarities = rest.map((g) => titleSimilarity(kept.title, g.title));

    const rawOrg = opts.orgOf?.(kept) ?? null;
    const normalizedOrg = rawOrg === null ? "" : normalizeOrg(rawOrg);

    const sources: string[] = [];
    const sourceUrls: string[] = [];
    for (const g of [kept, ...rest]) {
      if (!sources.includes(g.source)) {
        sources.push(g.source);
        sourceUrls.push(g.source_url);
      }
    }

    const mergedEntry: FuzzyMergedEntry = {
      ...kept,
      sources,
      sourceUrls,
      needsReview: true,
      mergeEvidence: {
        mergedIds,
        keptId: kept.id,
        normalizedOrg,
        similarities,
        threshold,
        originals: group.map((g) => ({ ...g })),
        mergedAt: new Date().toISOString().slice(0, 10),
      },
    };
    mergedOut.push(mergedEntry);
    merges.push({ keptId: kept.id, mergedIds, normalizedOrg, similarities, threshold });
  }

  const absorbedIds = new Set(merges.flatMap((m) => m.mergedIds));
  const keptIds = new Set(merges.map((m) => m.keptId));
  const mergedById = new Map(mergedOut.map((m) => [m.id, m]));
  const out = entries.map((e) => {
    const m = mergedById.get(e.id);
    if (m !== undefined) return m;
    if (absorbedIds.has(e.id)) return { ...e, status: "merged" as WikiStatus };
    return e;
  });
  return { entries: out, merged: mergedOut, merges };
}

/**
 * 拆分回滚：把合并条目还原为合并前的原始条目（含 kept 原样）。
 * 可逆性的另一半在 fuzzyDedupe 的 entries 输出里：被吸收的原条目以
 * status="merged" 保留在数组中（T4 去重指针模式），ID 可追溯。
 */
export function splitMerge(merged: FuzzyMergedEntry): WikiEntry[] {
  return merged.mergeEvidence.originals.map((o) => ({ ...o }));
}
