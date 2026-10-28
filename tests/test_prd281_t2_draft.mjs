// PRD-281/T2: 求职档案改动草稿 + 回滚最小实现测试（trend issue #1407）。
//
// 覆盖 T2 验收切片：草稿结构 / 指纹冲突拒绝 / 确认原子生效 / 上一版保留 /
// 回滚恢复（含再回滚与 rollback_refused）/ 确定性 / 空 changes 拒绝 /
// 结构非法原子性。样例档案全虚构（example.com 保留域、占位姓名）。
import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_DRAFT_SCHEMA,
  confirmDraft,
  fingerprintDoc,
  makeDraft,
  rollbackToPrev,
} from "../lib/profile-draft.mjs";

// 全虚构样例档案（JobDocProfile 六区块的虚构子集）
const PROFILE = {
  basics: { name: "示例同学", email: "placeholder@example.com", phone: "000-0000-0000" },
  education: ["2027 年实验心理学硕士（虚构样例）"],
  experience: ["脑电信号采集与分析项目（虚构样例）"],
  skills: ["Python", "脑机接口"],
  outputs: ["校内技术报告一篇（虚构样例）"],
  target: { direction: "脑机接口方向（虚构样例）" },
};

const TAKEN_AT = "2026-10-29T09:00:00Z";

test("T2-1 · 草稿结构：profile-draft-v1，diff 形态 JSON Pointer，diff 不存整文件副本", () => {
  const draft = makeDraft(
    PROFILE,
    [
      { op: "replace", path: "/skills/1", value: "神经信号处理" },
      { op: "replace", path: "/target/direction", value: "脑机接口 × 神经工程（虚构）" },
    ],
    { takenAt: TAKEN_AT },
  );
  assert.equal(draft.schema, PROFILE_DRAFT_SCHEMA);
  assert.equal(draft.state, "draft");
  assert.equal(draft.taken_at, TAKEN_AT);
  assert.deepEqual(draft.changes, [
    { op: "replace", path: "/skills/1", value: "神经信号处理" },
    { op: "replace", path: "/target/direction", value: "脑机接口 × 神经工程（虚构）" },
  ]);
  assert.equal(draft.target_fingerprint, fingerprintDoc(PROFILE));
  assert.ok(!("newDoc" in draft) && !("doc" in draft), "草稿不存整文件副本");
});

test("T2-2 · 指纹冲突拒绝：confirm 前手改档案 → confirm_conflict，不合并不覆盖", () => {
  const draft = makeDraft(PROFILE, [{ op: "replace", path: "/skills/1", value: "神经信号处理" }]);
  const drifted = structuredClone(PROFILE);
  drifted.experience.push("草稿之后的手改条目（虚构）");
  const before = structuredClone(drifted);

  const result = confirmDraft(draft, drifted);
  assert.equal(result.applied, false);
  assert.equal(result.conflict, true);
  assert.equal(result.reason, "confirm_conflict");
  assert.equal(result.actual_fingerprint, fingerprintDoc(drifted));
  assert.equal(result.expected_fingerprint, draft.target_fingerprint);
  assert.deepEqual(drifted, before, "拒绝时漂移档案分毫不动");
});

test("T2-3 · 确认原子生效：多条改动一次生效，输入 currentDoc 不被修改", () => {
  const draft = makeDraft(
    PROFILE,
    [
      { op: "replace", path: "/skills/1", value: "神经信号处理" },
      { op: "replace", path: "/target/direction", value: "脑机接口 × 神经工程（虚构）" },
      { op: "replace", path: "/basics/email", value: "updated-placeholder@example.com" },
    ],
    { takenAt: TAKEN_AT },
  );
  const before = structuredClone(PROFILE);
  const result = confirmDraft(draft, PROFILE);

  assert.equal(result.applied, true);
  assert.equal(result.newDoc.skills[1], "神经信号处理");
  assert.equal(result.newDoc.target.direction, "脑机接口 × 神经工程（虚构）");
  assert.equal(result.newDoc.basics.email, "updated-placeholder@example.com");
  assert.equal(result.newDoc.basics.name, "示例同学", "未点名的字段原样保留");
  assert.deepEqual(PROFILE, before, "确认前后 currentDoc 不被修改");
});

