import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  CLASSIFY_RULE_VERSION,
  CLASSIFY_WEIGHTS,
  CONFIDENCE_GATE,
  DEFAULT_DICTS,
} from "../lib/wiki/classifier.ts";

function makeEntry({
  id = "e1",
  title,
  body = "",
  source = "测试来源",
  last_verified = "2026-10-18",
  facets = {},
}) {
  return {
    id,
    title,
    source,
    source_url: "",
    source_type: "daily_report",
    d1_evidence: null,
    confidence: "medium",
    created: "2026-10-18",
    last_verified,
    status: "active",
    facets,
    body,
  };
}

// ── L1 四类 ─────────────────────────────────────────────────────────────

test("L1：白名单命中 → 高校（UCL）", () => {
  const c = classify(makeEntry({ title: "UCL 脑机接口博士奖学金" })).classification;
  assert.equal(c.l1, "高校");
  assert.equal(c.scores.l1, 1);
});

test("L1：关键词 → 研究所", () => {
  const c = classify(
    makeEntry({ title: "中国科学院自动化研究所科研助理招聘" }),
  ).classification;
  assert.equal(c.l1, "研究所");
});

test("L1：关键词 → 企业", () => {
  const c = classify(
    makeEntry({ title: "深兰科技有限公司2026校园招聘" }),
  ).classification;
  assert.equal(c.l1, "企业");
});

test("L1：关键词 → 政府项目", () => {
  const c = classify(
    makeEntry({ title: "科技部重点研发计划申报指南" }),
  ).classification;
  assert.equal(c.l1, "政府项目");
});

test("L1：无法判定 → null，不硬编", () => {
  const c = classify(
    makeEntry({ title: "asdf qwerty", body: "nothing here", source: "某处" }),
  ).classification;
  assert.equal(c.l1, null);
});

// ── L2 映射 ─────────────────────────────────────────────────────────────

test("L2：博士 → phd", () => {
  const c = classify(makeEntry({ title: "UCL 博士奖学金" })).classification;
  assert.equal(c.l2, "phd");
});

test("L2：联培 → joint_phd，且抑制 博士→phd", () => {
  const c = classify(makeEntry({ title: "UCL 联培博士项目招生" })).classification;
  assert.equal(c.l2, "joint_phd");
  assert.equal(c.scores.l2, 1);
});

test("L2：助理/RA → ra", () => {
  const c = classify(makeEntry({ title: "科研助理 RA 招聘" })).classification;
  assert.equal(c.l2, "ra");
});

test("L2：校招 → campus", () => {
  const c = classify(
    makeEntry({ title: "深兰科技有限公司2026校园招聘" }),
  ).classification;
  assert.equal(c.l2, "campus");
});

test("L2：实习 → intern", () => {
  const c = classify(makeEntry({ title: "暑期实习生计划" })).classification;
  assert.equal(c.l2, "intern");
});

test("L2：访问学者 → research（T1 暂归）", () => {
  const c = classify(makeEntry({ title: "访问学者项目" })).classification;
  assert.equal(c.l2, "research");
});

// ── L3 多选 ─────────────────────────────────────────────────────────────

test("L3：多命中全收", () => {
  const c = classify(
    makeEntry({ title: "脑机接口与fMRI前沿研讨会" }),
  ).classification;
  assert.ok(c.l3.includes("脑机接口"));
  assert.ok(c.l3.includes("fMRI"));
  assert.equal(c.scores.l3, 1);
});

// ── 置信度数学 ──────────────────────────────────────────────────────────

test("置信度：三层全中、无惩罚 = 1.0", () => {
  const c = classify(
    makeEntry({ title: "UCL 脑机接口博士奖学金", source: "UCL 官网" }),
  ).classification;
  assert.deepEqual(c.scores, { l1: 1, l2: 1, l3: 1 });
  assert.equal(c.confidence, 1);
  assert.equal(c.needsReview, false);
});

test("惩罚：标题零命中 −0.2", () => {
  const c = classify(
    makeEntry({
      title: "News update",
      body: "UCL 博士奖学金（脑机接口方向）",
      source: "UCL 官网",
    }),
  ).classification;
  assert.equal(c.confidence, 0.8);
  assert.equal(c.needsReview, false);
});

test("惩罚：L1 未判定 −0.1 + 低可信来源 −0.1 + 标题零命中 −0.2，下限 0", () => {
  const c = classify(
    makeEntry({ title: "asdf qwerty", body: "nothing", source: "未知来源" }),
  ).classification;
  assert.equal(c.l1, null);
  assert.equal(c.confidence, 0);
  assert.equal(c.needsReview, true);
});

test("闸门：< 0.7 → 低置信待确认", () => {
  // 只有 L3 命中：0.4×1 −0.1(L1 null) −0.2(标题零命中) = 0.1
  const c = classify(
    makeEntry({ title: "会议通知", body: "脑机接口研讨会", source: "某学会" }),
  ).classification;
  assert.ok(c.confidence < CONFIDENCE_GATE);
  assert.equal(c.needsReview, true);
});

// ── 解释字段 ────────────────────────────────────────────────────────────

test("解释字段：hits/scores/confidence 齐全可审计", () => {
  const c = classify(
    makeEntry({ title: "UCL 脑机接口博士奖学金", source: "UCL 官网" }),
  ).classification;
  assert.ok(c.hits.includes("UCL"));
  assert.ok(c.hits.includes("博士"));
  assert.ok(c.hits.includes("脑机接口"));
  assert.ok("l1" in c.scores && "l2" in c.scores && "l3" in c.scores);
  assert.equal(typeof c.confidence, "number");
});

test("classify 不修改原条目", () => {
  const e = makeEntry({ title: "UCL 博士奖学金" });
  const snapshot = JSON.stringify(e);
  classify(e);
  assert.equal(JSON.stringify(e), snapshot);
  assert.ok(!("classification" in e));
});

// ── 常量与词典 ──────────────────────────────────────────────────────────

test("权重/闸门/规则版本常量", () => {
  assert.deepEqual({ ...CLASSIFY_WEIGHTS }, { l1: 0.3, l2: 0.3, l3: 0.4 });
  assert.equal(CONFIDENCE_GATE, 0.7);
  assert.equal(CLASSIFY_RULE_VERSION, "0.1");
  assert.ok(DEFAULT_DICTS.l1.length > 0);
  assert.ok(DEFAULT_DICTS.l2.length > 0);
  assert.equal(DEFAULT_DICTS.l3.length, 10); // WIKI_DIRECTIONS v0.1 逐字复用
});

test("dicts 可覆盖（测试注入）", () => {
  const dicts = {
    ...DEFAULT_DICTS,
    l1: [{ term: "火星", value: "高校", weight: 1.0 }],
    orgAllowlist: [],
  };
  const c = classify(makeEntry({ title: "火星博士招生" }), { dicts }).classification;
  assert.equal(c.l1, "高校");
});
