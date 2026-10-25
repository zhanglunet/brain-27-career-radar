/**
 * 本地确认入口（approvals 命令族）—— PRD-175/T3（trend #877）。
 *
 * T1 规范：PRD-175/T1《批准队列 schema + 不可逆动作清单》§4.1/§5.2/§5.5
 * （中央仓库 zhanglunet/trend，adopted/drafts/prd-175-pre-apply-approval-gate-t1.md）。
 *
 * 命令面（T1 §5.2，接在 T2 gate 的 decide/cancel/list/auditFor 口上）：
 *   brain27 approvals list    [--status <七态|all>] [--opportunity <id>] [--json] [--db <path>]
 *   brain27 approvals show    <id>       [--json] [--db <path>]
 *   brain27 approvals approve <id> [--note <text>] [--json] [--db <path>]
 *   brain27 approvals reject  <id> [--note <text>] [--json] [--db <path>]
 *   brain27 approvals cancel  <id> [--note <text>] [--json] [--db <path>]
 *
 * 现有命令零改动（T1 §5.2 约束）：cli.ts 只新增 parseArgs 白名单一项、
 * ParsedArgs 联合类型一项、main() 里一段早于档案/缓存加载的分派分支和
 * HELP_TEXT 若干说明行——既有命令的代码路径与行为逐字不变。批准队列
 * 不依赖 profile/cache 文件，分派必须在两者加载之前完成。
 *
 * 展示与留痕纪律：
 * - 确认界面醒目展示 posting-guard 命中项（T1 §5.5）；带命中的 A1/A2
 *   不允许"自动批准"，人工经本命令逐条决定（本命令即人工决定口）。
 * - 脱敏（T1 §4.3）：只展示动作元数据与引用（draft_ref/payload/guard
 *   类别），绝不展示 materials 正文（记录里也没有）。
 * - 全部决定经 gate.decide/cancel 写 approval_audit（append-only，
 *   trigger 拒绝改写），decided_via = "cli"。
 * - 数据主权：只读写本地 SQLite（默认 ~/.brain27/brain27.db），零网络。
 *
 * 批准 ≠ 执行：approve 只把 pending 置为 approved（含批准有效期），
 * 真正执行仍必须经 gate.execute（T2 唯一执行口）；批准过期后须重新批准。
 *
 * 纯函数 + 可擦除 TypeScript（无 enum / 无命名空间），可被 node --test 直接运行。
 */

import { createApprovalGate, type ApprovalGate } from "./approval/gate.ts";
import type {
  ApprovalRecord,
  ApprovalStatus,
  AuditEntry,
} from "./approval/store.ts";
import { ACTION_REGISTRY } from "./approval/registry.ts";

// ── 帮助与常量 ───────────────────────────────────────────────

export const APPROVALS_HELP_TEXT = `brain27 approvals —— 批准队列本地确认入口（PRD-175）

纯本地保证：只读写本地 SQLite（默认 ~/.brain27/brain27.db），不向任何服务器发送数据。
每一条批准 / 拒绝 / 撤回都追加写入本地审计（approval_audit，append-only）。

用法：
  brain27 approvals list [--status <pending|approved|rejected|executed|failed|expired|cancelled|all>] [--opportunity <id>] [--json] [--db <path>]
      列出队列记录（默认只看待批准 pending；--status all 看全部）
  brain27 approvals show <id> [--json] [--db <path>]
      查看单条记录与审计留痕
  brain27 approvals approve <id> [--note <text>] [--json] [--db <path>]
      批准（pending → approved；写批准有效期；批准 ≠ 执行）
  brain27 approvals reject <id> [--note <text>] [--json] [--db <path>]
      拒绝（pending → rejected，终态）
  brain27 approvals cancel <id> [--note <text>] [--json] [--db <path>]
      撤回（pending → cancelled，终态）

纪律：终态记录不可再改，只能新开记录；未注册动作在入队口即被拒绝并留痕（bypass_blocked）。
`;

