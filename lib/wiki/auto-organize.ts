/**
 * PRD-061/T4 · 增量自组织流水线（trend #279）。
 *
 * 位置（PRD-061 §4 / T1 §六）：日报 → PRD-017 起草条目 → 本流水线
 * （归类 → 精确去重 → 模糊去重 → 历史关联）→ 待确认区 → 人工确认入库。
 *
 * 本模块是纯函数编排器：把 T1（归类引擎，本文件同 PR 落地——T1 为纯设计）、
 * PRD-017/T4（dedupeEntries 精确去重）、T2（fuzzyDedupe 模糊去重）、T3
 * （findRelated + attachRelated 历史关联）串成一条增量流水线。不写库、
 * 不调网络；输出全部进待确认区，入库永远要人工确认（requireHumanConfirm）。
 *
 * 增量语义：
 * - PipelineState { processedIds, lastRun, ruleVersion } 记录处理水位；
 * - 每轮只处理"未见过 id"或"last_verified > lastRun"的条目（last_verified
 *   是 WikiEntry 的变更信号）；
 * - 无变化的第二轮 = 空操作（no-op）；
 * - 全量回算只在规则版本升级时触发：ruleVersion ≠ state.ruleVersion，或
 *   显式 forceFullRecompute（手动触发路径，T1 §六）。
 *
 * 纪律：
 * - 不动任何现有模块（纯加法；类型定义在本模块）。
 * - 历史条目只读（linking.ts 已保证；本模块再经测试断言）。
 * - 合并只提议不入库：模糊合并复合条目 needsReview=true，可 splitMerge 回滚；
 *   精确去重被吸收的条目不进待确认区，记入 dropped 供审计。
 * - 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），node --test 可直接运行。
 */

import {
  classify,
  CLASSIFY_RULE_VERSION,
  type ClassifiedEntry,
  type Classification,
} from "./classifier.ts";
import { dedupeEntries, type DeadlineOf } from "./maintenance.ts";
import {
  fuzzyDedupe,
  type FuzzyMergeEvidence,
  type OrgOf,
} from "./fuzzy-dedup.ts";
import {
  attachRelated,
  findRelated,
  type MentorOf,
  type RelatedLink,
} from "./linking.ts";
import type { WikiEntry } from "./schema.ts";

// ── 状态与输入输出 ────────────────────────────────────────────────────

/**
 * 流水线水位（内存态；生产落盘由调用方负责序列化）。
 * processedIds 用 Set：O(1) 判重；lastRun 为 ISO 时间。
 */
export type PipelineState = {
  processedIds: Set<string>;
  lastRun: string;
  ruleVersion: string;
};

export type AutoOrganizeAccessors = {
  orgOf?: OrgOf;
  deadlineOf?: DeadlineOf;
  mentorOf?: MentorOf;
};

export type AutoOrganizeInput = {
  /** 本轮输入的起草条目（PRD-017 沉淀之后）。 */
  drafts: WikiEntry[];
  /** 已入库历史（只读；关联的目标池）。 */
  history: WikiEntry[];
  state: PipelineState;
  accessors?: AutoOrganizeAccessors;
  /** 本轮时间（缺省 now）；测试可注入。 */
  nowIso?: string;
  /** 手动全量回算（T1 §六：规则版本升级时手动触发）。 */
  forceFullRecompute?: boolean;
  /** 规则版本（缺省 CLASSIFY_RULE_VERSION）。 */
  ruleVersion?: string;
  /** 低可信来源判定（透传给归类引擎）。 */
  isLowTrustSource?: (source: string) => boolean;
};

/** 待确认区条目：WikiEntry + 归类 + 关联 + 人工确认标记。 */
export type PendingItem = WikiEntry & {
  classification: Classification;
  related: RelatedLink[];
  /**
   * 显式复核标记：低置信或模糊合并时为 true（人工必须逐条核对）。
   * 注意：needsReview=false 不代表可自动入库——整个 pending 队列都要走
   * requireHumanConfirm（T1 §四关键纪律）。
   */
  needsReview: boolean;
  /** 需要仔细看的原因（空 = 走正常批量确认流）。 */
  reviewReasons: Array<"low_confidence" | "fuzzy_merged">;
  /** 模糊合并证据（仅 fuzzy_merged 时有；可 splitMerge 回滚）。 */
  mergeEvidence?: FuzzyMergeEvidence;
};

export type DroppedItem = {
  id: string;
  reason: "exact_duplicate" | "fuzzy_absorbed";
  keptId: string;
};

export type AutoOrganizeStats = {
  received: number;
  processed: number;
  skipped: number;
  classified: number;
  lowConfidence: number;
  exactMerges: number;
  fuzzyMerges: number;
  /** 挂出 ≥1 条相关历史的 pending 条目数。 */
  linked: number;
  fullRecompute: boolean;
};

export type AutoOrganizeResult = {
  /** 待确认区（全部待人工确认）。 */
  pending: PendingItem[];
  /** 被去重吸收、未进待确认区的条目（审计用）。 */
  dropped: DroppedItem[];
  /** 更新后的水位（新对象；输入 state 不动）。 */
  state: PipelineState;
  stats: AutoOrganizeStats;
};

