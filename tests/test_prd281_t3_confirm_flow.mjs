// PRD-281/T3: 草稿确认流正式化测试（trend issue #1408）。
//
// 覆盖 T3 验收切片：确认流完整（draft→confirmed→事件）/ 指纹冲突拒绝路径 /
// 回滚后状态 rolled-back / 审计导出（只增不减、零字段值、深拷贝）/
// 无 confirmer 拒绝 / 生命周期拒绝（重确认、回滚后再确认）/ 确定性。
// 本层为 T2 原语（lib/profile-draft.mjs）之上的显式确认流 API，
// 生效/回滚语义不重复实现——T2 测试（tests/test_prd281_t2_draft.mjs）继续守护原语。
// 样例档案全虚构（example.com 保留域、占位姓名）。
import assert from "node:assert/strict";
import test from "node:test";

import { confirmDraft, makeDraft, rollbackToPrev } from "../lib/profile-draft.mjs";
import {
  DRAFT_STATES,
  confirmFlow,
  draftState,
  exportAuditEvents,
  resetAuditEvents,
  rollbackFlow,
} from "../lib/profile-confirm-flow.mjs";

// 全虚构样例档案（JobDocProfile 六区块的虚构子集）
const PROFILE = {
  basics: { name: "示例同学", email: "placeholder@example.com", phone: "000-0000-0000" },
  education: ["2027 年实验心理学硕士（虚构样例）"],
  experience: ["脑电信号采集与分析项目（虚构样例）"],
  skills: ["Python", "脑机接口"],
  outputs: ["校内技术报告一篇（虚构样例）"],
  target: { direction: "脑机接口方向（虚构样例）" },
};

const CHANGES = [
  { op: "replace", path: "/skills/1", value: "神经信号处理" },
  { op: "replace", path: "/target/direction", value: "脑机接口 × 神经工程（虚构）" },
];
const CONFIRMER = "cli:operator-example";
const AT = "2026-10-29T10:00:00Z";
const ROLLBACK_AT = "2026-10-29T11:00:00Z";

test("T3-1 · 确认流完整：draft→confirmed，登记 {event:'confirmed', confirmer, at}，上一版保留", () => {
  resetAuditEvents();
  const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  const before = structuredClone(PROFILE);

  const result = confirmFlow(draft, PROFILE, CONFIRMER, AT);
  assert.equal(result.applied, true);
  assert.equal(result.state, "confirmed");
  assert.equal(draftState(draft), "confirmed", "草稿状态推进为 confirmed");
  assert.deepEqual(PROFILE, before, "currentDoc 原对象分毫不动（T2 原子性不因包装而丢）");
  assert.equal(result.newDoc.skills[1], "神经信号处理");
  assert.deepEqual(result.newDoc.prev, PROFILE, "上一版自动保留（T2 能力原样可用）");

  const events = exportAuditEvents();
  const confirmed = events.find((e) => e.event === "confirmed");
  assert.ok(confirmed, "confirmed 事件已登记");
  assert.equal(confirmed.event, "confirmed");
  assert.equal(confirmed.confirmer, CONFIRMER);
  assert.equal(confirmed.at, AT);
  assert.equal(confirmed.target_fingerprint, draft.target_fingerprint);
  assert.equal(confirmed.change_count, CHANGES.length);
  assert.deepEqual(confirmed.pointers, ["/skills/1", "/target/direction"], "只路径、无值");
});

test("T3-2 · conflict 拒绝路径：指纹漂移 → confirm_conflict 事件，草稿保持 draft 可 rebase", () => {
  resetAuditEvents();
  const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  const drifted = structuredClone(PROFILE);
  drifted.experience.push("草稿之后的手改条目（虚构）");
  const before = structuredClone(drifted);

  const result = confirmFlow(draft, drifted, CONFIRMER, AT);
  assert.equal(result.applied, false);
  assert.equal(result.conflict, true, "透传 T2 confirm_conflict 结果");
  assert.equal(result.reason, "confirm_conflict");
  assert.equal(result.state, "draft", "冲突不推进生命周期，可 rebase 后重来");
  assert.deepEqual(drifted, before, "拒绝时漂移档案分毫不动");

  const event = exportAuditEvents().find((e) => e.event === "confirm_conflict");
  assert.ok(event, "confirm_conflict 事件已登记");
  assert.equal(event.confirmer, CONFIRMER);
  assert.equal(event.at, AT);
  assert.equal(event.expected_fingerprint, draft.target_fingerprint);
  assert.ok(event.actual_fingerprint && event.actual_fingerprint.length === 64);
});

