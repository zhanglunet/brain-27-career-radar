/**
 * 批准队列与审计存储（approval_queue + approval_audit）—— PRD-175/T2（trend #876）。
 *
 * T1 规范：PRD-175/T1《批准队列 schema + 不可逆动作清单》§三/§四
 * （中央仓库 zhanglunet/trend，adopted/drafts/prd-175-pre-apply-approval-gate-t1.md）。
 *
 * 存储落点（T1 §1.2/§5.1）：与 materials 同库（~/.brain27/brain27.db）新表，
 * `CREATE TABLE IF NOT EXISTS` 零迁移；复用 sqlite-store.ts 的打开与权限模式
 * （库 0600 / 目录 0700）；materials 表零改动（本模块不触碰它）。
 *
 * 数据主权红线（延续 PRD-080）：
 * - 只读写本地 SQLite 文件，不发起任何网络请求、不上云；
 * - 脱敏纪律（T1 §4.3）：队列与审计不存简历/PS/套磁信正文（正文只在
 *   materials），payload 只存动作元数据；detail_json 只存引用与摘要；
 * - 审计 append-only：只暴露 appendAudit()（INSERT），并以 SQLite trigger
 *   拒绝 UPDATE/DELETE（T1 §4.2 可选加固，T2 决定启用）。
 *
 * 幂等与防重放（T1 §3.2）：
 * - idempotency_key = SHA-256(action_kind + opportunity_id + draft_ref +
 *   收件人/URL) 十六进制（64 位），UNIQUE；
 * - 同 key 重复入队 → 直接返回既有记录，不建新行；
 * - 终态（executed/failed/expired/rejected/cancelled）不复活：同 key 的
 *   再请求按重放处理（gate 层拒绝并留审计）；要重新发起，请产生新的
 *   请求输入（如重开草稿得到新 draft_ref 版本号）。
 *
 * 依赖：`better-sqlite3`（已在 package.json dependencies）。
 */

import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { defaultDbPath } from "../sqlite-store.ts";
import { ACTION_REGISTRY, type ActionKind, isActionKind } from "./registry.ts";

// ── 类型 ─────────────────────────────────────────────────────

/** 七态状态机（T1 §4.1）。 */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "expired"
  | "cancelled";

/** 审计事件枚举（T1 §4.2，含 bypass_blocked）。 */
export type AuditEvent =
  | "requested"
  | "approved"
  | "rejected"
  | "cancelled"
  | "executed"
  | "failed"
  | "expired"
  | "bypass_blocked"
  | "authenticity_blocked"; // PRD-176/T4（#883）：可疑机会强制动作入队被拒留痕

export type ApprovalRecord = {
  /** `{action_kind}:{opportunity_id}:{seq}`，seq 为同 (kind, opportunity) 自增。 */
  id: string;
  actionKind: ActionKind;
  opportunityId: string;
  /** 引用 materials.id，不复制正文；A1/A2 必填。 */
  draftRef: string | null;
  /** 动作载荷元数据（canonical JSON，键已排序）。 */
  payloadJson: string;
  /** SHA-256 十六进制（64 位）。 */
  idempotencyKey: string;
  status: ApprovalStatus;
  /** ISO 8601。 */
  requestedAt: string;
  /** `cli:<command>` 或 `ui`。 */
  requestedBy: string;
  /** 上游 posting-guard 结论（flag kinds 数组）。 */
  guardFlags: string[];
  /** pending 过期时点（默认 +72h）。 */
  expiresAt: string | null;
  decidedAt: string | null;
  decidedVia: "cli" | "ui" | null;
  decisionNote: string | null;
  /** 批准有效期（默认 +24h；执行前校验）。 */
  approvalValidUntil: string | null;
  executedAt: string | null;
  /** 外部系统回执 id 形态（样例一律虚构，如 `<receipt@example.invalid>`）。 */
  executionRef: string | null;
  schemaVersion: number;
};

export type AuditEntry = {
  id: number;
  approvalId: string;
  event: AuditEvent;
  actor: string;
  detailJson: string;
  occurredAt: string;
};

