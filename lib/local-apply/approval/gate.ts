/**
 * 批准门执行口（gate）—— PRD-175/T2（trend #876）。
 *
 * T1 规范：PRD-175/T1《批准队列 schema + 不可逆动作清单》§2.2/§3.2/§4
 * （中央仓库 zhanglunet/trend，adopted/drafts/prd-175-pre-apply-approval-gate-t1.md）。
 *
 * 职责（T1 §2.2 注册规则）：
 * 1. default-deny：未注册动作一律拒绝，并写 `bypass_blocked` 审计事件；
 * 2. 单一执行口：一切不可逆动作只能经 execute() 发出；execute 在拿到
 *    「approved 且在批准有效期内、载荷与批准时完全一致」的记录前，
 *    绝不调用执行回调（无批准不可执行——PRD-175/T2 验收标准）；
 * 3. dry-run：preview() 统一预演（校验全走一遍，但不执行、不改状态）；
 * 4. 幂等与防重放：执行前重算幂等键并逐字节比对载荷，载荷有变即拒绝
 *    （防「批准 A、偷换执行 B」）；终态记录不复活，重放被拒并留审计。
 *
 * posting-guard 结论强制入队（T1 §5.5）：A1/A2 的入队请求必须携带
 * guardFlags（上游 scanPostingText 的 flag kinds，可为空数组但字段必须
 * 存在）；带 flag 的记录在 T3 确认界面醒目展示，不允许自动批准。
 *
 * 本模块自身不联网、不实现任何具体发送：执行回调（runner）由调用方注入，
 * 且只有 execute() 在校验全部通过后才会调用它一次。
 */

import {
  createApprovalStore,
  computeIdempotencyKey,
  canonicalJson,
  type ApprovalRecord,
  type ApprovalStore,
  type ApprovalStoreOptions,
} from "./store.ts";
import { T2_ENFORCED_KINDS, getRegisteredAction, type ActionKind, type RegisteredAction } from "./registry.ts";

// ── 错误 ─────────────────────────────────────────────────────

export type ApprovalErrorCode =
  /** 未注册动作（default-deny 命中，已留 bypass_blocked 审计）。 */
  | "BYPASS_UNREGISTERED"
  /** 无批准记录或记录未批准（已入队等待人工批准）。 */
  | "NOT_APPROVED"
  /** 同幂等键记录已处终态，重放被拒（已留 bypass_blocked 审计）。 */
  | "REPLAY_TERMINAL"
  /** 载荷与批准时不一致（防偷换，已留 bypass_blocked 审计）。 */
  | "PAYLOAD_MISMATCH"
  /** 批准有效期已过（记录转入 expired，须重新批准）。 */
  | "APPROVAL_EXPIRED"
  /** 请求不满足注册动作的必填约束（draft_ref / guardFlags）。 */
  | "INVALID_REQUEST";

export type ApprovalError = Error & { code: ApprovalErrorCode };

export function approvalError(code: ApprovalErrorCode, message: string): ApprovalError {
  const err = new Error(message) as ApprovalError;
  err.code = code;
  return err;
}

// ── 请求与结果 ───────────────────────────────────────────────

export type ApprovalRequest = {
  actionKind: ActionKind;
  opportunityId: string;
  /** 引用 materials.id（A1/A2 必填）。 */
  draftRef?: string;
  /** 动作载荷元数据（收件人、目标 url 等；绝不放材料正文）。 */
  payload: Record<string, unknown>;
  /** 上游 posting-guard 结论（flag kinds；A1/A2 强制携带，可为空数组）。 */
  guardFlags?: string[];
  /** 机会真实性状态（PRD-176/T4 联动，#883）：suspicious 的强制动作默认不可投。 */
  authenticityState?: "trusted" | "pending" | "suspicious" | "unverified";
  /** 触发来源：`cli:<command>` 或 `ui`；缺省 `cli`。 */
  requestedBy?: string;
};

/** 执行回调：只有校验全部通过后才会被调用一次。 */
export type ApprovalRunner = (
  payload: Record<string, unknown>,
  record: ApprovalRecord,
) => { executionRef?: string } | void;

export type RequestResult = {
  record: ApprovalRecord;
  /** false = 同幂等键已有记录（重复入队被去重）。 */
  created: boolean;
};

export type ExecuteResult = {
  record: ApprovalRecord;
  /** runner 返回的外部回执引用（如虚构形态 `<receipt@example.invalid>`）。 */
  executionRef?: string;
};

