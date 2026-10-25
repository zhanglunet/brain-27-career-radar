import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  ACTION_REGISTRY,
  T2_ENFORCED_KINDS,
  getRegisteredAction,
} from "../lib/local-apply/approval/registry.ts";
import {
  canonicalJson,
  computeIdempotencyKey,
} from "../lib/local-apply/approval/store.ts";
import {
  approvalError,
  createApprovalGate,
} from "../lib/local-apply/approval/gate.ts";
import { createSqliteDraftStore } from "../lib/local-apply/sqlite-store.ts";

// ── 样例纪律：全部虚构（PRD-175 风险条款） ──────────────────
// 机会 opp-example-001（"某大学脑科学中心科研助理（示例）"）、
// 邮箱 hr@example.edu、表单 https://jobs.example.edu/apply/123、
// 回执 <receipt@example.invalid>——无真实主机名、IP、账号、密钥。

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "brain27-approval-test-"));
  return { dir, path: join(dir, "brain27.db") };
}

/** 时间源：从 2026-10-25T09:00:00Z 起，可推进（全部虚构时间）。 */
function makeClock(startIso = "2026-10-25T09:00:00.000Z") {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    advanceHours: (h) => { t += h * 3600_000; },
  };
}

const BASE_REQ = {
  actionKind: "email_send",
  opportunityId: "opp-example-001",
  draftRef: "email:opp-example-001:v1",
  payload: { to: "hr@example.edu", subject: "应聘科研助理（示例）" },
  guardFlags: [],
  requestedBy: "cli:docx-apply-demo",
};

function newGate(path, clock) {
  return createApprovalGate({ path, now: clock.now });
}

// ── registry ────────────────────────────────────────────────

test("注册表：T1 §2.1 四项动作齐全，均声明 dry_run 与幂等键字段", () => {
  assert.deepEqual(Object.keys(ACTION_REGISTRY).sort(), [
    "email_send", "file_export_final", "profile_share", "webform_submit",
  ]);
  for (const action of Object.values(ACTION_REGISTRY)) {
    assert.equal(action.dryRun, true, `${action.kind} 必须声明 dry_run`);
    assert.ok(action.targetPayloadKeys.length > 0, `${action.kind} 必须有幂等键参与字段`);
    assert.ok(action.whyIrreversible.length > 0);
    assert.ok(["high", "medium"].includes(action.risk));
  }
  assert.deepEqual([...T2_ENFORCED_KINDS].sort(), ["email_send", "webform_submit"]);
  assert.equal(getRegisteredAction("carrier_pigeon"), undefined);
});

test("default-deny：未注册动作被拒并写 bypass_blocked 审计", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    const bad = { ...BASE_REQ, actionKind: "carrier_pigeon" };
    assert.throws(() => gate.requestApproval(bad), (err) => {
      assert.equal(err.code, "BYPASS_UNREGISTERED");
      return true;
    });
    assert.throws(() => gate.execute(bad, () => {}), (err) => {
      assert.equal(err.code, "BYPASS_UNREGISTERED");
      return true;
    });
    const audits = gate.auditFor("bypass:carrier_pigeon");
    assert.equal(audits.length, 2);
    assert.ok(audits.every((a) => a.event === "bypass_blocked"));
    assert.equal(gate.list().length, 0, "未注册动作不得入队");
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 入队：A1/A2 必填约束 + 幂等 ─────────────────────────────

test("A1/A2 入队：draft_ref 与 guardFlags 强制携带，缺任一即拒绝且不入队", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    const noDraft = { ...BASE_REQ };
    delete noDraft.draftRef;
    assert.throws(() => gate.requestApproval(noDraft), (err) => {
      assert.equal(err.code, "INVALID_REQUEST");
      return true;
    });

    const noFlags = { ...BASE_REQ };
    delete noFlags.guardFlags;
    assert.throws(() => gate.requestApproval(noFlags), (err) => {
      assert.equal(err.code, "INVALID_REQUEST");
      return true;
    });

    assert.equal(gate.list().length, 0, "被拒请求不得入队");

    // 空数组也必须显式携带（防"忘了扫描"）：扫描干净 = 显式空数组。
    const ok = gate.requestApproval({ ...BASE_REQ, guardFlags: ["instruction_like"] });
    assert.equal(ok.created, true);
    assert.equal(ok.record.status, "pending");
    assert.deepEqual(ok.record.guardFlags, ["instruction_like"]);
    assert.equal(ok.record.id, "email_send:opp-example-001:1");
    assert.equal(ok.record.requestedBy, "cli:docx-apply-demo");
    assert.match(ok.record.idempotencyKey, /^[0-9a-f]{64}$/);
    // pending 有效期默认 +72h（T1 §六拍板 #1）。
    assert.equal(ok.record.expiresAt, "2026-10-28T09:00:00.000Z");
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("幂等去重：同键重复入队返回既有记录不建新行；载荷目标变化产生新记录", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    const first = gate.requestApproval(BASE_REQ);
    const again = gate.requestApproval({ ...BASE_REQ });
    assert.equal(again.created, false);
    assert.equal(again.record.id, first.record.id);
    assert.equal(gate.list().length, 1);

    // 收件人变化 → 新幂等键 → 新记录（seq 自增）。
    const other = gate.requestApproval({
      ...BASE_REQ,
      payload: { to: "pi@example.edu", subject: "应聘科研助理（示例）" },
    });
    assert.equal(other.created, true);
    assert.equal(other.record.id, "email_send:opp-example-001:2");
    assert.notEqual(other.record.idempotencyKey, first.record.idempotencyKey);
    assert.equal(gate.list().length, 2);
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("幂等键：输入串为 action_kind + opportunity_id + draft_ref + 收件人/URL 的 SHA-256", () => {
  const key = computeIdempotencyKey(BASE_REQ);
  assert.match(key, /^[0-9a-f]{64}$/);
  const withUrl = computeIdempotencyKey({
    actionKind: "webform_submit",
    opportunityId: "opp-example-001",
    draftRef: "ps:opp-example-001:v1",
    payload: { url: "https://jobs.example.edu/apply/123", fields: ["name", "cv"] },
    guardFlags: [],
  });
  assert.notEqual(key, withUrl);
  // canonicalJson：键序无关
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: [3, 4] } }),
    canonicalJson({ a: { c: [3, 4], d: 2 }, b: 1 }),
  );
});