test("T3-3 · 回滚后状态 rolled-back：rolled_back 事件 + 档案回到确认前 + 同草稿不二次回滚", () => {
  resetAuditEvents();
  const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  const { newDoc } = confirmFlow(draft, PROFILE, CONFIRMER, AT);

  const result = rollbackFlow(draft, newDoc, ROLLBACK_AT);
  assert.equal(result.restored, true);
  assert.equal(result.state, "rolled-back");
  assert.equal(draftState(draft), "rolled-back", "回滚后状态 rolled-back");
  assert.deepEqual(result.doc, PROFILE, "档案回到确认前整版（T2 上一版保留原样可用）");

  const event = exportAuditEvents().find((e) => e.event === "rolled_back");
  assert.ok(event, "rolled_back 事件已登记");
  assert.equal(event.at, ROLLBACK_AT);
  assert.ok(event.from_fingerprint && event.from_fingerprint.length === 64);
  assert.ok(event.to_fingerprint && event.to_fingerprint.length === 64);
  assert.notEqual(event.from_fingerprint, event.to_fingerprint);

  // 同一草稿经本层不二次回滚（更早版本的 prev 链回退直接用 T2 rollbackToPrev）
  const again = rollbackFlow(draft, result.doc, ROLLBACK_AT);
  assert.equal(again.restored, false);
  assert.equal(again.reason, "draft_already_rolled_back");

  // T2 原语仍可直达 prev 链（回滚可再回滚不因本层收口而丢失）：
  // 用 T2 原语在确认后的档案上叠第二层确认，prev 链两次回滚可一路回到底。
  const draft2 = makeDraft(
    newDoc,
    [{ op: "replace", path: "/outputs/0", value: "二层产出（虚构样例）" }],
    { takenAt: "2026-10-29T12:00:00Z" },
  );
  const second = confirmDraft(draft2, newDoc);
  const chain1 = rollbackToPrev(second.newDoc);
  const chain2 = rollbackToPrev(chain1.doc);
  assert.equal(chain1.restored, true);
  assert.equal(chain2.restored, true);
  assert.deepEqual(chain2.doc, PROFILE, "prev 链一路回到底");
});

test("T3-4 · 审计导出：append-only 有序、深拷贝防改写、事件流零档案字段值", () => {
  resetAuditEvents();
  const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  const applied = confirmFlow(draft, PROFILE, CONFIRMER, AT);
  rollbackFlow(draft, applied.newDoc, ROLLBACK_AT);

  const events = exportAuditEvents();
  assert.deepEqual(
    events.map((e) => e.event),
    ["confirmed", "rolled_back"],
    "事件按发生顺序 append-only",
  );

  const snapshot = structuredClone(events);
  events.push({ event: "forged", at: AT });
  events[0].confirmer = "篡改者（虚构）";
  assert.deepEqual(exportAuditEvents(), snapshot, "导出为深拷贝，外部改写不影响审计流");

  // 零档案字段值：事件流里绝无字段值正文，只有指纹 / pointer / 计数
  const serialized = JSON.stringify(exportAuditEvents());
  assert.ok(!serialized.includes("示例同学"), "姓名不入审计");
  assert.ok(!serialized.includes("placeholder@example.com"), "邮箱不入审计");
  assert.ok(!serialized.includes("神经信号处理"), "value 正文不入审计");
  assert.ok(!serialized.includes("脑机接口 × 神经工程"), "value 正文不入审计");

  resetAuditEvents();
  assert.deepEqual(exportAuditEvents(), [], "reset 供测试隔离");
});

test("T3-5 · 无 confirmer 拒：undefined/null/空白串一律 confirm_refused，草稿保持 draft", () => {
  resetAuditEvents();
  for (const bad of [undefined, null, "", "   "]) {
    const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
    const before = structuredClone(PROFILE);

    const result = confirmFlow(draft, PROFILE, bad, AT);
    assert.equal(result.applied, false);
    assert.equal(result.refused, true);
    assert.equal(result.reason, "confirmer_required");
    assert.equal(draftState(draft), "draft", "拒绝不推进生命周期");
    assert.deepEqual(PROFILE, before, "拒绝时档案分毫不动");
  }
  const refusals = exportAuditEvents().filter((e) => e.event === "confirm_refused");
  assert.equal(refusals.length, 4, "每次拒绝都留审计");
  for (const r of refusals) {
    assert.equal(r.reason, "confirmer_required");
    assert.equal(r.at, AT);
    assert.equal(r.confirmer, undefined, "无确认人时不伪造 confirmer 字段");
  }
});

