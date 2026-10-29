// PRD-281/T5 验收试运行（trend issue #1410）：求职档案改动草稿+回滚全流程演练 + 红线断言 + 文档无密钥。
// 全链：T1 #1406（设计）→ T2 #1407（profile-draft.mjs 草稿/确认/回滚）→ T3 #1408（确认流正式化）→ T4 #1409（175 门断言）→ 本验收。
// 红线：投递仍走 PRD-175 批准门（import 图无投递依赖）；本地处理；示例全虚构；密钥扫描零命中。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { makeDraft, rollbackToPrev } from "../lib/profile-draft.mjs";
import { confirmFlow, draftState, rollbackFlow } from "../lib/profile-confirm-flow.mjs";
import { assertNoApplyDeps, assertGateReferencePresent } from "../lib/profile-apply-assertions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_FILES = [
  join(__dirname, "../lib/profile-draft.mjs"),
  join(__dirname, "../lib/profile-confirm-flow.mjs"),
  join(__dirname, "../lib/profile-apply-assertions.mjs"),
];

const DOC = {
  basics: { name: "<JOBSEEKER>", years: 5 },
  target_roles: ["示例岗位A"],
  notes: "示例档案",
};

test("A1 全流程演练：改动→草稿→确认生效→上一版保留→回滚", () => {
  const draft = makeDraft(DOC, [{ op: "replace", path: "/notes", value: "示例档案-更新版" }]);
  const r = confirmFlow(draft, DOC, "<JOBSEEKER>", "2026-10-30T10:00:00Z");
  const applied = r.applied, refused = r.refused, newDoc = r.newDoc;
  assert.equal(applied, true);
  assert.equal(refused, undefined);
  assert.equal(newDoc.notes, "示例档案-更新版");
  assert.ok(newDoc.prev); // 上一版自动保留
  const rolled = rollbackToPrev(newDoc);
  assert.equal(rolled.restored, true);
  assert.equal(rolled.doc.notes, "示例档案"); // 回到上一版
});

test("A2 draftState 状态查询：draft→confirmed→rolled-back", () => {
  const draft = makeDraft(DOC, [{ op: "replace", path: "/notes", value: "v2" }]);
  assert.equal(draftState(draft), "draft");
  const r = confirmFlow(draft, DOC, "<JOBSEEKER>", "t1");
  assert.equal(draftState(draft), "confirmed");
  rollbackFlow(draft, r.newDoc, "t2");
  assert.equal(draftState(draft), "rolled-back");
});

test("A3 指纹冲突拒绝（改动期间文档被外部修改）", () => {
  const draft = makeDraft(DOC, [{ op: "replace", path: "/notes", value: "v2" }]);
  const drifted = JSON.parse(JSON.stringify(DOC));
  drifted.basics.years = 99;
  const r = confirmFlow(draft, drifted, "<JOBSEEKER>", "t");
  assert.equal(r.applied, false);
  assert.equal(r.conflict, true);
});

test("A4 175 门不变断言：业务模块 import 图无投递执行依赖", () => {
  // 只扫业务模块本体；断言模块自带模式表（扫描器自身）不在被扫之列
  const sources = LIB_FILES.slice(0, 2).map((f) => readFileSync(f, "utf8"));
  assert.doesNotThrow(() => assertNoApplyDeps(sources));
  assert.doesNotThrow(() => assertGateReferencePresent(sources));
});

test("A5 175 门引用行在场（设计红线）", () => {
  const sources = LIB_FILES.map((f) => readFileSync(f, "utf8"));
  assert.doesNotThrow(() => assertGateReferencePresent(sources));
});

test("A6 本地处理断言：零网络原语", () => {
  for (const f of LIB_FILES) {
    const src = readFileSync(f, "utf8");
    for (const banned of ["fetch(", "http.get", "axios", "net.connect"]) {
      assert.ok(!src.includes(banned));
    }
  }
});

test("A7 密钥扫描：交付模块零命中", () => {
  for (const f of LIB_FILES) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(src));
    assert.ok(!/AKIA[0-9A-Z]{16}/.test(src));
  }
});

test("A8 确定性：同输入重放逐字节一致", () => {
  const run = () => {
    const draft = makeDraft(DOC, [{ op: "replace", path: "/notes", value: "v2" }], { takenAt: "t0" });
    const r = confirmFlow(draft, DOC, "<JOBSEEKER>", "t1");
    return JSON.stringify({ draft, newDoc: r.newDoc });
  };
  assert.equal(run(), run());
});