/** 七态中文标注（展示用；T1 §4.1 状态机）。 */
export const STATUS_LABELS: Readonly<Record<ApprovalStatus, string>> = {
  pending: "待批准",
  approved: "已批准",
  rejected: "已拒绝",
  executed: "已执行",
  failed: "执行失败",
  expired: "已过期",
  cancelled: "已撤回",
};

const ALL_STATUSES: readonly ApprovalStatus[] = [
  "pending", "approved", "rejected", "executed", "failed", "expired", "cancelled",
];

function riskLabel(kind: ApprovalRecord["actionKind"]): string {
  const action = ACTION_REGISTRY[kind];
  return action?.risk === "high" ? "高风险" : action?.risk === "medium" ? "中风险" : kind;
}

/**
 * list 的 --status 取值：缺省 = pending（T1 §5.2「列出待批」）；
 * all = 全部七态；否则必须是七态之一。
 */
export function parseStatusFilter(raw: string | boolean | undefined):
  | { ok: true; status: ApprovalStatus | "all" }
  | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, status: "pending" };
  if (raw === true) {
    return { ok: false, error: `--status 需要取值：${ALL_STATUSES.join("/")} 或 all` };
  }
  if (raw === "all") return { ok: true, status: "all" };
  if (typeof raw !== "string" || !(ALL_STATUSES as readonly string[]).includes(raw)) {
    return {
      ok: false,
      error: `--status 只允许 ${ALL_STATUSES.join("/")} 或 all，收到：${String(raw)}`,
    };
  }
  return { ok: true, status: raw as ApprovalStatus };
}

// ── 参数解析 ────────────────────────────────────────────────

export type ApprovalsVerb = "list" | "show" | "approve" | "reject" | "cancel" | "help";

export type ParsedApprovalsArgs = {
  verb: ApprovalsVerb;
  /** show/approve/reject/cancel 的记录 id；list/help 无 id。 */
  id: string | null;
};

const VERBS_WITH_ID: readonly ApprovalsVerb[] = ["show", "approve", "reject", "cancel"];

/** 解析 approvals 子命令（positional 来自 cli.ts parseArgs 的位置参数）。 */
export function parseApprovalsArgs(
  positional: string[],
): ParsedApprovalsArgs {
  const [verbRaw, idRaw] = positional;
  const verb = verbRaw as ApprovalsVerb;
  if (verbRaw === undefined || verbRaw === "help" || !VERBS_WITH_ID.includes(verb) && verb !== "list") {
    return { verb: "help", id: null };
  }
  if (verb === "list") return { verb: "list", id: null };
  if (typeof idRaw !== "string" || idRaw.trim().length === 0) {
    // 缺 id：按用法错误处理（调用方报错）。
    return { verb, id: null };
  }
  return { verb, id: idRaw };
}

// ── 展示格式化 ──────────────────────────────────────────────

/** 解析 payload_json（记录里只有动作元数据，无正文；解析失败按空对象展示）。 */
function payloadOf(record: ApprovalRecord): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(record.payloadJson);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** list 单条记录的多行展示（guard 命中项醒目展示，T1 §5.5）。 */
export function formatRecordLines(record: ApprovalRecord, index?: number): string[] {
  const head = index === undefined ? "" : `${index}. `;
  const lines = [
    `${head}${record.id}〔${riskLabel(record.actionKind)} · ${STATUS_LABELS[record.status]}〕`,
    `   动作：${record.actionKind} · 机会：${record.opportunityId}` +
      (record.draftRef ? ` · 草稿引用：${record.draftRef}` : ""),
    `   载荷：${JSON.stringify(payloadOf(record))}`,
    `   请求：${record.requestedAt}（via ${record.requestedBy}）` +
      (record.expiresAt ? ` · 待批过期：${record.expiresAt}` : ""),
  ];
  if (record.guardFlags.length > 0) {
    lines.push(
      `   【内容检查命中】${record.guardFlags.length} 项：${[...new Set(record.guardFlags)].join("、")}` +
        `——须人工核对来源后再决定，禁止无核对直接批准`,
    );
  }
  if (record.status !== "pending") {
    const decided = [
      record.decidedAt ? `时间 ${record.decidedAt}` : null,
      record.decidedVia ? `渠道 ${record.decidedVia}` : null,
      record.decisionNote ? `备注 ${record.decisionNote}` : null,
      record.approvalValidUntil ? `批准有效期至 ${record.approvalValidUntil}` : null,
      record.executedAt ? `执行于 ${record.executedAt}` : null,
      record.executionRef ? `回执 ${record.executionRef}` : null,
    ].filter((x): x is string => x !== null);
    if (decided.length > 0) lines.push(`   决定：${decided.join(" · ")}`);
  }
  return lines;
}

