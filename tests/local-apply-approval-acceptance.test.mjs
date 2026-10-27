/**
 * PRD-175/T5 验收（trend #879）：投递前人工批准门——验收测试集。
 *
 * 对照 T4 演示（tests/local-apply-approval-demo.test.mjs）扩成验收集，
 * 逐条对应 PRD-175 任务表 T5 行的验收标准：
 *
 *  验收1 误投用例被拦 ── 六类误投全拦、runner 零触达：
 *        ① 未批准先执行 ② 可疑机会（PRD-176 联动）③ 终态重放
 *        ④ 载荷偷换（批准 A 执行 B）⑤ 旁路未注册动作 ⑥ 批准过期；
 *        另有正链对照（批准后才恰好执行一次），证明门不误伤正常流程。
 *  验收2 审计齐全 ── 正链 requested→approved→executed 全链留痕（actor/
 *        时间/明细齐备、时间单调）；每类拦截各有专属审计事件
 *        （bypass_blocked 三种 reason + authenticity_blocked）；决定留痕
 *        可追溯（decided_via/decision_note）；审计 append-only（trigger 拒改写）。
 *  验收3 无真实隐私样例入库 ── 运行时把落库字节整体扫描：保留域外邮箱/
 *        手机号/身份证号/IPv4 命中数为 0；材料正文（从未传给 gate 的
 *        标记串）不入库（载荷最小化）；交付文件静态隐私扫描同样为 0。
 *  验收4 无密钥 ── 交付文件静态密钥扫描：私钥块/AKIA/GitHub PAT/sk-
 *        开头 key/xox-/AIza/字面量口令赋值命中数为 0。
 *
 * 样例纪律（PRD-175 风险条款）：数据全虚构——机会 opp-example-901、
 * 邮箱 hr@example.edu、回执 <receipt@example.invalid>，无真实主机名、
 * IP、账号、密钥；时间源注入（固定起点 2026-10-25，虚构）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { createApprovalGate } from "../lib/local-apply/approval/gate.ts";

// ── 基座：临时库 + 可推进的虚构时钟 ──────────────────────────

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "brain27-approval-t5-"));
  return { dir, path: join(dir, "brain27.db") };
}

function makeClock(startIso = "2026-10-25T09:00:00.000Z") {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    advanceHours: (h) => { t += h * 3600_000; },
  };
}

/** 虚构正例请求（PRD-080 草稿产物 → A1 邮件投递）。 */
const BASE_REQ = {
  actionKind: "email_send",
  opportunityId: "opp-example-901",
  draftRef: "email:opp-example-901:v1",
  payload: { to: "hr@example.edu", subject: "应聘科研助理（虚构示例）" },
  guardFlags: [],
  requestedBy: "cli:docx-apply-demo",
};

/** runner 触探针：被调即置位，用于断言「误投路径绝不触达执行」。 */
function spyRunner() {
  const calls = [];
  const runner = (payload, record) => {
    calls.push({ payload, recordId: record.id });
    return { executionRef: "<receipt@example.invalid>" };
  };
  runner.calls = calls;
  return runner;
}

// ── 验收1：误投用例被拦 ──────────────────────────────────────

test("验收1① 未批准先执行：被拦、自动入队 pending、runner 零触达", () => {
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: makeClock().now });
  const runner = spyRunner();

  // 从未 requestApproval，直接 execute → fail-closed
  assert.throws(
    () => gate.execute(BASE_REQ, runner),
    (err) => err.code === "NOT_APPROVED",
  );
  assert.equal(runner.calls.length, 0, "无批准不得触达执行回调");

  // 自动入队兜底：队列里出现 pending 记录，等人工批准
  const queued = gate.list();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].status, "pending");

  // 已入队仍未批准，再执行依旧被拦
  assert.throws(
    () => gate.execute(BASE_REQ, runner),
    (err) => err.code === "NOT_APPROVED",
  );
  assert.equal(runner.calls.length, 0);
  gate.close();
});

test("验收1② 可疑机会默认不可投：入队/执行双口均被拦，队列零记录", () => {
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: makeClock().now });
  const runner = spyRunner();
  const suspicious = { ...BASE_REQ, authenticityState: "suspicious" };

  // 入队口被拦（PRD-176/T4 联动，#883）
  assert.throws(
    () => gate.requestApproval(suspicious),
    (err) => err.code === "AUTHENTICITY_SUSPICIOUS",
  );
  // 执行口同样被拦（防绕过入队口直冲执行）
  assert.throws(
    () => gate.execute(suspicious, runner),
    (err) => err.code === "AUTHENTICITY_SUSPICIOUS",
  );
  assert.equal(runner.calls.length, 0);
  assert.equal(gate.list().length, 0, "可疑机会不得进入批准队列");
  gate.close();
});