/** 初始水位（首轮 = 全量处理一次，之后增量）。 */
export function initialPipelineState(): PipelineState {
  return { processedIds: new Set<string>(), lastRun: "", ruleVersion: "" };
}

function isUpdatedAfter(entry: WikiEntry, lastRun: string): boolean {
  if (!lastRun) return true;
  const a = new Date(entry.last_verified).getTime();
  const b = new Date(lastRun).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false; // 解析不出 → 保守按未变更
  return a > b;
}

// ── 流水线 ────────────────────────────────────────────────────────────

/**
 * 增量自组织流水线。阶段顺序（T1 §六）：
 * ① 归类（classify）→ ② 精确去重（dedupeEntries）→ ③ 模糊去重（fuzzyDedupe）
 * → ④ 历史关联（findRelated + attachRelated）→ ⑤ 待确认区输出。
 */
export function runAutoOrganize(input: AutoOrganizeInput): AutoOrganizeResult {
  const {
    drafts,
    history,
    state,
    accessors = {},
    nowIso = new Date().toISOString(),
    forceFullRecompute = false,
    ruleVersion = CLASSIFY_RULE_VERSION,
    isLowTrustSource,
  } = input;
  const { orgOf, deadlineOf, mentorOf } = accessors;

  const fullRecompute = forceFullRecompute || ruleVersion !== state.ruleVersion;

  // —— 增量选择：未见过 id，或 last_verified 更新 ——
  const selected = fullRecompute
    ? [...drafts]
    : drafts.filter(
        (d) => !state.processedIds.has(d.id) || isUpdatedAfter(d, state.lastRun),
      );

  const dropped: DroppedItem[] = [];
  const classOf = new Map<string, Classification>();

  // —— ① 归类 ——
  const classified: ClassifiedEntry[] = selected.map((d) => {
    const c = classify(d, { isLowTrustSource });
    classOf.set(d.id, c.classification);
    return c;
  });

  // —— ② 精确去重（PRD-017/T4；被吸收的标 status="merged"，不进待确认区）——
  const exact = dedupeEntries(classified, deadlineOf);
  let exactMerges = 0;
  for (const m of exact.merges) {
    exactMerges += m.mergedIds.length;
    for (const id of m.mergedIds) {
      dropped.push({ id, reason: "exact_duplicate", keptId: m.keptId });
    }
  }
  const afterExact = exact.entries.filter((e) => e.status === "active");

  // —— ③ 模糊去重（T2；复合条目 needsReview=true，可回滚）——
  const fuzzy = fuzzyDedupe(afterExact, { orgOf, deadlineOf });
  let fuzzyMerges = 0;
  for (const m of fuzzy.merges) {
    fuzzyMerges += m.mergedIds.length;
    for (const id of m.mergedIds) {
      dropped.push({ id, reason: "fuzzy_absorbed", keptId: m.keptId });
    }
  }
  const absorbedIds = new Set(dropped.map((d) => d.id));
  const survivors: WikiEntry[] = fuzzy.entries.filter(
    (e) => e.status === "active" && !absorbedIds.has(e.id),
  );

  // 复合条目：从 kept 条目找回归类结果（spread 应已保留，map 是双保险）。
  const fuzzyById = new Map(fuzzy.merged.map((m) => [m.id, m]));
  const withClass: Array<{ entry: WikiEntry; fuzzyEvidence?: FuzzyMergeEvidence }> =
    survivors.map((e) => {
      const composite = fuzzyById.get(e.id);
      if (composite) {
        const keptClass =
          classOf.get(composite.mergeEvidence.keptId) ??
          classify(composite, { isLowTrustSource }).classification;
        classOf.set(e.id, keptClass);
        return { entry: e, fuzzyEvidence: composite.mergeEvidence };
      }
      return { entry: e };
    });

  // —— ④ 历史关联（T3；history 只读）+ ⑤ 待确认区输出 ——
  const pending: PendingItem[] = [];
  let lowConfidence = 0;
  let linked = 0;
  for (const { entry, fuzzyEvidence } of withClass) {
    const links = findRelated(entry, history, { orgOf, mentorOf });
    const withRelated = attachRelated(entry, links);
    const classification =
      classOf.get(entry.id) ??
      classify(entry, { isLowTrustSource }).classification;
    const reasons: PendingItem["reviewReasons"] = [];
    if (classification.needsReview) {
      reasons.push("low_confidence");
      lowConfidence += 1;
    }
    if (fuzzyEvidence) reasons.push("fuzzy_merged");
    if (links.length > 0) linked += 1;
    pending.push({
      ...withRelated,
      classification,
      related: withRelated.related,
      needsReview: reasons.length > 0,
      reviewReasons: reasons,
      ...(fuzzyEvidence ? { mergeEvidence: fuzzyEvidence } : {}),
    });
  }

  // —— 水位推进 ——
  const processedIds = new Set(state.processedIds);
  for (const d of selected) processedIds.add(d.id);
  const nextState: PipelineState = {
    processedIds,
    lastRun: nowIso,
    ruleVersion,
  };

  return {
    pending,
    dropped,
    state: nextState,
    stats: {
      received: drafts.length,
      processed: selected.length,
      skipped: drafts.length - selected.length,
      classified: classified.length,
      lowConfidence,
      exactMerges,
      fuzzyMerges,
      linked,
      fullRecompute,
    },
  };
}