export type EnqueueRequest = {
  actionKind: ActionKind;
  opportunityId: string;
  draftRef?: string;
  /** 动作载荷（收件人、目标 url、附件名等元数据）；绝不放材料正文。 */
  payload: Record<string, unknown>;
  /** 上游 posting-guard 结论（flag kinds）；A1/A2 强制携带。 */
  guardFlags?: string[];
  /** 触发来源：`cli:<command>` 或 `ui`；缺省 `cli`。 */
  requestedBy?: string;
};

export type EnqueueResult = {
  record: ApprovalRecord;
  /** false 表示同幂等键已有记录（重复入队被去重，未建新行）。 */
  created: boolean;
};

export type ApprovalStoreOptions = {
  /** 数据库文件路径；缺省走 defaultDbPath()。测试必须传临时文件。 */
  path?: string;
  /** 时间源（可注入，便于测试）；缺省 new Date()。 */
  now?: () => Date;
  /** pending 有效期小时数（T1 §六拍板 #1：默认 72）。 */
  pendingTtlHours?: number;
  /** 批准有效期小时数（T1 §六拍板 #1：默认 24）。 */
  approvalTtlHours?: number;
};

// ── 小工具 ───────────────────────────────────────────────────

/** canonical JSON：对象键递归排序后序列化（用于存储与载荷比对）。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** opportunity_id 进入 id 字符串，禁止冒号；白名单字符集防歧义与注入。 */
const OPPORTUNITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * 幂等键：SHA-256(action_kind + opportunity_id + draft_ref + 收件人/URL)。
 * 收件人/URL 按 registry 的 targetPayloadKeys 从 payload 依序取第一个非空值。
 */
export function computeIdempotencyKey(req: EnqueueRequest): string {
  const action = ACTION_REGISTRY[req.actionKind];
  let target = "";
  for (const key of action?.targetPayloadKeys ?? []) {
    const v = req.payload?.[key];
    if (typeof v === "string" && v.length > 0) {
      target = v;
      break;
    }
  }
  const input = [
    req.actionKind,
    req.opportunityId,
    req.draftRef ?? "",
    target,
  ].join("\n");
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function assertNonEmptyString(v: unknown, name: string): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`批准队列：${name} 必须为非空字符串`);
  }
  return v;
}