test("验收1③ 终态重放被拦：executed/rejected/pending 过期后同键重放全拒", () => {
  // a. executed 后重放（防重复投递）
  {
    const { path } = tempDb();
    const gate = createApprovalGate({ path, now: makeClock().now });
    const { record } = gate.requestApproval(BASE_REQ);
    gate.decide(record.id, "approved", { via: "cli", note: "user:demo 虚构批准" });
    gate.execute(BASE_REQ, spyRunner());
    const runner = spyRunner();
    assert.throws(
      () => gate.execute(BASE_REQ, runner),
      (err) => err.code === "REPLAY_TERMINAL",
    );
    assert.equal(runner.calls.length, 0);
    assert.throws(
      () => gate.requestApproval(BASE_REQ),
      (err) => err.code === "REPLAY_TERMINAL",
    );
    gate.close();
  }
  // b. rejected 后重放（人工已拒绝，不得再执行）
  {
    const { path } = tempDb();
    const gate = createApprovalGate({ path, now: makeClock().now });
    const { record } = gate.requestApproval(BASE_REQ);
    gate.decide(record.id, "rejected", { via: "cli", note: "user:demo 虚构拒绝" });
    const runner = spyRunner();
    assert.throws(
      () => gate.execute(BASE_REQ, runner),
      (err) => err.code === "REPLAY_TERMINAL",
    );
    assert.equal(runner.calls.length, 0);
    gate.close();
  }
  // c. pending 超 72h 过期（终态）后同键再请求：不复活，按重放拒绝
  {
    const clock = makeClock();
    const { path } = tempDb();
    const gate = createApprovalGate({ path, now: clock.now });
    gate.requestApproval(BASE_REQ);
    clock.advanceHours(73);
    assert.throws(
      () => gate.requestApproval(BASE_REQ),
      (err) => err.code === "REPLAY_TERMINAL",
    );
    gate.close();
  }
});

test("验收1④ 载荷偷换被拦：批准 A（subject=x）执行 B（subject=y）→ PAYLOAD_MISMATCH", () => {
  const clock = makeClock();
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: clock.now });
  const { record } = gate.requestApproval(BASE_REQ);
  gate.decide(record.id, "approved", { via: "cli", note: "user:demo 虚构批准" });

  // 同幂等键字段（to 不变），只换非键字段 subject → 键相同、载荷不同
  const swapped = {
    ...BASE_REQ,
    payload: { to: "hr@example.edu", subject: "应聘（已被偷换的载荷）" },
  };
  const runner = spyRunner();
  assert.throws(
    () => gate.execute(swapped, runner),
    (err) => err.code === "PAYLOAD_MISMATCH",
  );
  assert.equal(runner.calls.length, 0, "偷换载荷不得触达执行回调");

  // dry-run 同步标出：preview 不执行且给出原因
  const pv = gate.preview(swapped);
  assert.equal(pv.wouldExecute, false);
  assert.match(pv.blockedReason, /载荷/);
  // 原 A 载荷 preview 仍 wouldExecute（偷换只影响被偷换的请求）
  assert.equal(gate.preview(BASE_REQ).wouldExecute, true);
  gate.close();
});

test("验收1⑤ 旁路未注册动作被拦：default-deny 拒绝并留 bypass_blocked 审计", () => {
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: makeClock().now });
  const runner = spyRunner();
  const bypass = { ...BASE_REQ, actionKind: "direct_message_send" };

  for (const entry of [
    () => gate.requestApproval(bypass),
    () => gate.execute(bypass, runner),
    () => gate.preview(bypass),
  ]) {
    assert.throws(entry, (err) => err.code === "BYPASS_UNREGISTERED");
  }
  assert.equal(runner.calls.length, 0);
  assert.equal(gate.list().length, 0, "未注册动作不得入队");

  // 拦截留痕：bypass:<动作名> 下有 unregistered_action 审计
  const audits = gate.auditFor("bypass:direct_message_send");
  assert.equal(audits.length, 3, "三个口各留一条 bypass_blocked");
  for (const a of audits) {
    assert.equal(a.event, "bypass_blocked");
    assert.match(a.detailJson, /unregistered_action/);
  }
  gate.close();
});

