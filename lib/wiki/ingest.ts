/**
 * PRD-017/T3 · 日报 → Wiki 自动沉淀流水线（trend #68）。
 *
 * S2 知识源（T1 设计）：每日情报日报结论 → 自动起草 → 人工确认入库，不自动发布。
 * 本模块是纯函数流水线：日报输入 → 起草 → 校验门 → 人工确认队列 → 入库。
 * 不写库、不调网络；生产 D1 只读（日报行只读入）。
 *
 * 配置消费 lib/wiki/pipeline-config.ts：
 *   dailyReport = { owner: "zhanglunet", slaHours: 24, requireHumanConfirm: true }
 * 超 24h 未确认的草稿由 overdueDrafts() 标出（isDraftOverdue）。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */
import { isDraftOverdue, WIKI_PIPELINE_CONFIG } from "./pipeline-config.ts";
import type { EntryIssue, WikiEntry } from "./schema.ts";
import { validateEntry } from "./schema.ts";

/**
 * 日报输入（intelligence_reports 表的行形态子集）。
 * highlights_json = {"opportunities":[...],"sources":[...],"papers":[...]}。
 */
export type DailyReport = {
  id: string;
  /** 周期起始日 YYYY-MM-DD（period_start）。 */
  period_start: string;
  /** 日报结论文本（summary）。 */
  summary: string;
  highlights: {
    opportunities: string[];
    sources: string[];
    papers: string[];
  };
  generated_at: string;
};

export type DraftState = "pending" | "approved" | "rejected";

export type WikiDraft = {
  draftId: string;
  reportId: string;
  /** 起草时间 ISO。 */
  draftedAt: string;
  entry: WikiEntry;
  state: DraftState;
  decidedAt?: string;
  decidedBy?: string;
  /** 起草时刻的 validateEntry 结果；非空 = 不得入库，先修后审。 */
  issues: EntryIssue[];
  /** 人工确认时需补齐的重要字段（起草时无法可靠提取的）。 */
  needsFields: string[];
};

const BODY_MAX_CHARS = 300;

function excerpt(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return [...t].length <= n ? t : [...t].slice(0, n).join("") + "…";
}

function draftEntry(
  report: DailyReport,
  kind: "opportunity" | "paper",
  name: string,
  index: number,
  draftedAt: string,
): WikiDraft {
  const entry: WikiEntry = {
    id: `draft-${report.id}-${kind}-${index}`,
    title: excerpt(name, 80),
    source: "情报日报",
    source_url: "",
    source_type: "daily_report",
    d1_evidence: null,
    // 自动起草 = 待核验；人工确认时可按核验结果上调/下调。
    confidence: "medium",
    created: report.period_start,
    last_verified: report.period_start,
    status: "active",
    facets: {},
    body: excerpt(`${name} —— ${report.summary}`, BODY_MAX_CHARS),
  };
  return {
    draftId: entry.id,
    reportId: report.id,
    draftedAt,
    entry,
    state: "pending",
    issues: validateEntry(entry),
    needsFields: ["facets.type", "facets.region", "facets.funding", "source_url"],
  };
}

/**
 * 日报 → 草稿（纯函数）。
 * 起草面：highlights.opportunities（机会名）与 highlights.papers（论文标题）；
 * sources 为来源名录，非机会条目，不起草。
 */
export function draftFromReport(report: DailyReport, nowIso?: string): WikiDraft[] {
  const draftedAt = nowIso ?? new Date().toISOString();
  const drafts: WikiDraft[] = [];
  report.highlights.opportunities.forEach((name, i) =>
    drafts.push(draftEntry(report, "opportunity", name, i, draftedAt)),
  );
  report.highlights.papers.forEach((name, i) =>
    drafts.push(draftEntry(report, "paper", name, i, draftedAt)),
  );
  return drafts;
}

/**
 * 校验门：入库前重新跑 validateEntry（草稿在人工确认环节可能被编辑过，
 * 起草时的 issues 快照不能当入库依据）。有问题的草稿不得入库。
 */
export function partitionValid(drafts: WikiDraft[]): {
  valid: WikiDraft[];
  invalid: WikiDraft[];
} {
  const valid: WikiDraft[] = [];
  const invalid: WikiDraft[] = [];
  for (const d of drafts)
    (validateEntry(d.entry).length === 0 ? valid : invalid).push(d);
  return { valid, invalid };
}

/**
 * 人工确认（S2 纪律：requireHumanConfirm=true；确认人固定为配置中的 owner）。
 * 只允许 pending → approved/rejected；返回新数组（原数组不动）。
 */
export function decideDraft(
  drafts: WikiDraft[],
  draftId: string,
  decision: "approved" | "rejected",
  nowIso?: string,
): WikiDraft[] {
  const by = WIKI_PIPELINE_CONFIG.dailyReport.owner;
  return drafts.map((d) =>
    d.draftId === draftId && d.state === "pending"
      ? {
          ...d,
          state: decision,
          decidedAt: nowIso ?? new Date().toISOString(),
          decidedBy: by,
        }
      : d,
  );
}

/** 待确认草稿。 */
export function pendingDrafts(drafts: WikiDraft[]): WikiDraft[] {
  return drafts.filter((d) => d.state === "pending");
}

/** 超 SLA（24h）未确认的草稿。 */
export function overdueDrafts(drafts: WikiDraft[], now?: Date): WikiDraft[] {
  return pendingDrafts(drafts).filter((d) =>
    isDraftOverdue(d.draftedAt, "dailyReport", now),
  );
}

/** 已确认且校验通过 → 入库条目（去掉草稿元数据，只留 WikiEntry）。 */
export function ingestApproved(drafts: WikiDraft[]): WikiEntry[] {
  const { valid } = partitionValid(drafts);
  return valid.filter((d) => d.state === "approved").map((d) => d.entry);
}

export type IngestionReport = {
  reportId: string;
  drafted: number;
  valid: number;
  invalid: number;
  pending: number;
  overdue: number;
};

/** 一次日报沉淀的汇总（纯函数，供调度/展示消费）。 */
export function summarizeIngestion(
  report: DailyReport,
  drafts: WikiDraft[],
  now?: Date,
): IngestionReport {
  const { valid, invalid } = partitionValid(drafts);
  return {
    reportId: report.id,
    drafted: drafts.length,
    valid: valid.length,
    invalid: invalid.length,
    pending: pendingDrafts(drafts).length,
    overdue: overdueDrafts(drafts, now).length,
  };
}
