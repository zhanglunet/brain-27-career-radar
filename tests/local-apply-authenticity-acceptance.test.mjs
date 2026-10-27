/**
 * PRD-176/T5 验收（trend #884）：机会真实性独立复核——假岗位样例验收集。
 *
 * 假岗位样例（全部虚构，`*.example` 保留域）走真实复核引擎（T2 reviewer）
 * 必须被标 suspicious，并逐样例核对信号码与维度落点；再经 PRD-175 批准门
 * （T4 联动）确认「可疑默认不可投」收口；另含不误伤对照（trusted/pending）
 * 与「无密钥 / 无真实隐私」静态扫描。
 *
 * 逐条对应 PRD-176 任务表 T5 行验收标准：
 *  验收1 含假岗位样例被标 suspicious ──
 *        仿冒域（S3，同形异源域）/ 假福利（S1 收费 + S5 数额异常）/ 索要
 *        敏感证件（S2）/ 隐藏注入行文（S4）四类假岗位全中；可疑结论经批准门
 *        联动默认不可投（AUTHENTICITY_SUSPICIOUS，队列零记录）；对照样例
 *        （证据齐全的真实岗位 / 证据不足的待验证岗位）不被误伤。
 *  验收2 无密钥 ── 交付文件静态密钥扫描零命中（私钥块/AKIA/GitHub PAT/
 *        sk- 形态/xox-/AIza/字面量口令赋值）。
 *  验收3 无真实隐私 ── 交付文件与样例 fixture 静态隐私扫描零命中（保留域
 *        外邮箱/手机号/身份证号/IP）；联动场景落库字节同样零命中。
 *
 * 样例纪律（PRD 风险条款）：机构/域名/邮箱/数额全虚构，域名只用 IANA
 * 保留域 `*.example`；复核为纯函数，无网络、无时钟。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { reviewAuthenticity } from "../lib/authenticity/reviewer.ts";
import { createApprovalGate } from "../lib/local-apply/approval/gate.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 读 T2 同款 fixture（tests/fixtures/authenticity/<name>.json）。 */
function loadFixture(name) {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", "authenticity", `${name}.json`), "utf8"),
  );
}

// ── 验收1：假岗位样例被标 suspicious ────────────────────────

test("验收1a 仿冒域假岗位（同形异源域 + 失配邮箱）→ suspicious（S3 硬信号）", () => {
  const review = reviewAuthenticity(loadFixture("opp-example-fake-domain"));
  assert.equal(review.state, "suspicious", "仿冒域必须被判可疑");
  const codes = review.signals.map((s) => s.code);
  assert.ok(codes.includes("S3"), "同形异源域名 → S3（example-unlversity vs example-university，示例）");
  assert.ok(codes.includes("S6"), "仿冒域邮箱与官方域失配且无官网佐证 → S6");
  assert.equal(review.dims.org.state, "suspicious", "S3 落 org 维");
  // 复核产物结构完整（可作审计依据）：版本/复核者/置信度/覆盖位
  assert.equal(review.version, 1);
  assert.equal(review.reviewer.kind, "agent");
  assert.ok(review.confidence >= 0 && review.confidence <= 100);
  assert.equal(review.override, null, "agent 复核不自带人工覆盖");
});

test("验收1b 假福利假岗位（入职收费 + 天价签约津贴）→ suspicious（S1+S5）", () => {
  const review = reviewAuthenticity(loadFixture("opp-example-fake-benefit"));
  assert.equal(review.state, "suspicious", "收费 + 数额异常必须被判可疑");
  const codes = review.signals.map((s) => s.code);
  assert.ok(codes.includes("S1"), "先缴培训费/服装费 → S1 收费要求");
  assert.ok(codes.includes("S5"), "20000 ≥ 3×同类中位 3000 且伴随 S1 → S5 数额异常");
  assert.equal(review.dims.salary_funding.state, "suspicious", "假福利落 salary_funding 维");
  assert.equal(review.dims.org.state, "trusted", "域名/机构名佐证齐全：不误伤 org 维");
});

test("验收1c 索要敏感证件假岗位 → suspicious（S2 硬信号）", () => {
  const review = reviewAuthenticity(loadFixture("opp-example-fake-contact"));
  assert.equal(review.state, "suspicious", "索要身份证原件/银行账号必须被判可疑");
  assert.ok(
    review.signals.some((s) => s.code === "S2"),
    "身份证原件 + 银行账号 → S2 敏感索要",
  );
  assert.equal(review.dims.contact.state, "suspicious", "S2 落 contact 维");
});

test("验收1d 隐藏注入行文假岗位 → suspicious（S4 硬信号）", () => {
  const review = reviewAuthenticity(loadFixture("opp-example-fake-hidden"));
  assert.equal(review.state, "suspicious", "面向 agent 的指令式注入行文必须被判可疑");
  assert.ok(
    review.signals.some((s) => s.code === "S4"),
    "ignore all previous instructions … → instruction_like → S4",
  );
  assert.equal(review.dims.org.state, "suspicious", "正文扫描类信号落 org 维");
});

