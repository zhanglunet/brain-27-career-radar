// PRD-281/T3: 草稿确认流正式化（trend issue #1408）。
//
// 本模块是 T2 原语（lib/profile-draft.mjs：makeDraft / confirmDraft /
// rollbackToPrev）之上的显式确认流 API 层——不重复造轮子：生效仍走 T2
// confirmDraft（指纹重验 + 原子生效 + 上一版自动保留），回滚仍走 T2
// rollbackToPrev；本层补齐 T2 缺的流语义：
//   1. confirmFlow(draft, currentDoc, confirmer, at)——显式确认人 + 时刻，
//      成功后登记 {event: "confirmed", confirmer, at} 审计事件；
//   2. draftState(draft) → "draft | confirmed | rolled-back" 生命周期状态查询；
//   3. 进程内 append-only 审计事件流 + exportAuditEvents() 导出。
//
// 生命周期（本层钉死，正式化语义）：
//   draft ──confirmFlow（成功）──▶ confirmed ──rollbackFlow（成功）──▶ rolled-back
//   draft ──confirmFlow（指纹漂移）──▶ 保持 draft（confirm_conflict，可 rebase 后重来）
//   confirmed / rolled-back 的草稿不得再 confirm（rebase = 建新草稿，与 T2 语义一致）；
//   rolled-back 的草稿不得经本层再回滚（prev 链进一步回退直接用 T2 rollbackToPrev）。
//
// 红线（与 T1 §4 / T2 一致，逐条遵守）：
// - confirm ≠ 外发：零投递/零发送/零上传依赖，投递动作仍走 PRD-175 批准门；
// - 回滚一律人工触发：本层无自动 confirm、无自动 rollback 路径；
// - 审计零字段值：事件只含指纹 / pointer 路径 / 计数，绝不含档案字段值正文
//   （与 175 审计"载荷最小化"同一纪律）；
// - 拒绝不静默：无 confirmer、生命周期非法、指纹漂移、rollback 拒绝全部留审计事件；
// - 纯 ESM、零新增依赖（仅复用 node 内建与 T2 模块）、零网络、零落盘 IO
//   （审计事件进程内 append-only，DB/文件接线归后续任务）。

import {
  PROFILE_DRAFT_SCHEMA,
  confirmDraft,
  fingerprintDoc,
  rollbackToPrev,
} from "./profile-draft.mjs";

/** 草稿生命周期三态（draftState 返回值域）。 */
export const DRAFT_STATES = ["draft", "confirmed", "rolled-back"];

/** 进程内审计事件流（append-only，只增不减；深拷贝导出防外部改写）。 */
const AUDIT_EVENTS = [];

function audit(event, at, fields = {}) {
  const record = { event, at };
  for (const key of Object.keys(fields).sort()) {
    if (fields[key] !== undefined) record[key] = fields[key];
  }
  AUDIT_EVENTS.push(record);
  return record;
}

/** 缺省时刻：UTC ISO8601（测试请显式注入 at，保证确定性）。 */
function nowIso() {
  return new Date().toISOString();
}

/** at 合法性：可缺省（取当前时刻），给了必须是非空字符串。 */
function normalizeAt(at) {
  if (at === undefined || at === null) return nowIso();
  if (typeof at !== "string" || at.trim() === "") {
    throw new Error(`at 须为非空 ISO8601 字符串：${String(at)}`);
  }
  return at;
}

/** 结构校验：非 profile-draft-v1 草稿对象直接抛错（与 T2 confirmDraft 同纪律）。 */
function requireDraft(draft) {
  if (!draft || typeof draft !== "object" || draft.schema !== PROFILE_DRAFT_SCHEMA) {
    throw new Error("非 profile-draft-v1 草稿对象，拒绝进入确认流");
  }
}

/** confirmer 合法性：必须是非空字符串（trim 后非空）。 */
function isValidConfirmer(confirmer) {
  return typeof confirmer === "string" && confirmer.trim() !== "";
}

/**
 * 草稿确认流：显式确认人 + 时刻，包装 T2 confirmDraft（指纹重验 + 原子生效 +
 * 上一版自动保留），成功后登记 {event: "confirmed", confirmer, at} 审计事件。
 *
 * 拒绝路径（返回 {applied:false, refused:true, reason}，不抛不吞，全部留审计）：
 * - confirmer 缺失/空白/非字符串 → reason "confirmer_required"；
 * - 草稿已是 confirmed → reason "draft_already_confirmed"（重确认一律拒绝，
 *   幂等重放请走新草稿）；
 * - 草稿已是 rolled-back → reason "draft_already_rolled_back"（rebase = 建新草稿）。
 * 冲突路径（指纹漂移，T2 confirmDraft 返回 conflict）→ 登记 confirm_conflict
 * 事件，草稿保持 draft（可 rebase 后重新进入确认流），返回 T2 原结果。
 *
 * @param {object} draft profile-draft-v1 草稿（成功后本层推进其 state 字段）
 * @param {object} currentDoc 当前档案对象（只读，T2 保证生效前分毫不动）
 * @param {string} confirmer 确认人标识（必填，审计留痕）
 * @param {string} [at] 确认时刻 ISO8601（缺省取当前 UTC 时刻）
 * @returns {object} 生效 → {applied:true, newDoc, state:"confirmed"}；
 *   冲突 → T2 confirm_conflict 结果 + state:"draft"；
 *   流拒绝 → {applied:false, refused:true, reason, state}
 */