test("验收1⑥ 批准过期被拦：批准后超 24h 执行 → APPROVAL_EXPIRED，记录转 expired", () => {
  const clock = makeClock();
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: clock.now });
  const { record } = gate.requestApproval(BASE_REQ);
  gate.decide(record.id, "approved", { via: "cli", note: "user:demo 虚构批准" });

  clock.advanceHours(25);
  const runner = spyRunner();
  assert.throws(
    () => gate.execute(BASE_REQ, runner),
    (err) => err.code === "APPROVAL_EXPIRED",
  );
  assert.equal(runner.calls.length, 0);
  assert.equal(gate.get(record.id).status, "expired", "过期批准转入 expired 终态");
  // 终态后重放同样被拦（验收1③ 的推论）
  assert.throws(
    () => gate.execute(BASE_REQ, runner),
    (err) => err.code === "REPLAY_TERMINAL",
  );
  gate.close();
});

test("验收1对照 正链不误伤：批准后恰好执行一次并留回执", () => {
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: makeClock().now });
  const { record, created } = gate.requestApproval(BASE_REQ);
  assert.equal(created, true);
  assert.equal(record.status, "pending");

  gate.decide(record.id, "approved", { via: "cli", note: "user:demo 虚构批准" });
  const pv = gate.preview(BASE_REQ);
  assert.equal(pv.state, "approved");
  assert.equal(pv.wouldExecute, true);

  const runner = spyRunner();
  const result = gate.execute(BASE_REQ, runner);
  assert.equal(runner.calls.length, 1, "执行回调恰好被调用一次");
  assert.equal(result.record.status, "executed");
  assert.equal(result.executionRef, "<receipt@example.invalid>");
  gate.close();
});

// ── 验收2：审计齐全 ──────────────────────────────────────────

test("验收2a 正链审计链齐全：requested→approved→executed，actor/时间/明细齐备", () => {
  const clock = makeClock();
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: clock.now });
  const { record } = gate.requestApproval(BASE_REQ);
  clock.advanceHours(1);
  gate.decide(record.id, "approved", { via: "cli", note: "user:demo 虚构批准" });
  clock.advanceHours(1);
  gate.execute(BASE_REQ, spyRunner());

  const audits = gate.auditFor(record.id);
  assert.deepEqual(
    audits.map((a) => a.event),
    ["requested", "approved", "executed"],
    "正链三事件按序齐全、无缺漏",
  );
  // actor 链可追溯：请求者 → 决定通道 → 系统执行
  assert.deepEqual(
    audits.map((a) => a.actor),
    ["cli:docx-apply-demo", "cli", "system"],
  );
  // occurred_at 单调不减（虚构时间源下严格可验）
  const times = audits.map((a) => a.occurredAt);
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i - 1] <= times[i], "审计时间戳须单调不减");
  }
  // 明细齐备：入队明细带动作/草稿引用/guard 结论；决定明细带 note；执行明细带回执
  const [req, appr, exec] = audits.map((a) => JSON.parse(a.detailJson));
  assert.deepEqual(
    [req.action_kind, req.draft_ref, req.guard_flags],
    ["email_send", BASE_REQ.draftRef, []],
  );
  assert.match(appr.note, /虚构批准/);
  assert.equal(exec.execution_ref, "<receipt@example.invalid>");
  // 记录字段留痕：decided_via / decision_note / executed_at / execution_ref
  const after = gate.get(record.id);
  assert.equal(after.decidedVia, "cli");
  assert.match(after.decisionNote, /虚构批准/);
  assert.ok(after.executedAt !== null && after.executionRef !== null);
  gate.close();
});