test("验收1e 联动收口：假岗位复核结论喂给批准门 → 可疑默认不可投", () => {
  // 假岗位样例走真实复核 → suspicious → 批准门拒绝入队（PRD-176/T4 联动）
  const fake = reviewAuthenticity(loadFixture("opp-example-fake-domain"));
  assert.equal(fake.state, "suspicious");

  const dir = mkdtempSync(join(tmpdir(), "brain27-auth-t5-"));
  const gate = createApprovalGate({
    path: join(dir, "brain27.db"),
    now: () => new Date("2026-10-25T10:00:00.000Z"), // 虚构时间
  });
  const req = {
    actionKind: "webform_submit",
    opportunityId: "opp-example-fake-domain",
    draftRef: "webform:opp-example-fake-domain:v1",
    payload: { url: "https://careers.example-unlversity.example/apply/901" },
    guardFlags: [],
    requestedBy: "cli:apply",
    authenticityState: fake.state,
  };
  assert.throws(
    () => gate.requestApproval(req),
    (err) => err.code === "AUTHENTICITY_SUSPICIOUS",
  );
  assert.equal(gate.list().length, 0, "可疑假岗位不得进入批准队列");

  // 对照：证据齐全的真实岗位（trusted）可正常入队待人工批准——联动不误伤
  const real = reviewAuthenticity(loadFixture("opp-example-trust"));
  assert.equal(real.state, "trusted");
  const ok = gate.requestApproval({
    ...req,
    opportunityId: "opp-example-trust",
    draftRef: "webform:opp-example-trust:v1",
    payload: { url: "https://www.example-university.example/careers" },
    authenticityState: real.state,
  });
  assert.equal(ok.record.status, "pending");

  // 落库字节扫描：联动场景入库内容零隐私（样例全在保留域）
  gate.close();
  const raw = readFileSync(join(dir, "brain27.db"), "latin1");
  assert.deepEqual(privacyHits(raw), [], "批准队列落库字节不得出现保留域外隐私");
});

test("验收1f 不误伤对照：证据不足/单软信号 → pending（宁可待验证不误伤）", () => {
  // 域名不一致但非仿冒（无佐证）→ org 维 pending，全局 pending
  const ambiguous = reviewAuthenticity({
    opportunityId: "opp-example-amb",
    org: "某大学（示例）",
    orgOfficialDomain: "example-university.example",
    officialPageUrl: "https://jobs.other-board.example/post/906",
    contactEmail: "hr@other-board.example",
  });
  assert.equal(ambiguous.state, "pending", "证据不足 → 待验证，不得直接判可疑");
  assert.deepEqual(
    ambiguous.signals.map((s) => s.code),
    ["S6"],
    "仅域名失配单软信号（S6），无硬/双软信号不成 suspicious",
  );
  assert.equal(ambiguous.dims.org.state, "pending", "非仿冒的域名不一致 → org 待验证");
  assert.equal(ambiguous.dims.contact.state, "pending", "邮箱失配单软信号 → contact 待验证");
});

// ── 验收2/3：无密钥 / 无真实隐私（静态扫描 + 运行时落库扫描）──

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

/** PRD-176 交付面（复核引擎 + 展示 + 测试 + 样例 fixture + T1 计划文档）。 */
function deliverableFiles() {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    "lib/authenticity/reviewer.ts",
    "lib/authenticity/signals.ts",
    "lib/authenticity/display.ts",
    "tests/authenticity-reviewer.test.mjs",
    "tests/local-apply-authenticity-gate.test.mjs",
    "tests/local-apply-authenticity-acceptance.test.mjs",
    "docs/plans/2026-10-25-opportunity-authenticity.md",
    // 假岗位样例集（T5 新增 fixture 一并受检）
    "tests/fixtures/authenticity/opp-example-trust.json",
    "tests/fixtures/authenticity/opp-example-pending.json",
    "tests/fixtures/authenticity/opp-example-scam.json",
    "tests/fixtures/authenticity/opp-example-fake-domain.json",
    "tests/fixtures/authenticity/opp-example-fake-benefit.json",
    "tests/fixtures/authenticity/opp-example-fake-contact.json",
    "tests/fixtures/authenticity/opp-example-fake-hidden.json",
  ].map((rel) => join(here, "..", rel));
}

test("验收2 无密钥：PRD-176 交付面与假岗位样例静态密钥扫描零命中", () => {
  const hits = [];
  for (const file of deliverableFiles()) {
    const text = readFileSync(file, "utf8");
    for (const [name, re] of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m !== null) hits.push(`${file} -> ${name}:${m[0].slice(0, 24)}`);
    }
  }
  assert.deepEqual(hits, [], "交付文件与样例不得出现任何形态的密钥/令牌");
});

test("验收3 无真实隐私：PRD-176 交付面与假岗位样例静态隐私扫描零命中", () => {
  const hits = [];
  for (const file of deliverableFiles()) {
    for (const h of privacyHits(readFileSync(file, "utf8"))) {
      hits.push(`${file} -> ${h}`);
    }
  }
  assert.deepEqual(hits, [], "样例与文档只允许保留域（example.*/ *.example 等）虚构数据");
});