function normalizeGuardFlags(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error("批准队列：guardFlags 必须为字符串数组");
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error("批准队列：guardFlags 必须为非空字符串数组");
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * 载荷最小化（T1 §2.2 #4）：队列只存动作元数据与 draft_ref 引用，不复制
 * 材料正文。机械兜底：任何字符串字段超过 500 字符即拒绝（收件人/主题/
 * URL 等元数据永远用不到这个长度；简历/PS/套磁信正文必然超过）。
 */
const MAX_PAYLOAD_STRING = 500;

function assertPayloadStringsShort(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (value.length > MAX_PAYLOAD_STRING) {
      throw new Error(
        `批准队列：payload 字段 ${path} 超过 ${MAX_PAYLOAD_STRING} 字符，疑似正文——` +
          "载荷最小化（T1 §2.2 #4），正文只存 materials，用 draft_ref 引用",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertPayloadStringsShort(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      assertPayloadStringsShort(v, `${path}.${k}`);
    }
  }
}

// ── 存储 ─────────────────────────────────────────────────────

/**
 * 打开（不存在则创建）批准队列库，返回 ApprovalStore。
 * 与 materials 同库不同表；materials 零改动。
 */
export function createApprovalStore(
  options: ApprovalStoreOptions = {},
): ApprovalStore {
  const dbPath = options.path ?? defaultDbPath();
  const now = options.now ?? (() => new Date());
  const pendingTtlHours = options.pendingTtlHours ?? 72;
  const approvalTtlHours = options.approvalTtlHours ?? 24;

  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  // 文件由 better-sqlite3 按 umask 创建（通常 0644），收紧为仅属主可读写。
  try {
    chmodSync(dbPath, 0o600);
  } catch {
    // 最佳努力：极少数受限文件系统上 chmod 可能失败，不阻塞打开。
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_queue (
      id TEXT PRIMARY KEY,
      action_kind TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      draft_ref TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'cli',
      guard_flags TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT,
      decided_at TEXT,
      decided_via TEXT,
      decision_note TEXT,
      approval_valid_until TEXT,
      executed_at TEXT,
      execution_ref TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_approval_queue_status
      ON approval_queue (status, requested_at);
    CREATE INDEX IF NOT EXISTS idx_approval_queue_opp
      ON approval_queue (opportunity_id, action_kind);
    CREATE TABLE IF NOT EXISTS approval_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_id TEXT NOT NULL,
      event TEXT NOT NULL,
      actor TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approval_audit_approval
      ON approval_audit (approval_id, id);
    -- 审计 append-only 加固（T1 §4.2 可选加固，T2 决定启用）：
    -- store 层只暴露 appendAudit()，trigger 再兜底拒绝改写。
    CREATE TRIGGER IF NOT EXISTS approval_audit_no_update
    BEFORE UPDATE ON approval_audit
    BEGIN
      SELECT RAISE(ABORT, 'approval_audit is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS approval_audit_no_delete
    BEFORE DELETE ON approval_audit
    BEGIN
      SELECT RAISE(ABORT, 'approval_audit is append-only');
    END;
  `);

  const COLS = `id, action_kind, opportunity_id, draft_ref, payload_json,
    idempotency_key, status, requested_at, requested_by, guard_flags,
    expires_at, decided_at, decided_via, decision_note, approval_valid_until,
    executed_at, execution_ref, schema_version`;

  type Row = {
    id: string;
    action_kind: string;
    opportunity_id: string;
    draft_ref: string | null;
    payload_json: string;
    idempotency_key: string;
    status: string;
    requested_at: string;
    requested_by: string;
    guard_flags: string;
    expires_at: string | null;
    decided_at: string | null;
    decided_via: string | null;
    decision_note: string | null;
    approval_valid_until: string | null;
    executed_at: string | null;
    execution_ref: string | null;
    schema_version: number;
  };

  function rowToRecord(row: Row): ApprovalRecord {
    let guardFlags: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.guard_flags);
      if (Array.isArray(parsed)) {
        guardFlags = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      guardFlags = [];
    }
    return {
      id: row.id,
      actionKind: row.action_kind as ActionKind,
      opportunityId: row.opportunity_id,
      draftRef: row.draft_ref,
      payloadJson: row.payload_json,
      idempotencyKey: row.idempotency_key,
      status: row.status as ApprovalStatus,
      requestedAt: row.requested_at,
      requestedBy: row.requested_by,
      guardFlags,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
      decidedVia: (row.decided_via ?? null) as ApprovalRecord["decidedVia"],
      decisionNote: row.decision_note,
      approvalValidUntil: row.approval_valid_until,
      executedAt: row.executed_at,
      executionRef: row.execution_ref,
      schemaVersion: row.schema_version,
    };
  }

  function getRowById(id: string): Row | undefined {
    return db.prepare(`SELECT ${COLS} FROM approval_queue WHERE id = ?`).get(id) as Row | undefined;
  }

  function getRowByKey(key: string): Row | undefined {
    return db
      .prepare(`SELECT ${COLS} FROM approval_queue WHERE idempotency_key = ?`)
      .get(key) as Row | undefined;
  }

  /** 下一个 seq：同 (kind, opportunity) 内 id 后缀数字最大值 + 1。 */
  function nextSeq(actionKind: string, opportunityId: string): number {
    const prefix = `${actionKind}:${opportunityId}:`;
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(CAST(substr(id, ?) AS INTEGER)), 0) AS seq
         FROM approval_queue WHERE action_kind = ? AND opportunity_id = ?`,
      )
      .get(prefix.length + 1, actionKind, opportunityId) as { seq: number };
    return row.seq + 1;
  }

  const AUDIT_EVENTS: readonly AuditEvent[] = [
    "requested", "approved", "rejected", "cancelled",
    "executed", "failed", "expired", "bypass_blocked",
    "authenticity_blocked", // PRD-176/T4（#883）
  ];

  function insertAudit(
    approvalId: string,
    event: AuditEvent,
    actor: string,
    detail: Record<string, unknown>,
    at: string,
  ): AuditEntry {
    if (!AUDIT_EVENTS.includes(event)) {
      throw new Error(`批准审计：未知事件 ${event}`);
    }
    assertNonEmptyString(approvalId, "approval_id");
    assertNonEmptyString(actor, "actor");
    const info = db
      .prepare(
        `INSERT INTO approval_audit (approval_id, event, actor, detail_json, occurred_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(approvalId, event, actor, canonicalJson(detail), at);
    return {
      id: Number(info.lastInsertRowid),
      approvalId,
      event,
      actor,
      detailJson: canonicalJson(detail),
      occurredAt: at,
    };
  }

  function setRecordFields(
    id: string,
    fields: Partial<Record<string, string | null>>,
  ): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE approval_queue SET ${sets} WHERE id = ?`)
      .run(...keys.map((k) => fields[k] ?? null), id);
  }

  function hoursFromNow(hours: number): string {
    return new Date(now().getTime() + hours * 3600_000).toISOString();
  }

  const store: ApprovalStore = {
    enqueue(req) {
      if (!isActionKind(req.actionKind)) {
        throw new Error(`批准队列：未注册动作 ${String(req.actionKind)}（default-deny）`);
      }
      const opportunityId = assertNonEmptyString(req.opportunityId, "opportunity_id");
      if (!OPPORTUNITY_ID_RE.test(opportunityId)) {
        throw new Error(`批准队列：opportunity_id 含非法字符（仅限字母数字 ._ -）：${opportunityId}`);
      }
      if (typeof req.payload !== "object" || req.payload === null || Array.isArray(req.payload)) {
        throw new Error("批准队列：payload 必须为对象");
      }
      assertPayloadStringsShort(req.payload, "payload");
      const requestedBy = req.requestedBy === undefined ? "cli" : assertNonEmptyString(req.requestedBy, "requested_by");
      const guardFlags = normalizeGuardFlags(req.guardFlags);
      const draftRef = req.draftRef === undefined ? null : assertNonEmptyString(req.draftRef, "draft_ref");
      const payloadJson = canonicalJson(req.payload);
      const key = computeIdempotencyKey(req);

      const existing = getRowByKey(key);
      if (existing !== undefined) {
        // T1 §3.2：同 key 重复入队 → 直接返回既有记录，不建新行；
        // 终态记录同样原样返回，由 gate 判定重放。
        return { record: rowToRecord(existing), created: false };
      }

      const at = now().toISOString();
      const seq = nextSeq(req.actionKind, opportunityId);
      const record: ApprovalRecord = {
        id: `${req.actionKind}:${opportunityId}:${seq}`,
        actionKind: req.actionKind,
        opportunityId,
        draftRef,
        payloadJson,
        idempotencyKey: key,
        status: "pending",
        requestedAt: at,
        requestedBy,
        guardFlags,
        expiresAt: hoursFromNow(pendingTtlHours),
        decidedAt: null,
        decidedVia: null,
        decisionNote: null,
        approvalValidUntil: null,
        executedAt: null,
        executionRef: null,
        schemaVersion: 1,
      };
      db.prepare(
        `INSERT INTO approval_queue (${COLS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id, record.actionKind, record.opportunityId, record.draftRef,
        record.payloadJson, record.idempotencyKey, record.status,
        record.requestedAt, record.requestedBy, JSON.stringify(record.guardFlags),
        record.expiresAt, record.decidedAt, record.decidedVia,
        record.decisionNote, record.approvalValidUntil, record.executedAt,
        record.executionRef, record.schemaVersion,
      );
      insertAudit(record.id, "requested", requestedBy, {
        action_kind: record.actionKind,
        draft_ref: record.draftRef,
        guard_flags: record.guardFlags,
      }, at);
      return { record, created: true };
    },

    get(id) {
      const row = getRowById(id);
      return row === undefined ? undefined : rowToRecord(row);
    },

    getByIdempotencyKey(key) {
      const row = getRowByKey(key);
      return row === undefined ? undefined : rowToRecord(row);
    },

    list(filter = {}) {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.status !== undefined) {
        where.push("status = ?");
        params.push(filter.status);
      }
      if (filter.opportunityId !== undefined) {
        where.push("opportunity_id = ?");
        params.push(filter.opportunityId);
      }
      const sql = `SELECT ${COLS} FROM approval_queue
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY requested_at, rowid`;
      return (db.prepare(sql).all(...params) as Row[]).map(rowToRecord);
    },

    decide(id, decision, opts = {}) {
      const record = store.get(id);
      if (record === undefined) throw new Error(`批准队列：记录不存在 ${id}`);
      const via = opts.via === undefined ? "cli" : opts.via;
      if (via !== "cli" && via !== "ui") throw new Error("批准队列：decided_via 只允许 cli/ui");
      const at = now().toISOString();
      // 惰性过期：pending 过期后不可再决定（终态）。
      if (record.status === "pending" && record.expiresAt !== null && record.expiresAt <= at) {
        setRecordFields(id, { status: "expired" });
        insertAudit(id, "expired", "system", { reason: "pending_ttl" }, at);
        throw new Error(`批准队列：请求已过期（${record.expiresAt}），须重新发起`);
      }
      if (record.status !== "pending") {
        throw new Error(`批准队列：记录处于终态 ${record.status}，不可再决定（只能新开记录）`);
      }
      const note = opts.note === undefined ? null : assertNonEmptyString(opts.note, "note").slice(0, 500);
      if (decision === "approved") {
        setRecordFields(id, {
          status: "approved",
          decided_at: at,
          decided_via: via,
          decision_note: note,
          approval_valid_until: hoursFromNow(approvalTtlHours),
        });
        insertAudit(id, "approved", via, { note }, at);
      } else if (decision === "rejected") {
        setRecordFields(id, {
          status: "rejected",
          decided_at: at,
          decided_via: via,
          decision_note: note,
        });
        insertAudit(id, "rejected", via, { note }, at);
      } else {
        throw new Error(`批准队列：未知决定 ${String(decision)}`);
      }
      return store.get(id) as ApprovalRecord;
    },

    cancel(id, opts = {}) {
      const record = store.get(id);
      if (record === undefined) throw new Error(`批准队列：记录不存在 ${id}`);
      if (record.status !== "pending") {
        throw new Error(`批准队列：记录处于终态 ${record.status}，不可撤回`);
      }
      const at = now().toISOString();
      setRecordFields(id, {
        status: "cancelled",
        decided_at: at,
        decided_via: opts.via ?? "cli",
        decision_note: opts.note ?? null,
      });
      insertAudit(id, "cancelled", opts.via ?? "cli", { note: opts.note ?? null }, at);
      return store.get(id) as ApprovalRecord;
    },

    /** 惰性清理：把超过 pending TTL 的记录转入 expired 终态并留审计。 */
    expirePending() {
      const at = now().toISOString();
      const stale = db
        .prepare(
          `SELECT ${COLS} FROM approval_queue
           WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`,
        )
        .all(at) as Row[];
      for (const row of stale) {
        setRecordFields(row.id, { status: "expired" });
        insertAudit(row.id, "expired", "system", { reason: "pending_ttl" }, at);
      }
      return stale.length;
    },

    /** 批准有效期已过（执行前校验发现）：approved → expired 终态并留审计。 */
    expireApproval(id) {
      const record = store.get(id);
      if (record === undefined) throw new Error(`批准队列：记录不存在 ${id}`);
      if (record.status !== "approved") {
        throw new Error(`批准队列：记录非 approved 态（${record.status}），不可按过期处理`);
      }
      const at = now().toISOString();
      setRecordFields(id, { status: "expired" });
      insertAudit(id, "expired", "system", { reason: "approval_validity" }, at);
      return store.get(id) as ApprovalRecord;
    },

    recordExecuted(id, executionRef, opts = {}) {
      const record = store.get(id);
      if (record === undefined) throw new Error(`批准队列：记录不存在 ${id}`);
      if (record.status !== "approved") {
        throw new Error(`批准队列：仅 approved 记录可标记执行（当前 ${record.status}）`);
      }
      const at = now().toISOString();
      setRecordFields(id, {
        status: "executed",
        executed_at: at,
        execution_ref: executionRef ?? null,
      });
      insertAudit(id, "executed", opts.actor ?? "system", {
        execution_ref: executionRef ?? null,
      }, at);
      return store.get(id) as ApprovalRecord;
    },

    recordFailed(id, reasonSummary, opts = {}) {
      const record = store.get(id);
      if (record === undefined) throw new Error(`批准队列：记录不存在 ${id}`);
      if (record.status !== "approved") {
        throw new Error(`批准队列：仅 approved 记录可标记失败（当前 ${record.status}）`);
      }
      const at = now().toISOString();
      setRecordFields(id, { status: "failed" });
      // 脱敏（T1 §4.3）：detail 只存失败原因摘要，不存正文/载荷原文。
      insertAudit(id, "failed", opts.actor ?? "system", {
        reason: String(reasonSummary ?? "").slice(0, 200),
      }, at);
      return store.get(id) as ApprovalRecord;
    },

    appendAudit(approvalId, event, actor, detail) {
      return insertAudit(approvalId, event, actor, detail, now().toISOString());
    },

    auditFor(approvalId) {
      const rows = db
        .prepare(
          `SELECT id, approval_id, event, actor, detail_json, occurred_at
           FROM approval_audit WHERE approval_id = ? ORDER BY id`,
        )
        .all(approvalId) as Array<{
        id: number;
        approval_id: string;
        event: string;
        actor: string;
        detail_json: string;
        occurred_at: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        approvalId: row.approval_id,
        event: row.event as AuditEvent,
        actor: row.actor,
        detailJson: row.detail_json,
        occurredAt: row.occurred_at,
      }));
    },

    close() {
      db.close();
    },
  };

  return store;
}

export type ApprovalStore = {
  enqueue(req: EnqueueRequest): EnqueueResult;
  get(id: string): ApprovalRecord | undefined;
  getByIdempotencyKey(key: string): ApprovalRecord | undefined;
  list(filter?: { status?: ApprovalStatus; opportunityId?: string }): ApprovalRecord[];
  /** 状态机：pending → approved / rejected（终态不可再改，T1 §4.1）。 */
  decide(
    id: string,
    decision: "approved" | "rejected",
    opts?: { via?: "cli" | "ui"; note?: string },
  ): ApprovalRecord;
  /** 状态机：pending → cancelled（用户撤回）。 */
  cancel(id: string, opts?: { via?: "cli" | "ui"; note?: string }): ApprovalRecord;
  /** pending 过期清理（72h 未决定，system 自动）。 */
  expirePending(): number;
  /** approved 批准有效期已过（执行前校验，T1 §3.1 approval_valid_until）。 */
  expireApproval(id: string): ApprovalRecord;
  /** approved → executed（终态），记录回执引用。 */
  recordExecuted(id: string, executionRef?: string, opts?: { actor?: string }): ApprovalRecord;
  /** approved → failed（终态，重试须新请求），只留原因摘要。 */
  recordFailed(id: string, reasonSummary: string, opts?: { actor?: string }): ApprovalRecord;
  /** append-only：绕过队列的尝试（bypass_blocked）由 gate 写入；trigger 兜底拒绝改写。 */
  appendAudit(
    approvalId: string,
    event: AuditEvent,
    actor: string,
    detail: Record<string, unknown>,
  ): AuditEntry;
  auditFor(approvalId: string): AuditEntry[];
  close(): void;
};