export type PreviewResult = {
  action: RegisteredAction;
  /** 幂等键对应的既有记录（可能为空）。 */
  record: ApprovalRecord | null;
  state:
    | "queued"        // pending，待人工批准
    | "approved"      // 已批准（未必仍有效，见 wouldExecute）
    | "terminal"      // 终态，重放被拒
    | "missing";      // 尚未入队
  /** 校验全通过、真执行会调 runner。 */
  wouldExecute: boolean;
  /** 不执行的原因（wouldExecute=false 时给出）。 */
  blockedReason?: string;
};

export type ApprovalGateOptions = ApprovalStoreOptions & {
  /** 复用已有 store（如与草稿库共享连接）；缺省按 path 新开。 */
  store?: ApprovalStore;
};

export type ApprovalGate = {
  /** 入队：校验注册表与必填约束后写 pending 记录（同键去重）。 */
  requestApproval(req: ApprovalRequest): RequestResult;
  /** 唯一执行口：无批准不可执行；通过后调用 runner 恰好一次。 */
  execute(req: ApprovalRequest, runner: ApprovalRunner): ExecuteResult;
  /** dry-run：全量校验、绝不执行、绝不改状态（T1 §2.2 #3）。 */
  preview(req: ApprovalRequest): PreviewResult;
  /** 状态机决定口（T3 CLI 的 approve/reject 将接在这里）。 */
  decide(
    id: string,
    decision: "approved" | "rejected",
    opts?: { via?: "cli" | "ui"; note?: string },
  ): ApprovalRecord;
  cancel(id: string, opts?: { via?: "cli" | "ui"; note?: string }): ApprovalRecord;
  get(id: string): ApprovalRecord | undefined;
  list(filter?: { status?: ApprovalRecord["status"]; opportunityId?: string }): ApprovalRecord[];
  auditFor(approvalId: string): ReturnType<ApprovalStore["auditFor"]>;
  /** append-only 审计口（T3 确认入口展示/留痕用；绕过尝试由 gate 自写）。 */
  appendAudit(
    approvalId: string,
    event: Parameters<ApprovalStore["appendAudit"]>[1],
    actor: string,
    detail: Record<string, unknown>,
  ): ReturnType<ApprovalStore["appendAudit"]>;
  close(): void;
};

// ── 校验 ─────────────────────────────────────────────────────

function validateRequest(req: ApprovalRequest): RegisteredAction {
  const action = getRegisteredAction(req.actionKind);
  if (action === undefined) {
    throw approvalError(
      "BYPASS_UNREGISTERED",
      `未注册动作 ${String(req.actionKind)}：default-deny，未入队列、未执行（已留审计）`,
    );
  }
  if (action.draftRefRequired && (typeof req.draftRef !== "string" || req.draftRef.trim().length === 0)) {
    throw approvalError(
      "INVALID_REQUEST",
      `${action.kind} 要求 draft_ref（引用 materials 草稿，不复制正文）`,
    );
  }
  if (action.guardFlagsRequired && !Array.isArray(req.guardFlags)) {
    throw approvalError(
      "INVALID_REQUEST",
      `${action.kind} 要求强制携带 guardFlags（上游 posting-guard 结论；无命中传空数组）`,
    );
  }
  return action;
}

function bypassAuditId(actionKind: string): string {
  return `bypass:${actionKind || "unknown"}`;
}

/**
 * default-deny 的落点：未注册动作在拒绝的同时写 bypass_blocked 审计
 * （T1 §2.2 #1：未注册动作一律拒绝，并写 bypass_blocked 审计事件）。
 */
function enforceRegistered(
  req: ApprovalRequest,
  writeAudit: (approvalId: string, event: "bypass_blocked", actor: string, detail: Record<string, unknown>) => void,
): RegisteredAction {
  try {
    return validateRequest(req);
  } catch (err) {
    if ((err as ApprovalError)?.code === "BYPASS_UNREGISTERED") {
      writeAudit(
        bypassAuditId(String(req.actionKind)),
        "bypass_blocked",
        req.requestedBy ?? "cli",
        { reason: "unregistered_action", action_kind: String(req.actionKind) },
      );
    }
    throw err;
  }
}
// ── 工厂 ─────────────────────────────────────────────────────

/**
 * 创建批准门。store 可注入（测试传临时路径新建即可）。
 * 时间源经 options.now 注入，测试请传固定值。
 */
