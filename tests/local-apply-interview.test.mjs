import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  INTERVIEW_CATEGORIES,
  INTERVIEW_CATEGORY_LABELS,
  answerQuestion,
  completeSession,
  generateQuestions,
  generateReview,
  startMockSession,
} from "../lib/local-apply/interview.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 合成 fixture（全虚构，无真实个人信息） ──

const opp = {
  id: "ucl-bci-phd-2027",
  title: "脑机接口方向博士（全奖）",
  org: "伦敦大学学院",
  type: "phd",
  region: "英国",
  funding: "full",
  deadline: "2027-01-15",
  keywords: ["脑机接口", "神经解码"],
  mentor: ["张教授"],
  description: "侵入式脑机接口的神经解码算法研究",
};

const profile = {
  education: ["实验心理学硕士（2027 毕业）"],
  researchInterests: ["脑机接口", "认知神经科学"],
  skills: ["Python", "EEG 数据分析"],
  experience: ["硕士论文：基于 EEG 的运动想象分类", "实验室 RA：被试招募与数据采集"],
};

const gaps = [
  { dimension: "research_direction", description: "缺侵入式电生理（ECoG/单细胞）经验", severity: "high" },
  { dimension: "requirements", description: "雅思 7.0 未达 7.5 要求", severity: "medium" },
];

// ── 问题集 ──

test("问题集三类必齐：研究方向深挖 / 动机 / 短板追问", () => {
  const qs = generateQuestions(opp, profile, gaps);
  const cats = new Set(qs.map((q) => q.category));
  for (const c of INTERVIEW_CATEGORIES) {
    assert.ok(cats.has(c), `缺类别 ${c}`);
  }
  assert.ok(qs.length >= 5, `题量过少: ${qs.length}`);
});

test("问题引用机会的领域/导师信息（非通用 HR 题）", () => {
  const qs = generateQuestions(opp, profile, gaps);
  const text = qs.map((q) => q.question).join("\n");
  assert.ok(text.includes("伦敦大学学院"), "应提到目标机构");
  assert.ok(
    text.includes("脑机接口") || text.includes("神经解码"),
    "应引用机会关键词",
  );
  assert.ok(text.includes("张教授"), "应引用导师名");
});

test("短板追问引用缺口项", () => {
  const qs = generateQuestions(opp, profile, gaps);
  const followups = qs.filter((q) => q.category === "gap_followup");
  assert.ok(followups.length >= 1);
  const text = followups.map((q) => q.question).join("\n");
  assert.ok(text.includes("ECoG") || text.includes("侵入式"), "应追问研究方向短板");
});

test("无缺口时仍有通用短板追问兜底", () => {
  const qs = generateQuestions(opp, profile, []);
  const followups = qs.filter((q) => q.category === "gap_followup");
  assert.equal(followups.length, 1);
});

test("每题带 intent 与 suggestedAngle（可解释）", () => {
  const qs = generateQuestions(opp, profile, gaps);
  for (const q of qs) {
    assert.ok(q.intent.length > 0, "intent 不得为空");
    assert.ok(q.suggestedAngle.length > 0, "suggestedAngle 不得为空");
    assert.ok(INTERVIEW_CATEGORY_LABELS[q.category], "类别标签存在");
  }
});

test("顺序固定：深挖 → 动机 → 短板追问", () => {
  const qs = generateQuestions(opp, profile, gaps);
  const order = qs.map((q) => INTERVIEW_CATEGORIES.indexOf(q.category));
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepEqual(order, sorted);
});

// ── 模拟轮次状态机 ──

test("模拟轮次：作答全部题目 → 复盘产出要点", () => {
  const qs = generateQuestions(opp, profile, gaps);
  let s = startMockSession(opp, qs, () => new Date("2026-10-19T09:00:00Z"));
  assert.equal(s.answers.length, 0);
  assert.ok(s.startedAt.startsWith("2026-10-19"));

  qs.forEach((q, i) => {
    s = answerQuestion(
      s,
      i,
      "这是一个足够长的模拟回答，用于验证复盘逻辑能够识别篇幅充分的答案并给出正向反馈。" +
        "回答应当包含背景、做法、个人贡献和结论四个部分，这样才符合博士面试的期待。",
    );
  });
  assert.equal(s.answers.length, qs.length);

  const { session, review } = completeSession(s, () => new Date("2026-10-19T09:30:00Z"));
  assert.ok(session.completedAt.startsWith("2026-10-19"));
  assert.ok(review.length > 0, "复盘不得为空");
  const kinds = new Set(review.map((r) => r.kind));
  assert.ok(kinds.has("strength"), "应有 strength 点");
  assert.ok(kinds.has("suggestion"), "应有 suggestion 点");
});

test("复盘：过短回答被标记为 gap，未答题给出 suggestion", () => {
  const qs = generateQuestions(opp, profile, gaps).slice(0, 3);
  let s = startMockSession(opp, qs);
  s = answerQuestion(s, 0, "太短");
  // 第 2、3 题故意不答
  const review = generateReview(s);
  const texts = review.map((r) => r.text).join("\n");
  assert.ok(texts.includes("过短"), "过短回答应被标记");
  assert.ok(texts.includes("未作答"), "未答题应给出准备建议");
});

test("answerQuestion 越界抛错", () => {
  const qs = generateQuestions(opp, profile, gaps);
  const s = startMockSession(opp, qs);
  assert.throws(() => answerQuestion(s, 99, "x"), RangeError);
  assert.throws(() => answerQuestion(s, -1, "x"), RangeError);
});

test("answerQuestion 不原地修改 session", () => {
  const qs = generateQuestions(opp, profile, gaps);
  const s0 = startMockSession(opp, qs);
  const s1 = answerQuestion(s0, 0, "回答内容足够长以通过复盘的长度检查标准线");
  assert.equal(s0.answers.length, 0, "原 session 不应被修改");
  assert.equal(s1.answers.length, 1);
});

// ── 数据主权：模块源码静态检查 ──

test("数据主权：interview.ts 不含任何网络调用", () => {
  const src = readFileSync(join(__dirname, "../lib/local-apply/interview.ts"), "utf-8");
  for (const banned of ["fetch(", "XMLHttpRequest", "WebSocket(", "child_process", "node:https", 'from "https"']) {
    assert.ok(!src.includes(banned), `源码不应包含 ${banned}`);
  }
});