export function confirmFlow(draft, currentDoc, confirmer, at) {
  requireDraft(draft);
  const when = normalizeAt(at);
  const state = draftState(draft);

  if (!isValidConfirmer(confirmer)) {
    audit("confirm_refused", when, { reason: "confirmer_required" });
    return { applied: false, refused: true, reason: "confirmer_required", state };
  }
  if (state !== "draft") {
    const reason = state === "confirmed" ? "draft_already_confirmed" : "draft_already_rolled_back";
    audit("confirm_refused", when, { confirmer, reason });
    return { applied: false, refused: true, reason, state };
  }

  const result = confirmDraft(draft, currentDoc);
  if (!result.applied) {
    // 指纹漂移（confirm_conflict）：草稿保持 draft，审计留痕，不合并不覆盖。
    audit("confirm_conflict", when, {
      confirmer,
      expected_fingerprint: result.expected_fingerprint,
      actual_fingerprint: result.actual_fingerprint,
    });
    return { ...result, state };
  }

  // 生效成功：审计（只指纹 / pointer 路径 / 计数，零档案字段值）+ 状态推进。
  audit("confirmed", when, {
    confirmer,
    target_fingerprint: draft.target_fingerprint,
    change_count: draft.changes.length,
    pointers: draft.changes.map((c) => c.path),
  });
  draft.state = "confirmed";
  return { ...result, state: "confirmed" };
}

/**
 * 回滚流：包装 T2 rollbackToPrev（上一版自动保留在 newDoc.prev，单槽链），
 * 成功后登记 {event: "rolled_back", at, from_fingerprint, to_fingerprint}，
 * 并把草稿状态推进为 "rolled-back"。
 *
 * 拒绝路径（不抛不吞，全部留审计）：
 * - 草稿尚是 draft（从未确认）→ reason "draft_not_confirmed"（无可回滚的确认）；
 * - 草稿已是 rolled-back → reason "draft_already_rolled_back"
 *   （同一草稿只回滚一次；prev 链更早版本的回退直接用 T2 rollbackToPrev）；
 * - doc 无 prev → 透传 T2 的 rollback_refused（回滚可再回滚由 prev 链保证，
 *   本层不吞）。
 *
 * @param {object} draft 已进入确认流的草稿
 * @param {object} doc 确认生效后的档案对象（含 prev 单槽链）
 * @param {string} [at] 回滚时刻 ISO8601（缺省取当前 UTC 时刻）
 * @returns {object} 成功 → {restored:true, doc, state:"rolled-back"}；
 *   拒绝 → {restored:false, reason, state}
 */
export function rollbackFlow(draft, doc, at) {
  requireDraft(draft);
  const when = normalizeAt(at);
  const state = draftState(draft);

  if (state === "draft") {
    audit("rollback_refused", when, { reason: "draft_not_confirmed" });
    return { restored: false, reason: "draft_not_confirmed", state };
  }
  if (state === "rolled-back") {
    audit("rollback_refused", when, { reason: "draft_already_rolled_back" });
    return { restored: false, reason: "draft_already_rolled_back", state };
  }

  const result = rollbackToPrev(doc);
  if (!result.restored) {
    audit("rollback_refused", when, { reason: result.reason });
    return { ...result, state };
  }
  audit("rolled_back", when, {
    from_fingerprint: fingerprintDoc(doc),
    to_fingerprint: fingerprintDoc(result.doc),
  });
  draft.state = "rolled-back";
  return { ...result, state: "rolled-back" };
}

/**
 * 草稿生命周期状态查询："draft | confirmed | rolled-back"。
 * - 本层确认流推进过的草稿：读其 state 字段（confirmFlow / rollbackFlow 写入）；
 * - T2 makeDraft 直建的草稿（state:"draft" 或缺省）→ "draft"；
 * - 非法草稿对象抛错；无法识别的 state 值抛错（状态面 fail-close）。
 */
export function draftState(draft) {
  requireDraft(draft);
  const state = draft.state;
  if (state === undefined || state === null || state === "draft") return "draft";
  if (state === "confirmed" || state === "rolled-back") return state;
  throw new Error(`无法识别的草稿状态：${String(state)}`);
}

/**
 * 导出审计事件（append-only 只增不减；深拷贝防外部改写）。
 * 事件种类：confirmed / confirm_conflict / confirm_refused / rolled_back /
 * rollback_refused——零档案字段值，只含指纹 / pointer 路径 / 计数 / 时刻。
 */
export function exportAuditEvents() {
  return structuredClone(AUDIT_EVENTS);
}

/** 清空进程内审计事件（测试隔离与运维重置用）。 */
export function resetAuditEvents() {
  AUDIT_EVENTS.length = 0;
}
