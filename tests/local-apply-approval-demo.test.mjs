/**
 * PRD-175/T4：申请助手流程对接演示（trend #878）——草稿 → 批准 → 执行。
 *
 * 驱动真实链路（非 mock）：posting-guard 语义（guardFlags）→ requestApproval
 * 强制入队 → 人工批准（decided_by 留痕）→ preview → execute（Fake runner 回执）；
 * 反向对照：跳过批准的执行被拒。数据全虚构（PRD-175 样例纪律）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  approvalError,
  createApprovalGate,
} from "../lib/local-apply/approval/gate.ts";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "brain27-approval-demo-"));
  return join(dir, "brain27.db");
}

function makeClock(startIso = "2026-10-25T10:00:00.000Z") {
  let t = Date.parse(startIso);
  return { now: () => new Date(t), advanceHours: (h) => { t += h * 3600_000; } };
}

const DEMO_DRAFT = {
  actionKind: "email_send",
  opportunityId: "opp-demo-2026-042",
  draftRef: "email:opp-demo-2026-042:v1",
  payload: {
    to: "hr@example.edu",
    subject: "应聘具身智能算法实习（虚构岗位）",
  },
  guardFlags: [],
  requestedBy: "cli:docx-apply-demo",
};

test("演示主链：草稿 → 入队 → 人工批准 → preview → 执行回执", () => {
  const gate = createApprovalGate({ path: tempDb(), now: makeClock().now });

  // ① 草稿（PRD-080 产物）→ 申请投递：guard 无异常 flag，强制入批准队列
  const { record, created } = gate.requestApproval(DEMO_DRAFT);
  assert.equal(created, true);
  assert.equal(record.status, "pending");

  // ② 未批准先执行 → 被拒（fail-closed）
  assert.throws(
    () => gate.execute(DEMO_DRAFT, () => { throw new Error("不应触达 runner"); }),
    (err) => err.code === "MISSING_APPROVAL" || err.code === "NOT_APPROVED" || /批准|approved/i.test(err.message),
  );

  // ③ 人工批准（decided_by 显式留痕；演示中由真实用户在 CLI 完成）
  gate.decide(record.id, "approved", { via: "cli", note: "user:demo 演示批准" });

  // ④ preview：校验通过、真执行会调 runner
  const pv = gate.preview(DEMO_DRAFT);
  assert.equal(pv.state, "approved");  // PreviewResult.state
  assert.equal(pv.wouldExecute, true);

  // ⑤ 执行：Fake runner 回执（零网络零真实投递）
  const result = gate.execute(DEMO_DRAFT, (payload, rec) => ({
    executionRef: "<receipt@example.invalid>",
  }));
  assert.equal(result.record.status, "executed");
  assert.equal(result.executionRef, "<receipt@example.invalid>");

  // ⑥ 终态重放被拒（防重复投递）
  assert.throws(() => gate.execute(DEMO_DRAFT, () => {}));
});

test("演示反链：posting-guard 异常 flag 不阻断入队但人工可见，拒绝路径留痕", () => {
  const clock = makeClock("2026-10-25T11:00:00.000Z");
  const gate = createApprovalGate({ path: tempDb(), now: clock.now });

  // guard 发现可疑特征（如收件域仿冒）→ 仍入队（人工终审），批准前被人看见
  const { record } = gate.requestApproval({
    ...DEMO_DRAFT,
    opportunityId: "opp-demo-suspect",
    draftRef: "email:opp-demo-suspect:v1",
    guardFlags: ["domain_lookalike"],
  });
  assert.equal(record.status, "pending");

  // 人工拒绝：留痕后终态，执行被拒
  gate.decide(record.id, "rejected", { via: "cli", note: "user:demo 演示拒绝" });
  assert.throws(
    () => gate.execute({
      ...DEMO_DRAFT,
      opportunityId: "opp-demo-suspect",
      draftRef: "email:opp-demo-suspect:v1",
    }, () => {}),
    (err) => /终态|rejected|拒绝/i.test(err.message),
  );
});
