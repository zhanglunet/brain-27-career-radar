import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HARD_SIGNALS,
  SIGNAL_DIM,
  detectFeeDemand,
  detectSensitiveRequest,
  extractHost,
  isConfusableDomain,
  registrableDomain,
  signalsFromGuardFlags,
  S8_FAILURE_THRESHOLD,
} from "../lib/authenticity/signals.ts";
import {
  AUTHENTICITY_JSON_VERSION,
  REVIEWER_ID,
  TRUSTED_CONFIDENCE_THRESHOLD,
  confidenceOf,
  reviewAuthenticity,
} from "../lib/authenticity/reviewer.ts";
import { cmdPull } from "../lib/local-apply/cli.ts";

// ── 样例纪律：全部虚构（PRD-176 风险条款）────────────────────
// opp-example-trust / opp-example-scam / opp-example-pending，
// 域名一律 example.edu / example.org / example-pay.example 占位，
// 无真实主机名、IP、账号、密钥。

function loadFixture(name) {
  return JSON.parse(readFileSync(
    fileURLToPath(new URL(`./fixtures/authenticity/${name}.json`, import.meta.url)),
    "utf-8",
  ));
}

// ── 信号码表（T1 §3.1）───────────────────────────────────────

test("信号码表：S1–S8 齐全，硬/软分档与维度归属与 T1 §3.1 一致", () => {
  assert.deepEqual(Object.keys(SIGNAL_DIM).sort(), [
    "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8",
  ]);
  assert.deepEqual([...HARD_SIGNALS].sort(), ["S1", "S2", "S3", "S4"]);
  assert.equal(SIGNAL_DIM.S1, "salary_funding");
  assert.equal(SIGNAL_DIM.S2, "contact");
  assert.equal(SIGNAL_DIM.S3, "org");
  assert.equal(SIGNAL_DIM.S4, "org");
  assert.equal(SIGNAL_DIM.S5, "salary_funding");
  assert.equal(SIGNAL_DIM.S6, "contact");
  assert.equal(SIGNAL_DIM.S7, "deadline");
  assert.equal(SIGNAL_DIM.S8, "org");
});

// ── 文本信号 S1/S2 ───────────────────────────────────────────

test("S1 收费要求：命中收费词；免除语境（免押金/无保证金）不误报", () => {
  assert.ok(detectFeeDemand("入职前需缴纳押金 2000 元（示例）"));
  assert.ok(detectFeeDemand("需先付费办理档案（示例）"));
  assert.ok(detectFeeDemand("Please pay a training fee upfront (example)"));
  assert.equal(detectFeeDemand("本岗位免押金、无需保证金（示例）"), null);
  assert.equal(detectFeeDemand("协助脑成像数据采集与整理（示例）"), null);
});

test("S2 敏感证件索要：身份证原件/银行账户命中", () => {
  assert.ok(detectSensitiveRequest("请提供身份证原件（示例）"));
  assert.ok(detectSensitiveRequest("发工资需银行账户密码（示例）"));
  assert.equal(detectSensitiveRequest("请携带学生证复印件（示例）"), null);
});

// ── S3 域名仿判 ──────────────────────────────────────────────

test("S3 域名比对：注册域一致不算仿冒；去标点形近判仿冒", () => {
  assert.equal(extractHost("https://www.example.edu/careers"), "www.example.edu");
  assert.equal(registrableDomain("www.example.edu"), "example.edu");
  // 子域同注册域 = 一致（R1），不是仿冒。
  assert.equal(isConfusableDomain("www.example.edu", "example.edu"), false);
  // 去标点后形近（examp1e vs example）→ 仿冒。
  assert.equal(isConfusableDomain("www.examp1e.edu", "example.edu"), true);
  // 完全不同源（不相近）→ 不算仿冒（走 R1 的 pending 分支）。
  assert.equal(isConfusableDomain("jobs.example-board.example", "example.edu"), false);
});