/** 审计流水展示（append-only 留痕可见，trend #877 验收：可批准/拒绝并留痕）。 */
export function formatAuditLines(audit: AuditEntry[]): string[] {
  if (audit.length === 0) return ["   审计留痕：（无）"];
  const lines = [`   审计留痕（append-only，共 ${audit.length} 条）：`];
  for (const entry of audit) {
    lines.push(`     #${entry.id} ${entry.event} · ${entry.actor} · ${entry.occurredAt} · ${entry.detailJson}`);
  }
  return lines;
}

/** 记录 → --json 输出结构（payloadJson 解析为对象，便于脚本消费）。 */
export function recordToJson(record: ApprovalRecord): Record<string, unknown> {
  return { ...record, payload: payloadOf(record), statusLabel: STATUS_LABELS[record.status] };
}

// ── 命令实现（纯函数：返回行数组与退出码，不直接打印） ──────

export type ApprovalsResult = {
  exitCode: 0 | 1;
  /** stdout 行。--json 时为一段完整 JSON 文本（单行数组元素）。 */
  lines: string[];
  /** 错误信息（exitCode=1 时给出；调用方写 stderr）。 */
  error?: string;
};

function jsonResult(value: unknown): ApprovalsResult {
  return { exitCode: 0, lines: [JSON.stringify(value, null, 2)] };
}

function errorResult(error: string): ApprovalsResult {
  return { exitCode: 1, lines: [], error };
}

export type ListOptions = {
  /** "all" 或七态之一；缺省按 pending（T1 §5.2 列出待批）。 */
  status?: ApprovalStatus | "all";
  opportunityId?: string;
  json?: boolean;
};

export function approvalsList(gate: ApprovalGate, opts: ListOptions = {}): ApprovalsResult {
  const scope = opts.status ?? "pending";
  const records = gate.list({
    status: scope === "all" ? undefined : scope,
    opportunityId: opts.opportunityId,
  });
  if (opts.json) return jsonResult(records.map(recordToJson));
  if (records.length === 0) {
    return { exitCode: 0, lines: [`批准队列：0 条（status=${scope}）。没有待处理事项。`] };
  }
  const lines = [`批准队列：${records.length} 条（status=${scope}）`];
  records.forEach((record, i) => lines.push(...formatRecordLines(record, i + 1)));
  if (scope === "pending") {
    lines.push("提示：逐条核对来源后用 approvals approve/reject <id> 决定；show <id> 可看审计留痕。");
  }
  return { exitCode: 0, lines };
}

export type ShowOptions = { json?: boolean };

export function approvalsShow(gate: ApprovalGate, id: string, opts: ShowOptions = {}): ApprovalsResult {
  const record = gate.get(id);
  if (record === undefined) return errorResult(`记录不存在：${id}`);
  if (opts.json) return jsonResult({ ...recordToJson(record), audit: gate.auditFor(id) });
  return {
    exitCode: 0,
    lines: [...formatRecordLines(record), ...formatAuditLines(gate.auditFor(id))],
  };
}

export type DecideVerb = "approve" | "reject" | "cancel";

export type DecideOptions = {
  note?: string;
  json?: boolean;
};

