/**
 * PRD-176/T4：批准门联动——可疑机会的强制动作默认不可投（trend #883）。
 * 驱动真实审批门（T2 gate + T2 registry），数据全虚构。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApprovalGate } from "../lib/local-apply/approval/gate.ts";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "brain27-auth-gate-"));
  return join(dir, "brain27.db");
}

function makeClock(startIso = "2026-10-25T12:00:00.000Z") {
  let t = Date.parse(startIso);
  return { now: () => new Date(t) };
}

const BASE_REQ = {
  actionKind: "email_send",
  opportunityId: "opp-example-042",
  draftRef: "email:opp-example-042:v1",
  payload: { to: "hr@example.com", subject: "应聘（虚构示例）" },
  guardFlags: [],
  requestedBy: "cli:demo",
};

test("可疑机会的强制动作默认不可投：入队被拒并留审计", () => {
  const gate = createApprovalGate({ path: tempDb(), now: makeClock().now });
  assert.throws(
    () => gate.requestApproval({ ...BASE_REQ, authenticityState: "suspicious" }),
    (err) => err.code === "AUTHENTICITY_SUSPICIOUS",
  );
  assert.equal(gate.list().length, 0, "可疑机会不得进入批准队列");
});

test("非可疑状态均可正常入队（unverified 是存量未复核，不等于可疑）", () => {
  for (const authenticityState of ["trusted", "pending", "unverified"]) {
    const gate = createApprovalGate({ path: tempDb(), now: makeClock().now });
    const { record } = gate.requestApproval({ ...BASE_REQ, authenticityState });
    assert.equal(record.status, "pending");
  }
});

test("未携带状态字段 → 不拦截（向后兼容 T2 既有调用面）", () => {
  const gate = createApprovalGate({ path: tempDb(), now: makeClock().now });
  const { record } = gate.requestApproval({ ...BASE_REQ });
  assert.equal(record.status, "pending");
});