test("S4/S3：posting-guard 五类 flag 映射为信号，口径与本地一致", () => {
  const signals = signalsFromGuardFlags([
    { kind: "hidden_block", detail: "block" },
    { kind: "instruction_like", detail: "line" },
    { kind: "invisible_tamper", detail: "3 个" },
    { kind: "hidden_url", detail: "https://payload.example.invalid/x" },
    { kind: "homoglyph", detail: "exаmple" },
  ]);
  const codes = signals.map((s) => s.code).sort();
  assert.deepEqual(codes, ["S3", "S4", "S4", "S4", "S4"]);
});

// ── R1–R6 与三态合成（fixture 三态各一条）───────────────────

test("fixture trusted：官方域名/机构名/邮箱/资助/截止日全佐证 → trusted", () => {
  const review = reviewAuthenticity(loadFixture("opp-example-trust"));
  assert.equal(review.state, "trusted");
  assert.equal(review.version, AUTHENTICITY_JSON_VERSION);
  assert.deepEqual(review.signals, []);
  assert.equal(review.reviewer.kind, "agent");
  assert.equal(review.reviewer.id, REVIEWER_ID);
  assert.equal(review.override, null);
  for (const dim of ["org", "salary_funding", "contact", "deadline"]) {
    assert.equal(review.dims[dim].state, "trusted", dim);
    assert.ok(review.dims[dim].evidence_refs.length >= 1, `${dim} 需证据引用`);
  }
  assert.ok(review.confidence >= TRUSTED_CONFIDENCE_THRESHOLD, `confidence=${review.confidence}`);
});

test("fixture scam：正文收费（S1）→ suspicious，dim 级 suspicious 落 salary_funding/contact", () => {
  const review = reviewAuthenticity(loadFixture("opp-example-scam"));
  assert.equal(review.state, "suspicious");
  const codes = review.signals.map((s) => s.code);
  assert.ok(codes.includes("S1"), "押金/先付费 → S1");
  assert.ok(codes.includes("S2"), "身份证原件/银行账户 → S2");
  assert.ok(codes.includes("S5"), "20000 ≥ 3×3000 且伴随 S1 → S5");
  assert.ok(codes.includes("S6"), "邮箱域名失配且无佐证 → S6");
  assert.equal(review.dims.salary_funding.state, "suspicious");
  assert.equal(review.dims.contact.state, "suspicious");
});

test("fixture pending：快照缺失（S8 单独命中）→ pending，confidence 30", () => {
  const review = reviewAuthenticity(loadFixture("opp-example-pending"));
  assert.equal(review.state, "pending");
  assert.deepEqual(review.signals.map((s) => s.code), ["S8"]);
  assert.ok(review.signals[0].detail.includes("快照缺失"));
  assert.equal(review.confidence, 30);
});

// ── 单信号 → 全局三态（T1 §3.2 逐条）────────────────────────

test("S2 硬信号压倒可信证据：trusted 场景注入索要证件行文 → suspicious", () => {
  const ev = loadFixture("opp-example-trust");
  ev.bodyExcerpt = "请提供身份证原件与银行账户（示例）";
  const review = reviewAuthenticity(ev);
  assert.equal(review.state, "suspicious", "任一硬信号压倒一切可信信号");
});

test("S8 双来源同维：连续失败 + 快照缺失 → 两个软信号同维 → suspicious", () => {
  const review = reviewAuthenticity({
    opportunityId: "opp-example-unstable",
    consecutiveFailures: S8_FAILURE_THRESHOLD,
    snapshotMissing: true,
  });
  assert.equal(review.state, "suspicious");
  assert.equal(review.signals.filter((s) => s.code === "S8").length, 2);
});

