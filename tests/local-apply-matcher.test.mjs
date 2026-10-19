import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  matchOpportunity,
  MATCH_WEIGHTS,
  MATCH_RULE_VERSION,
} from "../lib/local-apply/matcher.ts";

const NOW = new Date("2026-10-19T00:00:00Z");

function opp(over = {}) {
  return {
    id: "o1",
    title: "UCL 脑机接口博士项目",
    org: "伦敦大学学院",
    type: "phd",
    region: "英国",
    funding: "full",
    deadline: "2027-01-15",
    body: "脑机接口与认知神经科学方向博士，研究神经信号解码",
    keywords: ["脑机接口", "神经信号"],
    mentors: ["张三"],
    requirements: ["硕士学历"],
    ...over,
  };
}

function profile(over = {}) {
  return {
    degree: "实验心理学硕士",
    researchInterests: ["脑机接口", "认知神经科学"],
    skills: ["EEG 信号处理", "Python"],
    mentorsOfInterest: ["张三"],
    targetRegions: ["英国"],
    targetTypes: ["phd"],
    fundingNeed: "full",
    ...over,
  };
}

function dimOf(result, id) {
  return result.dimensions.find((d) => d.dimension === id);
}

test("高匹配：三维全中，总分 1.0，零缺口", () => {
  const r = matchOpportunity(opp(), profile(), { now: NOW });
  assert.equal(r.opportunityId, "o1");
  assert.equal(r.score, 1);
  assert.equal(r.gaps.length, 0);
  assert.equal(dimOf(r, "direction").score, 1);
  assert.equal(dimOf(r, "mentor").score, 1);
  assert.equal(dimOf(r, "requirements").score, 1);
  assert.equal(r.ruleVersion, MATCH_RULE_VERSION);
  assert.match(r.summary, /综合匹配度 1\.00/);
});

test("方向不匹配：方向 0 分，缺口指出未覆盖的兴趣", () => {
  const r = matchOpportunity(
    opp(),
    profile({ researchInterests: ["气候建模", "古生物学"] }),
    { now: NOW },
  );
  assert.equal(dimOf(r, "direction").score, 0);
  assert.ok(r.gaps.some((g) => g.includes("方向缺口") && g.includes("气候建模")));
  assert.ok(r.gaps.some((g) => g.includes("古生物学")));
  // 方向 0 × 0.5 + 导师 1 × 0.3 + 条件 1 × 0.2 = 0.5
  assert.equal(r.score, 0.5);
});

test("硬门槛不满足：截止日过期 + 资助/类型/地区/学历全挂", () => {
  const r = matchOpportunity(
    opp({
      type: "intern",
      region: "爱尔兰",
      funding: "self",
      deadline: "2026-01-01",
      requirements: ["博士学位"],
    }),
    profile(),
    { now: NOW },
  );
  const req = dimOf(r, "requirements");
  assert.equal(req.score, 0);
  assert.ok(r.gaps.some((g) => g.includes("已过截止日")));
  assert.ok(r.gaps.some((g) => g.includes("资助不满足")));
  assert.ok(r.gaps.some((g) => g.includes("类型不匹配")));
  assert.ok(r.gaps.some((g) => g.includes("地区不匹配")));
  assert.ok(r.gaps.some((g) => g.includes("学历门槛")));
  // 方向 1 × 0.5 + 导师 1 × 0.3 + 条件 0 × 0.2 = 0.8
  assert.equal(r.score, 0.8);
});

test("可解释性：每个维度恒有 ≥1 条理由", () => {
  const cases = [
    [opp(), profile()],
    [opp(), profile({ researchInterests: [] })],
    [opp({ mentors: [] }), profile()],
    [opp(), profile({ mentorsOfInterest: [] })],
    [opp({ deadline: null, funding: undefined, requirements: [] }), profile({ targetTypes: [], targetRegions: [], fundingNeed: "any" })],
  ];
  for (const [o, p] of cases) {
    const r = matchOpportunity(o, p, { now: NOW });
    assert.equal(r.dimensions.length, 3);
    for (const d of r.dimensions) {
      assert.ok(
        d.reasons.length >= 1,
        `dimension ${d.dimension} 必须有理由`,
      );
      assert.ok(d.score >= 0 && d.score <= 1);
    }
  }
});

test("信息缺失时中性不扣分（宁漏报不错杀）", () => {
  const r = matchOpportunity(
    opp({ mentors: [], deadline: null }),
    profile({ researchInterests: [], mentorsOfInterest: [] }),
    { now: NOW },
  );
  assert.equal(dimOf(r, "direction").score, 0.5);
  assert.equal(dimOf(r, "mentor").score, 0.5);
  // 0.5×0.5 + 0.5×0.3 + 1×0.2 = 0.6
  assert.equal(r.score, 0.6);
});

test("确定性：同样输入两次结果完全一致", () => {
  const a = matchOpportunity(opp(), profile(), { now: NOW });
  const b = matchOpportunity(opp(), profile(), { now: NOW });
  assert.deepEqual(a, b);
});

test("权重是用户拍板的值，T2 不得擅改", () => {
  assert.deepEqual({ ...MATCH_WEIGHTS }, {
    direction: 0.5,
    mentor: 0.3,
    requirements: 0.2,
  });
  const weights = Object.values(MATCH_WEIGHTS).reduce((s, w) => s + w, 0);
  assert.ok(Math.abs(weights - 1) < 1e-9);
});

test("数据主权：模块源码不含任何网络调用", () => {
  const src = readFileSync(
    new URL("../lib/local-apply/matcher.ts", import.meta.url),
    "utf-8",
  );
  assert.ok(!src.includes("fetch("), "must not call fetch");
  assert.ok(!src.includes("XMLHttpRequest"), "must not use XHR");
  assert.ok(!src.includes("node:http"), "must not import http");
  assert.ok(src.includes("数据主权红线"), "red-line comment must exist");
});