test("验收2b 每类拦截留痕各就位：bypass_blocked（三种 reason）+ authenticity_blocked", () => {
  const { path } = tempDb();
  const clock = makeClock();
  const gate = createApprovalGate({ path, now: clock.now });
  const db = new Database(path, { readonly: true });

  // ① 旁路未注册动作
  try {
    gate.execute({ ...BASE_REQ, actionKind: "unknown_send" }, spyRunner());
    assert.fail("应当被拦");
  } catch (err) {
    assert.equal(err.code, "BYPASS_UNREGISTERED");
  }
  // ④ 可疑机会（趁记录尚在入队/批准前发起）
  try {
    gate.requestApproval({ ...BASE_REQ, authenticityState: "suspicious" });
    assert.fail("应当被拦");
  } catch (err) {
    assert.equal(err.code, "AUTHENTICITY_SUSPICIOUS");
  }
  // ② 批准后、执行前偷换载荷（记录尚处 approved，命中载荷比对）
  const { record } = gate.requestApproval(BASE_REQ);
  gate.decide(record.id, "approved", { via: "cli", note: "user:demo 虚构批准" });
  try {
    gate.execute({ ...BASE_REQ, payload: { ...BASE_REQ.payload, subject: "偷换" } }, spyRunner());
    assert.fail("应当被拦");
  } catch (err) {
    assert.equal(err.code, "PAYLOAD_MISMATCH");
  }
  // ③ 正常执行成终态后再重放（终态判定先于载荷比对，按重放拒绝）
  gate.execute(BASE_REQ, spyRunner());
  try {
    gate.execute(BASE_REQ, spyRunner());
    assert.fail("应当被拦");
  } catch (err) {
    assert.equal(err.code, "REPLAY_TERMINAL");
  }

  // 逐类核对审计事件与 reason（直接读审计表，覆盖全部 approval_id）
  const rows = db.prepare("SELECT approval_id, event, detail_json FROM approval_audit ORDER BY id").all();
  const bypassReasons = rows
    .filter((r) => r.event === "bypass_blocked")
    .map((r) => JSON.parse(r.detail_json).reason);
  assert.deepEqual(bypassReasons.sort(), [
    "payload_mismatch", "replay_terminal", "unregistered_action",
  ].sort(), "三类旁路各有专属 reason 留痕");
  const authBlocked = rows.filter((r) => r.event === "authenticity_blocked");
  assert.equal(authBlocked.length, 1, "可疑机会拦截留 authenticity_blocked");
  assert.match(authBlocked[0].detail_json, /email_send/);
  db.close();
  gate.close();
});

test("验收2c 决定留痕可追溯：approve/reject 双路径 decided_via + note 同步入审计", () => {
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: makeClock().now });
  const a = gate.requestApproval(BASE_REQ).record;
  const b = gate.requestApproval({
    ...BASE_REQ,
    opportunityId: "opp-example-902",
    draftRef: "email:opp-example-902:v1",
  }).record;

  gate.decide(a.id, "approved", { via: "cli", note: "user:demo 批准（虚构）" });
  gate.decide(b.id, "rejected", { via: "ui", note: "user:demo 拒绝（虚构）" });

  const [apprA] = gate.auditFor(a.id).filter((x) => x.event === "approved");
  const [rejB] = gate.auditFor(b.id).filter((x) => x.event === "rejected");
  assert.equal(apprA.actor, "cli");
  assert.equal(rejB.actor, "ui");
  assert.match(gate.get(a.id).decisionNote, /虚构/);
  assert.match(gate.get(b.id).decisionNote, /虚构/);
  assert.match(JSON.parse(rejB.detailJson).note, /虚构/);
  gate.close();
});

test("验收2d 审计 append-only：trigger 拒绝 UPDATE/DELETE 改写", () => {
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: makeClock().now });
  const { record } = gate.requestApproval(BASE_REQ);
  gate.close();

  const db = new Database(path);
  assert.throws(
    () => db.prepare("UPDATE approval_audit SET actor = 'tampered'").run(),
    /append-only/,
    "审计 UPDATE 必须被 trigger 拒绝",
  );
  assert.throws(
    () => db.prepare("DELETE FROM approval_audit").run(),
    /append-only/,
    "审计 DELETE 必须被 trigger 拒绝",
  );
  db.close();
});

// ── 验收3：无真实隐私样例入库 ────────────────────────────────

/** 虚构材料正文：只存在于内存，绝不该传给 gate、更不该入库（标记串用于断言）。 */
const FICTIONAL_BODY =
  "（虚构材料正文）本人为 2027 届认知神经科学硕士，详见 materials 草稿 BODY-MARKER-T5-9f3。";

const RESERVED_DOMAIN = /(^|\.)(example\.(com|edu|org|net|invalid|test|example)|invalid|test|localhost|example)$/i;
const SCAN_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SCAN_MOBILE = /(?<![0-9a-fA-F])1[3-9][0-9]{9}(?![0-9a-fA-F])/g;
const SCAN_IDCARD = /(?<![0-9Xx])\d{17}[0-9Xx](?![0-9Xx])/g;
const SCAN_IPV4 = /(?<![\w.])(\d{1,3}\.){3}\d{1,3}(?![\w.])/g;

/** 对文本跑隐私扫描，返回命中清单（空即通过）。 */
function privacyHits(text) {
  const hits = [];
  for (const m of text.matchAll(SCAN_EMAIL)) {
    if (!RESERVED_DOMAIN.test(m[0].split("@")[1])) hits.push(`email:${m[0]}`);
  }
  for (const re of [SCAN_MOBILE, SCAN_IDCARD, SCAN_IPV4]) {
    for (const m of text.matchAll(re)) hits.push(`pattern:${m[0]}`);
  }
  return hits;
}