test("T3-6 · 确定性：同输入两次完整确认流，结果与审计事件流逐字段全等", () => {
  resetAuditEvents();
  const run = () => {
    resetAuditEvents();
    const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
    const confirmed = confirmFlow(draft, PROFILE, CONFIRMER, AT);
    const rolled = rollbackFlow(draft, confirmed.newDoc, ROLLBACK_AT);
    return { draft, confirmed, rolled, events: exportAuditEvents() };
  };

  const a = run();
  const b = run();
  assert.deepEqual(b.confirmed.newDoc, a.confirmed.newDoc, "生效结果全等");
  assert.deepEqual(b.rolled.doc, a.rolled.doc, "回滚结果全等");
  assert.deepEqual(b.draft, a.draft, "草稿（含 state 推进）全等");
  assert.deepEqual(b.events, a.events, "审计事件流全等");
  // 指纹键序无关（T2 canonical json 语义在流层不变）
  const reordered = {
    target: { direction: "脑机接口方向（虚构样例）" },
    skills: ["Python", "脑机接口"],
    experience: ["脑电信号采集与分析项目（虚构样例）"],
    education: ["2027 年实验心理学硕士（虚构样例）"],
    basics: { phone: "000-0000-0000", email: "placeholder@example.com", name: "示例同学" },
    outputs: ["校内技术报告一篇（虚构样例）"],
  };
  const d1 = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  const d2 = makeDraft(reordered, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  assert.equal(d1.target_fingerprint, d2.target_fingerprint, "键序无关指纹");
});

test("T3-7 · 生命周期拒绝：confirmed/rolled-back 草稿不得再 confirm，未确认草稿不得经流回滚", () => {
  resetAuditEvents();
  const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  const { newDoc } = confirmFlow(draft, PROFILE, CONFIRMER, AT);
  assert.equal(draftState(draft), "confirmed");

  // 已 confirmed：重确认拒绝（幂等重放走新草稿）
  const reConfirm = confirmFlow(draft, PROFILE, CONFIRMER, AT);
  assert.equal(reConfirm.applied, false);
  assert.equal(reConfirm.refused, true);
  assert.equal(reConfirm.reason, "draft_already_confirmed");

  rollbackFlow(draft, newDoc, ROLLBACK_AT);
  assert.equal(draftState(draft), "rolled-back");

  // 已 rolled-back：再 confirm 拒绝（rebase = 建新草稿，与 T2 语义一致）
  const reConfirm2 = confirmFlow(draft, PROFILE, CONFIRMER, AT);
  assert.equal(reConfirm2.refused, true);
  assert.equal(reConfirm2.reason, "draft_already_rolled_back");

  // 从未确认的草稿：不得经流回滚
  const fresh = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  const noConfirm = rollbackFlow(fresh, PROFILE, ROLLBACK_AT);
  assert.equal(noConfirm.restored, false);
  assert.equal(noConfirm.reason, "draft_not_confirmed");
  assert.equal(draftState(fresh), "draft");

  const reasons = exportAuditEvents().filter((e) => e.event === "confirm_refused" || e.event === "rollback_refused");
  assert.deepEqual(
    reasons.map((e) => e.reason),
    ["draft_already_confirmed", "draft_already_rolled_back", "draft_not_confirmed"],
  );
});

test("T3-8 · 非法输入：非草稿对象抛错、未知状态抛错、at 非法抛错；事件可 JSON 序列化", () => {
  resetAuditEvents();
  assert.throws(() => draftState(null), /非 profile-draft-v1/);
  assert.throws(() => draftState({ schema: "other" }), /非 profile-draft-v1/);
  assert.throws(() => confirmFlow({ schema: "other" }, PROFILE, CONFIRMER, AT), /非 profile-draft-v1/);
  assert.throws(() => draftState({ ...makeDraft(PROFILE, CHANGES), state: "corrupted（虚构）" }), /无法识别的草稿状态/);
  assert.throws(() => confirmFlow(makeDraft(PROFILE, CHANGES), PROFILE, CONFIRMER, 12345), /at 须为非空/);

  const draft = makeDraft(PROFILE, CHANGES, { takenAt: "2026-10-29T09:00:00Z" });
  confirmFlow(draft, PROFILE, CONFIRMER, AT);
  const events = exportAuditEvents();
  assert.deepEqual(JSON.parse(JSON.stringify(events)), events, "审计事件全部可 JSON 序列化");
  assert.deepEqual(DRAFT_STATES, ["draft", "confirmed", "rolled-back"], "状态值域钉死");
});
