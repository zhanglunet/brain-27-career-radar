import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, main } from "../lib/local-apply/cli.ts";
import { createApprovalGate } from "../lib/local-apply/approval/gate.ts";
import {
  APPROVALS_HELP_TEXT,
  approvalsDecide,
  approvalsList,
  approvalsShow,
  formatRecordLines,
  parseApprovalsArgs,
  parseStatusFilter,
  runApprovals,
} from "../lib/local-apply/approval-cli.ts";

// ── 样例纪律：全部虚构（PRD-175 风险条款） ──────────────────
// 机会 opp-example-001（"某大学脑科学中心科研助理（示例）"）、
// 邮箱 hr@example.edu、表单 https://jobs.example.edu/apply/123——
// 无真实主机名、IP、账号、密钥；时间亦为虚构固定值。

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "brain27-approval-cli-test-"));
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

function newGate(path, clock) {
  return createApprovalGate({ path, now: clock.now });
}

const REQ_A = {
  actionKind: "email_send",
  opportunityId: "opp-example-001",
  draftRef: "email:opp-example-001:v1",
  payload: { to: "hr@example.edu", subject: "应聘科研助理（示例）" },
  guardFlags: ["instruction_like"],
  requestedBy: "cli:docx-apply-demo",
};

const REQ_B = {
  actionKind: "webform_submit",
  opportunityId: "opp-example-002",
  draftRef: "cv:opp-example-002:v1",
  payload: { url: "https://jobs.example.edu/apply/123" },
  guardFlags: [],
  requestedBy: "ui",
};

function setupTwo(path, clock) {
  const gate = newGate(path, clock);
  const a = gate.requestApproval(REQ_A);
  const b = gate.requestApproval(REQ_B);
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  return { gate, a: a.record, b: b.record };
}

// ── 参数解析 ────────────────────────────────────────────────

test("parseApprovalsArgs：五个子命令 + help 兜底", () => {
  assert.deepEqual(parseApprovalsArgs(["list"]), { verb: "list", id: null });
  assert.deepEqual(parseApprovalsArgs(["show", "email_send:opp-example-001:1"]), {
    verb: "show", id: "email_send:opp-example-001:1",
  });
  assert.deepEqual(parseApprovalsArgs(["approve", "x"]), { verb: "approve", id: "x" });
  assert.deepEqual(parseApprovalsArgs(["reject", "x"]), { verb: "reject", id: "x" });
  assert.deepEqual(parseApprovalsArgs(["cancel", "x"]), { verb: "cancel", id: "x" });
  assert.deepEqual(parseApprovalsArgs([]), { verb: "help", id: null });
  assert.deepEqual(parseApprovalsArgs(["help"]), { verb: "help", id: null });
  assert.deepEqual(parseApprovalsArgs(["purge"]), { verb: "help", id: null });
});

test("parseApprovalsArgs：带 id 的子命令缺 id 时保留 verb、id 为 null（调用方报用法错）", () => {
  assert.deepEqual(parseApprovalsArgs(["approve"]), { verb: "approve", id: null });
});

test("parseStatusFilter：缺省 pending（T1 §5.2 列出待批）、all、非法值报错", () => {
  assert.deepEqual(parseStatusFilter(undefined), { ok: true, status: "pending" });
  assert.deepEqual(parseStatusFilter("all"), { ok: true, status: "all" });
  assert.deepEqual(parseStatusFilter("rejected"), { ok: true, status: "rejected" });
  assert.equal(parseStatusFilter("bogus").ok, false);
  assert.equal(parseStatusFilter(true).ok, false);
});

test("cli.parseArgs：approvals 进入白名单，既有命令解析不变", () => {
  const parsed = parseArgs(["approvals", "list", "--status", "all", "--db", "/tmp/x.db"]);
  assert.equal(parsed.command, "approvals");
  assert.deepEqual(parsed.positional, ["list"]);
  assert.deepEqual(parsed.flags, { status: "all", db: "/tmp/x.db" });
  // 既有命令逐字不变（T1 §5.2 现有命令零改动）。
  assert.equal(parseArgs(["status"]).command, "status");
  assert.equal(parseArgs(["match", "opp-1"]).command, "match");
  assert.equal(parseArgs(["bogus"]).command, "help");
});

// ── list：默认列出待批 + 过滤 + JSON ────────────────────────