/**
 * 决定口：approve/reject 走 gate.decide（T2 预留的 T3 接口），cancel 走
 * gate.cancel；store 层内部写 approval_audit 并校验"终态不可再改"。
 */
export function approvalsDecide(
  gate: ApprovalGate,
  verb: DecideVerb,
  id: string,
  opts: DecideOptions = {},
): ApprovalsResult {
  let record: ApprovalRecord;
  try {
    if (verb === "approve") {
      record = gate.decide(id, "approved", { via: "cli", note: opts.note });
    } else if (verb === "reject") {
      record = gate.decide(id, "rejected", { via: "cli", note: opts.note });
    } else {
      record = gate.cancel(id, { via: "cli", note: opts.note });
    }
  } catch (err) {
    return errorResult((err as Error).message);
  }
  if (opts.json) return jsonResult(recordToJson(record));
  const lines = [...formatRecordLines(record), ...formatAuditLines(gate.auditFor(id))];
  if (verb === "approve") {
    lines.push(
      `已批准 ${record.id}：状态 approved${record.approvalValidUntil ? `，批准有效期至 ${record.approvalValidUntil}` : ""}。`,
      "提示：批准 ≠ 执行；真正执行仍须经 gate.execute（T2 唯一执行口），批准过期后须重新批准。",
    );
  } else if (verb === "reject") {
    lines.push(`已拒绝 ${record.id}：终态 rejected；要重新发起须产生新的请求（如重开草稿）。`);
  } else {
    lines.push(`已撤回 ${record.id}：终态 cancelled。`);
  }
  return { exitCode: 0, lines };
}

// ── 入口（cli.ts main 分派到这里；打印并返回退出码） ────────

export type ApprovalsRunOptions = {
  /** 注入 gate（测试传临时路径新建）；缺省按 --db 或默认库路径新建。 */
  gate?: ApprovalGate;
  /** stdout（测试捕获）；缺省 console.log。 */
  out?: (line: string) => void;
  /** stderr（测试捕获）；缺省 console.error。 */
  err?: (line: string) => void;
};

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true;
}

/**
 * approvals 命令族入口。positional/flags 来自 cli.ts parseArgs 的产物
 * （command = "approvals" 之后的尾巴）。返回进程退出码。
 */
export async function runApprovals(
  positional: string[],
  flags: Record<string, string | boolean> = {},
  opts: ApprovalsRunOptions = {},
): Promise<number> {
  const out = opts.out ?? ((line: string) => console.log(line));
  const err = opts.err ?? ((line: string) => console.error(line));
  const parsed = parseApprovalsArgs(positional);

  if (parsed.verb === "help") {
    out(APPROVALS_HELP_TEXT.trimEnd());
    return 0;
  }

  const statusFilter = parseStatusFilter(flags.status);
  if (!statusFilter.ok) {
    err(`brain27 approvals: ${statusFilter.error}`);
    return 1;
  }

  const gate = opts.gate ??
    createApprovalGate(flagString(flags, "db") ? { path: flagString(flags, "db") } : {});
  try {
    let result: ApprovalsResult;
    if (parsed.verb === "list") {
      result = approvalsList(gate, {
        status: statusFilter.status,
        opportunityId: flagString(flags, "opportunity"),
        json: flagBool(flags, "json"),
      });
    } else if (parsed.id === null) {
      result = errorResult(`${parsed.verb} 缺少 <id>，用法：brain27 approvals ${parsed.verb} <id> [--note <text>]`);
    } else if (parsed.verb === "show") {
      result = approvalsShow(gate, parsed.id, { json: flagBool(flags, "json") });
    } else {
      result = approvalsDecide(gate, parsed.verb, parsed.id, {
        note: flagString(flags, "note"),
        json: flagBool(flags, "json"),
      });
    }
    if (result.exitCode === 0) {
      for (const line of result.lines) out(line);
    } else {
      err(`brain27 approvals: ${result.error ?? "未知错误"}`);
    }
    return result.exitCode;
  } finally {
    gate.close();
  }
}