test("S5：只在与 S1 伴随时命中；无统计输入不命中", () => {
  const base = {
    opportunityId: "opp-example-s5",
    fundingAmount: 30000,
    peerMedianAmount: 3000,
    bodyExcerpt: "协助数据分析（示例）",
  };
  // 无 S1：即使偏离 10 倍也不命中 S5。
  const noS1 = reviewAuthenticity(base);
  assert.ok(!noS1.signals.some((s) => s.code === "S5"));
  // 伴随 S1 → S5。
  const withS1 = reviewAuthenticity({ ...base, bodyExcerpt: "需缴纳保证金 500 元（示例）" });
  assert.ok(withS1.signals.some((s) => s.code === "S5"));
  // 无统计输入 → 不命中。
  const noStats = reviewAuthenticity({ opportunityId: "x", bodyExcerpt: "需缴纳保证金 500 元（示例）" });
  assert.ok(!noStats.signals.some((s) => s.code === "S5"));
});

test("S6：邮箱域名失配 → S6；官方页佐证后不命中", () => {
  const base = {
    opportunityId: "opp-example-s6",
    orgOfficialDomain: "example.edu",
    contactEmail: "billing@example-pay.example",
    bodyExcerpt: "日常事务（示例）",
  };
  const mismatch = reviewAuthenticity(base);
  assert.ok(mismatch.signals.some((s) => s.code === "S6"));
  const corroborated = reviewAuthenticity({
    ...base,
    officialPageExcerpt: "联系邮箱 billing@example-pay.example（示例）",
  });
  assert.ok(!corroborated.signals.some((s) => s.code === "S6"));
});

test("S7：截止日与官方原文冲突 → S7（单软信号 → 全局 pending）；一致 → deadline 维 trusted", () => {
  const base = {
    opportunityId: "opp-example-s7",
    deadline: "2026-11-30",
    bodyExcerpt: "日常事务（示例）",
  };
  const conflict = reviewAuthenticity({ ...base, officialDeadline: "2026-10-31" });
  assert.ok(conflict.signals.some((s) => s.code === "S7"));
  assert.equal(conflict.state, "pending", "S7 单独命中 → pending（宁可待验证不误伤）");

  const agree = reviewAuthenticity({
    ...base,
    officialDeadline: "2026-11-30",
    orgOfficialDomain: "example.edu",
    officialPageUrl: "https://www.example.edu/jobs",
    org: "某大学脑科学中心",
    orgOfficialName: "某大学脑科学中心",
    contactEmail: "hr@example.edu",
    fundingClaim: "每月 3000 元（示例）",
    scholarshipPageExcerpt: "资助标准每月 3000 元（示例）",
    officialPageExcerpt: "某大学脑科学中心招聘（示例）",
  });
  assert.equal(agree.dims.deadline.state, "trusted");
});

test("S8：连续失败达到阈值才命中；快照缺失即命中", () => {
  const below = reviewAuthenticity({ opportunityId: "x", consecutiveFailures: S8_FAILURE_THRESHOLD - 1 });
  assert.ok(!below.signals.some((s) => s.code === "S8"));
  const at = reviewAuthenticity({ opportunityId: "x", consecutiveFailures: S8_FAILURE_THRESHOLD });
  assert.ok(at.signals.some((s) => s.code === "S8"));
  const missing = reviewAuthenticity({ opportunityId: "x", snapshotMissing: true });
  assert.ok(missing.signals.some((s) => s.code === "S8"));
});

test("R1：域名不一致且无佐证 → dim pending（不误判仿冒也不给可信）", () => {
  const review = reviewAuthenticity({
    opportunityId: "opp-example-r1",
    orgOfficialDomain: "example.edu",
    officialPageUrl: "https://jobs.example-board.example/123",
  });
  assert.equal(review.dims.org.state, "pending");
  assert.ok(review.dims.org.reasons.some((r) => r.includes("不一致")));
  assert.equal(review.state, "pending");
});

test("R4：资助声明无官方佐证 → salary_funding pending；有数额佐证 → trusted", () => {
  const none = reviewAuthenticity({
    opportunityId: "opp-example-r4",
    fundingClaim: "每月资助 5000 元（示例）",
    scholarshipPageExcerpt: "本所概况（示例）",
  });
  assert.equal(none.dims.salary_funding.state, "pending");

  const ok = reviewAuthenticity({
    opportunityId: "opp-example-r4b",
    fundingClaim: "每月资助 5000 元（示例）",
    scholarshipPageExcerpt: "资助标准：每月 5000 元（示例）",
  });
  assert.equal(ok.dims.salary_funding.state, "trusted");
});