test("list：默认只列 pending；guard 命中项醒目展示", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate, a } = setupTwo(path, clock);
  try {
    const done = approvalsList(gate, {});
    assert.equal(done.exitCode, 0);
    assert.match(done.lines[0], /批准队列：2 条（status=pending）$/);
    const text = done.lines.join("\n");
    assert.match(text, /email_send:opp-example-001:1/);
    assert.match(text, /待批准/);
    assert.match(text, /【内容检查命中】1 项：instruction_like/);
    assert.match(text, /webform_submit:opp-example-002:1/);
    // 决定后默认列表不再显示；--status all 显示两条。
    gate.decide(a.id, "approved", { via: "cli", note: "核对过官方页（示例）" });
    const after = approvalsList(gate, {}).lines.join("\n");
    assert.match(after, /批准队列：1 条（status=pending）/);
    const all = approvalsList(gate, { status: "all" }).lines.join("\n");
    assert.match(all, /批准队列：2 条（status=all）/);
    assert.match(all, /已批准/);
    // 按 opportunity 过滤。
    const byOpp = approvalsList(gate, { status: "all", opportunityId: "opp-example-002" });
    assert.match(byOpp.lines.join("\n"), /webform_submit:opp-example-002:1/);
    assert.doesNotMatch(byOpp.lines.join("\n"), /email_send:opp-example-001:1/);
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("list --json：结构化输出含 payload 对象与 guardFlags 数组", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate } = setupTwo(path, clock);
  try {
    const done = approvalsList(gate, { json: true });
    assert.equal(done.exitCode, 0);
    assert.equal(done.lines.length, 1);
    const rows = JSON.parse(done.lines[0]);
    assert.equal(rows.length, 2);
    const first = rows.find((r) => r.id === "email_send:opp-example-001:1");
    assert.equal(first.status, "pending");
    assert.equal(first.statusLabel, "待批准");
    assert.deepEqual(first.guardFlags, ["instruction_like"]);
    assert.equal(first.payload.to, "hr@example.edu");
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("list：空队列给出零条提示，退出码 0", () => {
  const { path, dir } = tempDb();
  const gate = newGate(path, makeClock());
  try {
    const done = approvalsList(gate, {});
    assert.equal(done.exitCode, 0);
    assert.match(done.lines.join("\n"), /批准队列：0 条（status=pending）/);
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ── show：记录 + 审计留痕 ───────────────────────────────────

test("show：展示记录与 append-only 审计流水；未知 id 退出码 1", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate, a } = setupTwo(path, clock);
  try {
    const done = approvalsShow(gate, a.id);
    assert.equal(done.exitCode, 0);
    const text = done.lines.join("\n");
    assert.match(text, /审计留痕（append-only，共 1 条）/);
    assert.match(text, /#1 requested · cli:docx-apply-demo/);
    const missing = approvalsShow(gate, "email_send:nowhere:9");
    assert.equal(missing.exitCode, 1);
    assert.match(missing.error, /记录不存在/);
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ── approve / reject / cancel：决定 + 留痕 ──────────────────

test("approve：pending → approved，写批准有效期与审计，输出含『批准 ≠ 执行』提示", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate, a } = setupTwo(path, clock);
  try {
    const done = approvalsDecide(gate, "approve", a.id, { note: "核对过官方页（示例）" });
    assert.equal(done.exitCode, 0);
    const text = done.lines.join("\n");
    assert.match(text, /状态 approved/);
    assert.match(text, /批准有效期至 2026-10-26T09:00:00\.000Z/);
    assert.match(text, /批准 ≠ 执行/);
    assert.match(text, /#\d+ approved · cli/);
    const record = gate.get(a.id);
    assert.equal(record.status, "approved");
    assert.equal(record.decidedVia, "cli");
    assert.equal(record.decisionNote, "核对过官方页（示例）");
    const json = approvalsDecide(gate, "approve", (() => {
      // 再造一条 pending 用于 --json 分支
      return gate.requestApproval({
        actionKind: "file_export_final",
        opportunityId: "opp-example-003",
        payload: { output_name: "cover-letter-final（示例）.docx" },
        requestedBy: "cli:docx-export",
      }).record.id;
    })(), { json: true });
    assert.equal(json.exitCode, 0);
    assert.equal(JSON.parse(json.lines[0]).status, "approved");
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("reject：pending → rejected（终态）并留痕；重复决定报终态错", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate, a } = setupTwo(path, clock);
  try {
    const done = approvalsDecide(gate, "reject", a.id, { note: "来源存疑（示例）" });
    assert.equal(done.exitCode, 0);
    assert.match(done.lines.join("\n"), /终态 rejected/);
    assert.match(done.lines.join("\n"), /#\d+ rejected · cli/);
    const again = approvalsDecide(gate, "approve", a.id, {});
    assert.equal(again.exitCode, 1);
    assert.match(again.error, /终态.*不可再决定|终态/s);
    assert.equal(gate.get(a.id).status, "rejected");
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("cancel：pending → cancelled（用户撤回）并留痕", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate, b } = setupTwo(path, clock);
  try {
    const done = approvalsDecide(gate, "cancel", b.id, { note: "改用新草稿版本（示例）" });
    assert.equal(done.exitCode, 0);
    assert.match(done.lines.join("\n"), /终态 cancelled/);
    assert.equal(gate.get(b.id).status, "cancelled");
    assert.equal(gate.get(b.id).decidedVia, "cli");
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("决定口：未知 id / 缺 id 用法错 → 退出码 1", async () => {
  const { path, dir } = tempDb();
  const gate = newGate(path, makeClock());
  try {
    const missing = approvalsDecide(gate, "approve", "email_send:nowhere:9", {});
    assert.equal(missing.exitCode, 1);
    assert.match(missing.error, /记录不存在/);
    const errLines = [];
    const code = await runApprovals(["approve"], {}, {
      gate,
      err: (l) => errLines.push(l),
    });
    assert.equal(code, 1);
    assert.match(errLines.join("\n"), /缺少 <id>/);
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("决定口：pending 过期后不可决定（72h 惰性过期，T1 §3.1）", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate, a } = setupTwo(path, clock);
  try {
    clock.advanceHours(73);
    const done = approvalsDecide(gate, "approve", a.id, {});
    assert.equal(done.exitCode, 1);
    assert.match(done.error, /已过期/);
    assert.equal(gate.get(a.id).status, "expired");
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ── runApprovals：入口分派与输出捕获 ────────────────────────

test("runApprovals：help / --status 非法 / 正常 list 的退出码与输出通道", async () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate } = setupTwo(path, clock);
  try {
    const out1 = [];
    const code1 = await runApprovals(["help"], {}, { gate, out: (l) => out1.push(l) });
    assert.equal(code1, 0);
    assert.match(out1.join("\n"), /brain27 approvals/);
    assert.equal(APPROVALS_HELP_TEXT.includes("approve"), true);

    const err2 = [];
    const code2 = await runApprovals(["list", "--status", "bogus"], { status: "bogus" }, {
      gate, err: (l) => err2.push(l),
    });
    assert.equal(code2, 1);
    assert.match(err2.join("\n"), /--status 只允许/);

    const out3 = [];
    const code3 = await runApprovals(["list"], {}, { gate, out: (l) => out3.push(l) });
    assert.equal(code3, 0);
    assert.match(out3.join("\n"), /批准队列：2 条（status=pending）|批准队列：/);
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("runApprovals：按注入 gate 完成 approve 全流程（--db 接线由 cli.main 集成测试覆盖）", async () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const seed = newGate(path, clock);
  const rec = seed.requestApproval(REQ_A).record;
  seed.close();
  const out = [];
  try {
    const code = await runApprovals(["approve", rec.id, "--note", "x"], { note: "x" }, {
      gate: createApprovalGate({ path, now: clock.now }),
      out: (l) => out.push(l),
    });
    assert.equal(code, 0);
    assert.match(out.join("\n"), /已批准 email_send:opp-example-001:1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── cli.ts main 集成：approvals 在档案/缓存加载之前分派 ─────

test("cli.main：approvals list --db <tmp> 无需 profile/cache 即可运行（现有命令零改动）", async () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const seed = newGate(path, clock);
  seed.requestApproval(REQ_A);
  seed.close();
  const logs = [];
  const origLog = console.log;
  console.log = (l) => logs.push(String(l));
  try {
    const code = await main(["approvals", "list", "--db", path]);
    assert.equal(code, 0);
  } finally {
    console.log = origLog;
    rmSync(dir, { recursive: true, force: true });
  }
  const text = logs.join("\n");
  assert.match(text, /批准队列：1 条（status=pending）/);
  assert.match(text, /【内容检查命中】/);
});

test("formatRecordLines：非 pending 记录展示决定三件套与回执引用", () => {
  const { path, dir } = tempDb();
  const clock = makeClock();
  const { gate, a } = setupTwo(path, clock);
  try {
    // 批准后经唯一执行口执行（recordExecuted 在 store 层，gate 不直接暴露）。
    gate.decide(a.id, "approved", { via: "cli" });
    const exec = gate.execute(REQ_A, () => ({ executionRef: "<receipt@example.invalid>" }));
    assert.equal(exec.record.status, "executed");
    const record = gate.get(a.id);
    const text = formatRecordLines(record).join("\n");
    assert.match(text, /已执行/);
    assert.match(text, /执行于/);
    assert.match(text, /回执 <receipt@example\.invalid>/);
  } finally { gate.close(); rmSync(dir, { recursive: true, force: true }); }
});