test("验收3a 落库字节扫描：库中无域外邮箱/手机号/身份证号/IP，材料正文不入库", () => {
  const { path } = tempDb();
  const gate = createApprovalGate({ path, now: makeClock().now });
  // 完整走一遍会写库的链路（含拦截路径，拦截面最大）
  const { record } = gate.requestApproval(BASE_REQ);
  gate.decide(record.id, "approved", { via: "cli", note: "user:demo 虚构批准" });
  gate.execute(BASE_REQ, spyRunner());
  try {
    gate.requestApproval({ ...BASE_REQ, authenticityState: "suspicious" });
  } catch { /* 已拦，预期 */ }
  try {
    gate.execute({ ...BASE_REQ, actionKind: "unknown_send" }, spyRunner());
  } catch { /* 已拦，预期 */ }
  gate.close();

  const raw = readFileSync(path, "latin1"); // 落库字节整体扫描
  assert.deepEqual(
    privacyHits(raw),
    [],
    "落库字节不得出现保留域外邮箱/手机号/身份证号/IP（样例全虚构）",
  );
  assert.ok(!raw.includes("BODY-MARKER-T5-9f3"), "材料正文绝不落队列/审计库");
  assert.ok(!raw.includes(FICTIONAL_BODY));

  // 载荷最小化：队列只存元数据键（to/subject），无正文位
  const db = new Database(path, { readonly: true });
  const payloadJson = db.prepare("SELECT payload_json FROM approval_queue").get().payload_json;
  assert.deepEqual(Object.keys(JSON.parse(payloadJson)).sort(), ["subject", "to"]);
  db.close();
});

test("验收3b 交付文件静态隐私扫描：PRD-175 交付面零真实隐私样例", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const deliverables = [
    "lib/local-apply/approval/gate.ts",
    "lib/local-apply/approval/registry.ts",
    "lib/local-apply/approval/store.ts",
    "lib/local-apply/approval-cli.ts",
    "tests/local-apply-approval.test.mjs",
    "tests/local-apply-approval-cli.test.mjs",
    "tests/local-apply-approval-demo.test.mjs",
    "tests/local-apply-approval-acceptance.test.mjs",
    "tests/local-apply-authenticity-gate.test.mjs",
    "docs/plans/2026-10-25-pre-apply-approval-gate.md",
    "scripts/docx-apply-demo.mjs",
  ];
  const hits = [];
  for (const rel of deliverables) {
    for (const h of privacyHits(readFileSync(join(here, "..", rel), "utf8"))) {
      hits.push(`${rel} -> ${h}`);
    }
  }
  assert.deepEqual(hits, [], "交付文件中不得出现真实邮箱/手机号/身份证号/IP");
});

// ── 验收4：无密钥 ────────────────────────────────────────────

const SECRET_PATTERNS = [
  ["private-key-block", /BEGIN [A-Z ]*PRIVATE KEY/],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["github-fine-grained-pat", /github_pat_[A-Za-z0-9_]{20,}/],
  ["openai-style-key", /sk-[A-Za-z0-9_-]{20,}/],
  ["slack-token", /xox[baprs]-/],
  ["google-api-key", /AIza[0-9A-Za-z_-]{30,}/],
  ["literal-secret-assign", /(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^\s"']{8,}["']/i],
];

test("验收4 交付文件静态密钥扫描：PRD-175 交付面零密钥", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const deliverables = [
    "lib/local-apply/approval/gate.ts",
    "lib/local-apply/approval/registry.ts",
    "lib/local-apply/approval/store.ts",
    "lib/local-apply/approval-cli.ts",
    "tests/local-apply-approval.test.mjs",
    "tests/local-apply-approval-cli.test.mjs",
    "tests/local-apply-approval-demo.test.mjs",
    "tests/local-apply-approval-acceptance.test.mjs",
    "tests/local-apply-authenticity-gate.test.mjs",
    "docs/plans/2026-10-25-pre-apply-approval-gate.md",
    "scripts/docx-apply-demo.mjs",
  ];
  const hits = [];
  for (const rel of deliverables) {
    const text = readFileSync(join(here, "..", rel), "utf8");
    for (const [name, re] of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m !== null) hits.push(`${rel} -> ${name}:${m[0].slice(0, 24)}`);
    }
  }
  assert.deepEqual(hits, [], "交付文件不得出现任何形态的密钥/令牌");
});