// ── 隔离性（T1 §四）─────────────────────────────────────────

test("上下文隔离：多传推断字段（fit/why/action/summary）不改变结论", () => {
  const clean = loadFixture("opp-example-trust");
  const polluted = {
    ...clean,
    fit: "高度匹配",
    why: "采集链路推断字段（示例）",
    action: "立即行动",
    summary: "推断摘要（示例）",
  };
  assert.deepEqual(reviewAuthenticity(polluted), reviewAuthenticity(clean));
});

test("确定性：同一证据重复复核结论逐字节一致（无时钟无随机）", () => {
  const ev = loadFixture("opp-example-scam");
  assert.equal(JSON.stringify(reviewAuthenticity(ev)), JSON.stringify(reviewAuthenticity(ev)));
});

// ── 置信度公式 ───────────────────────────────────────────────

test("置信度：确定性公式，基线 30、逐项累加、上限 100", () => {
  const dims = {
    org: { state: "pending", reasons: [], evidence_refs: [] },
    salary_funding: { state: "pending", reasons: [], evidence_refs: [] },
    contact: { state: "pending", reasons: [], evidence_refs: [] },
    deadline: { state: "pending", reasons: [], evidence_refs: [] },
  };
  assert.equal(confidenceOf({ dims, fieldEvidenceCount: 0 }), 30);
  assert.equal(confidenceOf({
    dims: {
      ...dims,
      org: { state: "trusted", reasons: [], evidence_refs: ["u"] },
      contact: { state: "trusted", reasons: [], evidence_refs: ["e"] },
    },
    officialPageExcerpt: "x",
    fieldEvidenceCount: 2,
  }), 95);
});

// ── 本地继承（T1 §2.3）──────────────────────────────────────

test("本地缓存继承：cmdPull 收录合法 authenticity；非法 state 丢弃；缺字段零迁移", () => {
  const raw = [
    {
      id: "opp-example-trust",
      title: "某大学脑科学中心科研助理（示例）",
      authenticity: { state: "trusted", checkedAt: "2026-10-25T09:00:00.000Z", signals: [{ code: "S1", detail: "x（示例）" }] },
    },
    {
      id: "opp-example-bad",
      title: "非法 state（示例）",
      authenticity: { state: "surely-fine" },
    },
    {
      id: "opp-example-legacy",
      title: "老缓存机会（示例，无 authenticity 字段）",
    },
    {
      id: "opp-example-junk",
      title: "signals 形状不合法（示例）",
      authenticity: { state: "pending", signals: ["not-an-object", { code: 1, detail: 2 }] },
    },
  ];
  const { cached } = cmdPull(raw);
  assert.equal(cached.length, 4, "authenticity 不合法只丢字段不丢机会");

  const trust = cached.find((o) => o.id === "opp-example-trust");
  assert.deepEqual(trust.authenticity, {
    state: "trusted",
    checkedAt: "2026-10-25T09:00:00.000Z",
    signals: [{ code: "S1", detail: "x（示例）" }],
  });

  assert.equal(cached.find((o) => o.id === "opp-example-bad").authenticity, undefined);
  assert.equal(cached.find((o) => o.id === "opp-example-legacy").authenticity, undefined);

  const junk = cached.find((o) => o.id === "opp-example-junk");
  assert.equal(junk.authenticity.state, "pending");
  assert.equal(junk.authenticity.signals, undefined, "形状不合法的 signals 不收录");
});

test("零网络：authenticity 模块不发起任何网络调用", () => {
  for (const file of ["signals.ts", "reviewer.ts"]) {
    const src = readFileSync(
      fileURLToPath(new URL(`../lib/authenticity/${file}`, import.meta.url)),
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
});