export function createApprovalGate(options: ApprovalGateOptions = {}): ApprovalGate {
  const store = options.store ?? createApprovalStore(options);
  const now = options.now ?? (() => new Date());

  /** 惰性过期：pending 超 72h 未决定 → expired（终态）。 */
  function sweepExpired(): void {
    store.expirePending();
  }

  function findByRequest(req: ApprovalRequest): ApprovalRecord | undefined {
    return store.getByIdempotencyKey(computeIdempotencyKey(req));
  }

  function requireConsistentAction(record: ApprovalRecord, req: ApprovalRequest): void {
    if (record.actionKind !== req.actionKind || record.opportunityId !== req.opportunityId) {
      // 幂等键碰撞（理论不可能）或构造错误：按未批准处理，绝不执行。
      throw approvalError("NOT_APPROVED", `幂等键对应记录与请求不符（${record.id}）`);
    }
  }

  const gate: ApprovalGate = {
    requestApproval(req) {
      enforceRegistered(req, (id, event, actor, detail) => store.appendAudit(id, event, actor, detail));
      // PRD-176/T4（#883）：可疑机会的强制动作默认不可投（T1 §五联动）。
      // pending/trusted/unverified 不拦（unverified 是存量未复核，不等于可疑）；
      // 人工确认真伪后经 authenticity 覆盖字段改判即可入队（T1 §三人工覆盖）。
      if (
        req.authenticityState === "suspicious" &&
        T2_ENFORCED_KINDS.includes(req.actionKind)
      ) {
        store.appendAudit(
          `auth-blocked-${Date.parse(now())}-${Math.floor(Math.random() * 1e6)}`,
          "authenticity_blocked",
          "system",
          { actionKind: req.actionKind, opportunityId: req.opportunityId },
        );
        throw approvalError(
          "AUTHENTICITY_SUSPICIOUS",
          "机会真实性状态为 suspicious（可疑）：默认不可投递；确认真伪并覆盖状态后重试",
        );
      }
      sweepExpired();
      const result = store.enqueue({
        actionKind: req.actionKind,
        opportunityId: req.opportunityId,
        draftRef: req.draftRef,
        payload: req.payload,
        guardFlags: req.guardFlags,
        requestedBy: req.requestedBy,
      });
      if (!result.created) {
        const record = result.record;
        if (record.status === "executed" || record.status === "failed" ||
            record.status === "expired" || record.status === "rejected" ||
            record.status === "cancelled") {
          // 终态不复活（T1 §3.2）：同键再请求按重放拒绝并留审计。
          store.appendAudit(bypassAuditId(req.actionKind), "bypass_blocked", req.requestedBy ?? "cli", {
            reason: "replay_terminal",
            related_id: record.id,
            status: record.status,
          });
          throw approvalError(
            "REPLAY_TERMINAL",
            `同幂等键记录已处终态 ${record.status}（${record.id}）：不复活旧记录；` +
              `要重新发起请产生新的请求输入（如重开草稿得到新 draft_ref）`,
          );
        }
        if (record.actionKind !== req.actionKind || record.opportunityId !== req.opportunityId) {
          throw approvalError("NOT_APPROVED", `幂等键对应记录与请求不符（${record.id}）`);
        }
        return { record, created: false };
      }
      return result;
    },

    execute(req, runner) {
      enforceRegistered(req, (id, event, actor, detail) => store.appendAudit(id, event, actor, detail));
      // PRD-176/T4（#883）：可疑机会的强制动作默认不可投（T1 §五联动）。
      // pending/trusted/unverified 不拦（unverified 是存量未复核，不等于可疑）；
      // 人工确认真伪后经 authenticity 覆盖字段改判即可入队（T1 §三人工覆盖）。
      if (
        req.authenticityState === "suspicious" &&
        T2_ENFORCED_KINDS.includes(req.actionKind)
      ) {
        store.appendAudit(
          `auth-blocked-${Date.parse(now())}-${Math.floor(Math.random() * 1e6)}`,
          "authenticity_blocked",
          "system",
          { actionKind: req.actionKind, opportunityId: req.opportunityId },
        );
        throw approvalError(
          "AUTHENTICITY_SUSPICIOUS",
          "机会真实性状态为 suspicious（可疑）：默认不可投递；确认真伪并覆盖状态后重试",
        );
      }
      sweepExpired();

      let record = findByRequest(req);
      if (record === undefined) {
        // 无批准不可执行：先入队（强制走批准流程），再拒绝执行。
        const enqueued = store.enqueue({
          actionKind: req.actionKind,
          opportunityId: req.opportunityId,
          draftRef: req.draftRef,
          payload: req.payload,
          guardFlags: req.guardFlags,
          requestedBy: req.requestedBy,
        });
        record = enqueued.record;
        throw approvalError(
          "NOT_APPROVED",
          `无批准不可执行：已入队 ${record.id}（pending），待人工批准后重试`,
        );
      }

      requireConsistentAction(record, req);

      if (record.status === "pending") {
        throw approvalError(
          "NOT_APPROVED",
          `待人工批准（${record.id}）；可先 preview() 查看队列状态`,
        );
      }
      if (record.status !== "approved") {
        // 终态（executed/failed/expired/rejected/cancelled）：重放被拒。
        store.appendAudit(bypassAuditId(req.actionKind), "bypass_blocked", req.requestedBy ?? "cli", {
          reason: "replay_terminal",
          related_id: record.id,
          status: record.status,
        });
        throw approvalError(
          "REPLAY_TERMINAL",
          `记录已处终态 ${record.status}（${record.id}）：终态不可再执行；` +
            `重试 = 新请求新批准（产生新的请求输入，如新 draft_ref）`,
        );
      }

      // 防偷换（T1 §3.2）：载荷逐字节比对，有变即拒绝。
      const payloadJson = canonicalJson(req.payload);
      if (payloadJson !== record.payloadJson) {
        store.appendAudit(bypassAuditId(req.actionKind), "bypass_blocked", req.requestedBy ?? "cli", {
          reason: "payload_mismatch",
          related_id: record.id,
        });
        throw approvalError(
          "PAYLOAD_MISMATCH",
          `载荷与批准时不一致（${record.id}）：拒绝执行（防"批准 A、偷换执行 B"）`,
        );
      }

      // 批准有效期（T1 §3.1 approval_valid_until）：过期须重新批准。
      const at = now().toISOString();
      if (record.approvalValidUntil !== null && record.approvalValidUntil <= at) {
        store.expireApproval(record.id);
        throw approvalError(
          "APPROVAL_EXPIRED",
          `批准已过有效期（${record.approvalValidUntil}）：记录转入 expired，须重新批准`,
        );
      }

      try {
        const result = runner(req.payload, record) ?? {};
        const updated = store.recordExecuted(record.id, result.executionRef);
        return { record: updated, executionRef: result.executionRef };
      } catch (err) {
        // failed 为终态：重试 = 新请求新批准（T1 §3.2）。
        store.recordFailed(record.id, (err as Error)?.message ?? "runner failed");
        throw err;
      }
    },

    preview(req) {
      const action = enforceRegistered(req, (id, event, actor, detail) => store.appendAudit(id, event, actor, detail));
      sweepExpired();
      const record = findByRequest(req) ?? null;
      const base: PreviewResult = {
        action,
        record,
        state: record === null ? "missing" : record.status === "pending" ? "queued" : record.status === "approved" ? "approved" : "terminal",
        wouldExecute: false,
      };
      if (record === null) {
        base.blockedReason = "尚未入队：先 requestApproval() 进入批准队列";
        return base;
      }
      if (record.status === "pending") {
        base.blockedReason = "待人工批准";
        return base;
      }
      if (record.status !== "approved") {
        base.blockedReason = `终态 ${record.status}：重试须新请求新批准`;
        return base;
      }
      if (canonicalJson(req.payload) !== record.payloadJson) {
        base.blockedReason = "载荷与批准时不一致（须重新批准）";
        return base;
      }
      const at = now().toISOString();
      if (record.approvalValidUntil !== null && record.approvalValidUntil <= at) {
        base.blockedReason = `批准已过有效期（${record.approvalValidUntil}）`;
        return base;
      }
      base.wouldExecute = true;
      return base;
    },

    decide(id, decision, opts) {
      return store.decide(id, decision, opts);
    },

    cancel(id, opts) {
      return store.cancel(id, opts);
    },

    get(id) {
      return store.get(id);
    },

    list(filter) {
      return store.list(filter);
    },

    auditFor(approvalId) {
      return store.auditFor(approvalId);
    },

    /** append-only 审计口（T3 确认入口展示/留痕用；绕过尝试由 gate 自写）。 */
    appendAudit(
      approvalId: string,
      event: Parameters<ApprovalStore["appendAudit"]>[1],
      actor: string,
      detail: Record<string, unknown>,
    ) {
      return store.appendAudit(approvalId, event, actor, detail);
    },

    close() {
      store.close();
    },
  };

  return gate;
}