// ── 状态机 ──────────────────────────────────────────────────

test("状态机：approve 写批准有效期（+24h）与决定三件套；reject/cancel 为终态", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    const { record } = gate.requestApproval(BASE_REQ);

    const approved = gate.decide(record.id, "approved", { via: "cli", note: "核对过官方页（示例）" });
    assert.equal(approved.status, "approved");
    assert.equal(approved.decidedVia, "cli");
    assert.equal(approved.decisionNote, "核对过官方页（示例）");
    assert.equal(approved.decidedAt, "2026-10-25T09:00:00.000Z");
    assert.equal(approved.approvalValidUntil, "2026-10-26T09:00:00.000Z");

    const { record: r2 } = gate.requestApproval({
      ...BASE_REQ, payload: { to: "pi@example.edu", subject: "x" },
    });
    const rejected = gate.decide(r2.id, "rejected", { via: "ui", note: "来源存疑（示例）" });
    assert.equal(rejected.status, "rejected");

    const { record: r3 } = gate.requestApproval({
      ...BASE_REQ, payload: { to: "talent@example.edu", subject: "x" },
    });
    const cancelled = gate.cancel(r3.id, { via: "cli", note: "不再申请（示例）" });
    assert.equal(cancelled.status, "cancelled");

    // 终态不可再改。
    assert.throws(() => gate.decide(rejected.id, "approved"), /终态/);
    assert.throws(() => gate.cancel(approved.id), /终态/);
    assert.throws(() => gate.decide("email_send:opp-example-001:99", "approved"), /不存在/);

    // 审计链：requested → approved / rejected / cancelled。
    const events = gate.auditFor(approved.id).map((a) => a.event);
    assert.deepEqual(events, ["requested", "approved"]);
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pending 超 72h 未决定：system 自动转 expired 终态，过期后不可再决定", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    const { record } = gate.requestApproval(BASE_REQ);
    clock.advanceHours(73);
    // 惰性清理：任何 gate 调用（这里用 decide 触发）先把过期 pending 转 expired。
    assert.throws(() => gate.decide(record.id, "approved"), /已过期/);
    assert.equal(gate.get(record.id).status, "expired");
    const events = gate.auditFor(record.id).map((a) => a.event);
    assert.deepEqual(events, ["requested", "expired"]);
    // 终态不可复活：同键再请求按重放拒绝。
    assert.throws(() => gate.requestApproval(BASE_REQ), (err) => {
      assert.equal(err.code, "REPLAY_TERMINAL");
      return true;
    });
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 执行口：无批准不可执行 ──────────────────────────────────

test("无批准不可执行：execute 先入队并拒绝；runner 绝不被调用", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    let ran = 0;
    assert.throws(() => gate.execute(BASE_REQ, () => { ran += 1; }), (err) => {
      assert.equal(err.code, "NOT_APPROVED");
      assert.match(err.message, /已入队/);
      return true;
    });
    assert.equal(ran, 0, "runner 不得被调用");
    assert.equal(gate.list().length, 1);
    assert.equal(gate.list()[0].status, "pending");

    // 已在队列仍 pending：同样拒绝执行。
    assert.throws(() => gate.execute(BASE_REQ, () => { ran += 1; }), (err) => {
      assert.equal(err.code, "NOT_APPROVED");
      return true;
    });
    assert.equal(ran, 0);
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("批准后执行：runner 恰好调用一次，记录 executed 终态与回执引用", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    gate.requestApproval(BASE_REQ);
    gate.decide("email_send:opp-example-001:1", "approved", { via: "cli" });
    let calls = 0;
    const result = gate.execute(BASE_REQ, (payload, record) => {
      calls += 1;
      assert.equal(payload.to, "hr@example.edu");
      assert.equal(record.status, "approved");
      return { executionRef: "<receipt@example.invalid>" };
    });
    assert.equal(calls, 1);
    assert.equal(result.record.status, "executed");
    assert.equal(result.executionRef, "<receipt@example.invalid>");
    assert.equal(result.record.executedAt, "2026-10-25T09:00:00.000Z");

    const events = gate.auditFor(result.record.id).map((a) => a.event);
    assert.deepEqual(events, ["requested", "approved", "executed"]);

    // executed 为终态：同键再执行按重放拒绝，runner 不再调用。
    assert.throws(() => gate.execute(BASE_REQ, () => { calls += 1; }), (err) => {
      assert.equal(err.code, "REPLAY_TERMINAL");
      return true;
    });
    assert.equal(calls, 1);
    const bypass = gate.auditFor("bypass:email_send").filter(
      (a) => a.detailJson.includes("replay_terminal"),
    );
    assert.ok(bypass.length >= 1, "重放尝试须留 bypass_blocked 审计");
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("执行失败：failed 终态 + 审计只存原因摘要；同键重试被拒（不复活）", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    gate.requestApproval(BASE_REQ);
    gate.decide("email_send:opp-example-001:1", "approved", { via: "cli" });
    assert.throws(() => gate.execute(BASE_REQ, () => {
      throw new Error("SMTP 演示故障（虚构）");
    }), /SMTP 演示故障/);
    const record = gate.get("email_send:opp-example-001:1");
    assert.equal(record.status, "failed");

    const failedAudit = gate.auditFor(record.id).find((a) => a.event === "failed");
    assert.ok(failedAudit.detailJson.includes("SMTP 演示故障"));
    assert.ok(!failedAudit.detailJson.includes("hr@example.edu"), "审计不存载荷原文");

    // 终态不复活：同键请求/执行都被拒。
    assert.throws(() => gate.requestApproval(BASE_REQ), (err) => {
      assert.equal(err.code, "REPLAY_TERMINAL");
      return true;
    });
    assert.throws(() => gate.execute(BASE_REQ, () => {}), (err) => {
      assert.equal(err.code, "REPLAY_TERMINAL");
      return true;
    });
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("防偷换：批准后载荷有变（同收件人改主题）即拒绝执行并留 bypass 审计", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    gate.requestApproval(BASE_REQ);
    gate.decide("email_send:opp-example-001:1", "approved", { via: "cli" });
    let ran = 0;
    const tampered = {
      ...BASE_REQ,
      payload: { to: "hr@example.edu", subject: "应聘科研助理【改】（示例）" },
    };
    assert.throws(() => gate.execute(tampered, () => { ran += 1; }), (err) => {
      assert.equal(err.code, "PAYLOAD_MISMATCH");
      return true;
    });
    assert.equal(ran, 0);
    const bypass = gate.auditFor("bypass:email_send").filter(
      (a) => a.detailJson.includes("payload_mismatch"),
    );
    assert.equal(bypass.length, 1);
    assert.equal(gate.get("email_send:opp-example-001:1").status, "approved", "原批准记录不被破坏");
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("批准有效期：超 24h 未执行 → expired 终态，须重新批准", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    gate.requestApproval(BASE_REQ);
    gate.decide("email_send:opp-example-001:1", "approved", { via: "cli" });
    clock.advanceHours(25);
    let ran = 0;
    assert.throws(() => gate.execute(BASE_REQ, () => { ran += 1; }), (err) => {
      assert.equal(err.code, "APPROVAL_EXPIRED");
      return true;
    });
    assert.equal(ran, 0);
    assert.equal(gate.get("email_send:opp-example-001:1").status, "expired");
    const events = gate.auditFor("email_send:opp-example-001:1").map((a) => a.event);
    assert.deepEqual(events, ["requested", "approved", "expired"]);
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A2 webform_submit：全流程（入队 → 批准 → 执行）同样收口", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    const req = {
      actionKind: "webform_submit",
      opportunityId: "opp-example-002",
      draftRef: "cv:opp-example-002:v1",
      payload: { url: "https://jobs.example.edu/apply/123", fields: ["name", "cv"] },
      guardFlags: ["hidden_url"],
      requestedBy: "ui",
    };
    assert.throws(() => gate.execute(req, () => {}), (err) => {
      assert.equal(err.code, "NOT_APPROVED");
      return true;
    });
    const { record } = gate.requestApproval(req);
    assert.deepEqual(record.guardFlags, ["hidden_url"], "guard 结论强制入队");
    gate.decide(record.id, "approved", { via: "ui" });
    const result = gate.execute(req, () => ({ executionRef: "form-receipt-example-001" }));
    assert.equal(result.record.status, "executed");
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dry-run：preview 全量校验但绝不执行、绝不改状态", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    // 未入队
    let pv = gate.preview(BASE_REQ);
    assert.equal(pv.state, "missing");
    assert.equal(pv.wouldExecute, false);

    gate.requestApproval(BASE_REQ);
    pv = gate.preview(BASE_REQ);
    assert.equal(pv.state, "queued");
    assert.equal(pv.wouldExecute, false);

    // preview 不改变状态
    assert.equal(gate.list()[0].status, "pending");

    gate.decide("email_send:opp-example-001:1", "approved", { via: "cli" });
    pv = gate.preview(BASE_REQ);
    assert.equal(pv.state, "approved");
    assert.equal(pv.wouldExecute, true);
    assert.equal(gate.list()[0].status, "approved", "preview 后仍为 approved");
    assert.equal(gate.auditFor("email_send:opp-example-001:1").length, 2, "preview 不写审计");
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 存储：同库新表 + append-only ────────────────────────────

test("同库新表：与 materials 共存于一个 SQLite 文件，materials 零改动", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const drafts = createSqliteDraftStore({ path, now: clock.now });
  const gate = newGate(path, clock);
  try {
    drafts.save("cv", "opp-example-001", "简历草稿正文（示例，永不出机器）");
    gate.requestApproval(BASE_REQ);
    gate.decide("email_send:opp-example-001:1", "approved", { via: "cli" });

    const db = new Database(path);
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).all().map((r) => r.name);
      assert.ok(tables.includes("materials"));
      assert.ok(tables.includes("approval_queue"));
      assert.ok(tables.includes("approval_audit"));
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM materials").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM approval_queue").get().n, 1);

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_approval%'",
      ).all().map((r) => r.name);
      assert.ok(indexes.includes("idx_approval_queue_status"));
      assert.ok(indexes.includes("idx_approval_queue_opp"));
    } finally {
      db.close();
    }
    // 草稿库接口不受影响。
    assert.equal(drafts.get("cv", "opp-example-001").content, "简历草稿正文（示例，永不出机器）");
  } finally {
    gate.close();
    drafts.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("审计 append-only：trigger 拒绝 UPDATE/DELETE，重开库依旧", () => {
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    gate.requestApproval(BASE_REQ);
  } finally {
    gate.close();
  }
  const db = new Database(path);
  try {
    assert.throws(() => db.exec("UPDATE approval_audit SET event = 'approved'"), /append-only/);
    assert.throws(() => db.exec("DELETE FROM approval_audit"), /append-only/);
  } finally {
    db.close();
  }
  // 重开后审计仍在、可继续追加。
  const gate2 = newGate(path, clock);
  try {
    assert.equal(gate2.auditFor("email_send:opp-example-001:1").length, 1);
    gate2.appendAudit("email_send:opp-example-001:1", "bypass_blocked", "cli:test", { reason: "probe" });
    assert.equal(gate2.auditFor("email_send:opp-example-001:1").length, 2);
  } finally {
    gate2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("数据主权与脱敏：队列/审计不含正文；store 不发起网络调用", () => {
  for (const file of ["registry.ts", "store.ts", "gate.ts"]) {
    const src = readFileSync(
      new URL(`../lib/local-apply/approval/${file}`, import.meta.url),
      "utf-8",
    );
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    for (const pat of ["fetch(", "XMLHttpRequest", "WebSocket(", "node:http", "https.request"]) {
      assert.ok(!code.includes(pat), `${file} 不应包含 ${pat}`);
    }
  }
  // 载荷最小化（T1 §2.2 #4）：正文（>500 字符的字符串字段）拒绝入队。
  const { dir, path } = tempDb();
  const clock = makeClock();
  const gate = newGate(path, clock);
  try {
    const longBody = "这套磁信正文".repeat(200); // 1200 字符，正文形态
    assert.throws(
      () => gate.requestApproval({
        ...BASE_REQ,
        payload: { to: "hr@example.edu", subject: "x", body: longBody },
      }),
      /载荷最小化/,
    );
    // 正常元数据载荷照常入队。
    gate.requestApproval(BASE_REQ);
    const rec = gate.list()[0];
    assert.equal(JSON.parse(rec.payloadJson).to, "hr@example.edu");
  } finally {
    gate.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("错误工具：approvalError 携带 code", () => {
  const err = approvalError("NOT_APPROVED", "x");
  assert.equal(err.code, "NOT_APPROVED");
  assert.ok(err instanceof Error);
});