test("T2-4 · 上一版自动保留：newDoc.prev 为确认前整版", () => {
  const draft = makeDraft(PROFILE, [{ op: "replace", path: "/skills/1", value: "神经信号处理" }]);
  const result = confirmDraft(draft, PROFILE);
  assert.equal(result.applied, true);
  assert.ok(result.newDoc.prev, "newDoc 带 prev 字段");
  assert.deepEqual(result.newDoc.prev, PROFILE);
  assert.equal(result.newDoc.prev.skills[1], "脑机接口");
});

test("T2-5 · 回滚恢复：回上一版；无 prev 拒绝；回滚可再回滚", () => {
  const draft = makeDraft(PROFILE, [{ op: "replace", path: "/skills/1", value: "神经信号处理" }]);
  const { newDoc } = confirmDraft(draft, PROFILE);

  // 回滚回上一版
  const rolled = rollbackToPrev(newDoc);
  assert.equal(rolled.restored, true);
  assert.deepEqual(rolled.doc, PROFILE);

  // prev 链自带"回滚可再回滚"：v3.prev=v2.prev=v1
  const second = confirmDraft(
    makeDraft(newDoc, [{ op: "replace", path: "/skills/0", value: "Python" }], { takenAt: TAKEN_AT }),
    newDoc,
  );
  assert.equal(second.applied, true);
  const rolledBack = rollbackToPrev(second.newDoc);
  assert.deepEqual(rolledBack.doc, newDoc);
  const rolledTwice = rollbackToPrev(rolledBack.doc);
  assert.deepEqual(rolledTwice.doc, PROFILE);

  // 无 prev → rollback_refused，不抛不吞
  assert.deepEqual(rollbackToPrev(structuredClone(PROFILE)), {
    restored: false,
    reason: "rollback_refused",
  });
  assert.deepEqual(rollbackToPrev(null), { restored: false, reason: "rollback_refused" });
});

test("T2-6 · 确定性：指纹键序无关；同输入同选项两次建草稿全等", () => {
  const reordered = {
    target: PROFILE.target,
    outputs: PROFILE.outputs,
    skills: PROFILE.skills,
    experience: PROFILE.experience,
    education: PROFILE.education,
    basics: PROFILE.basics,
  };
  assert.equal(fingerprintDoc(reordered), fingerprintDoc(PROFILE));
  assert.notEqual(fingerprintDoc({ ...PROFILE, extras: "x" }), fingerprintDoc(PROFILE));

  const changes = [{ op: "replace", path: "/skills/1", value: "神经信号处理" }];
  const a = makeDraft(PROFILE, changes, { takenAt: TAKEN_AT });
  const b = makeDraft(structuredClone(PROFILE), structuredClone(changes), { takenAt: TAKEN_AT });
  assert.deepEqual(a, b);

  // 确认结果同样确定：同输入同草稿 → newDoc 全等
  const ra = confirmDraft(a, PROFILE).newDoc;
  const rb = confirmDraft(b, PROFILE).newDoc;
  assert.deepEqual(ra, rb);
});

test("T2-7 · 空 changes 拒绝：空数组与非数组都抛错", () => {
  assert.throws(() => makeDraft(PROFILE, []), /changes 不能为空/);
  assert.throws(() => makeDraft(PROFILE, "replace /skills/0"), /changes 不能为空/);
  assert.throws(() => makeDraft(PROFILE, [{ op: "remove", path: "/skills/1", value: null }]), /不支持的 op/);
  assert.throws(() => makeDraft(PROFILE, [{ op: "replace", path: "skills/1", value: "x" }]), /非法 JSON Pointer|JSON Pointer/);
});

test("T2-8 · 结构非法原子性：apply 中途失败抛错，currentDoc 与已应用改动都不落", () => {
  const draft = makeDraft(PROFILE, [
    { op: "replace", path: "/skills/1", value: "神经信号处理" },
    { op: "replace", path: "/skills/99", value: "不存在的下标" },
  ]);
  const before = structuredClone(PROFILE);
  assert.throws(() => confirmDraft(draft, PROFILE), /路径不存在/);
  assert.deepEqual(PROFILE, before, "中途失败时输入档案分毫不动（原子）");
});

test("T2-9 · 显式 targetFingerprint：错配的草稿确认即冲突（rebase 前拒绝）", () => {
  const staleFingerprint = fingerprintDoc({ ...PROFILE, target: { direction: "旧方向（虚构）" } });
  const draft = makeDraft(PROFILE, [{ op: "replace", path: "/skills/1", value: "神经信号处理" }], {
    targetFingerprint: staleFingerprint,
  });
  const result = confirmDraft(draft, PROFILE);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "confirm_conflict");
});
