import assert from "node:assert/strict";
import test from "node:test";
import * as drafter from "../lib/local-apply/drafter.ts";
import {
  AI_DRAFT_MARKER,
  createDraftStore,
  draftCv,
  draftEmail,
  draftPs,
} from "../lib/local-apply/drafter.ts";

const opp = {
  id: "opp-ucl-phd-2027",
  title: "UCL 脑机接口博士项目",
  org: "伦敦大学学院",
  type: "phd",
  region: "英国",
  deadline: "2026-12-15",
  keywords: ["脑机接口", "神经科学", "机器学习"],
  mentors: ["张教授"],
  description: "脑机接口方向博士招生",
};

const profile = {
  name: "李同学",
  education: ["2027 年实验心理学硕士"],
  experience: ["脑机接口方向的脑电信号采集与分析项目", "认知神经科学实验室科研助理"],
  skills: ["Python", "脑机接口"],
  interests: ["神经科学", "脑启发 AI"],
};

const analysis = {
  opportunityId: opp.id,
  score: 0.72,
  gaps: [
    { dimension: "direction", severity: "high", detail: "缺机器学习方向的正式项目经历" },
    { dimension: "mentor", severity: "low", detail: "与张教授方向基本契合" },
  ],
};

test("T3-1 · 简历建议引用机会关键词（已覆盖/未覆盖分开列）", () => {
  const md = draftCv(opp, profile, analysis);
  // "脑机接口"命中 profile.skills；"机器学习"未命中
  assert.match(md, /已覆盖.*脑机接口/);
  assert.match(md, /未覆盖.*机器学习/);
  // 命中关键词的档案条目出现在"建议强调"
  assert.match(md, /建议强调[\s\S]*脑电信号采集与分析项目/);
});

test("T3-2 · 三种草稿都带 AI 草稿强制标注", () => {
  for (const md of [draftCv(opp, profile), draftPs(opp, profile), draftEmail(opp, profile)]) {
    assert.ok(md.includes(AI_DRAFT_MARKER), "missing marker");
    assert.match(md, /未经人工审阅不得直接发送/);
  }
  // 标注在正文最前面
  assert.ok(draftPs(opp, profile).startsWith("> ⚠️"));
});

test("T3-3 · 套磁信填入机构与导师名；无导师时用兜底称呼", () => {
  const withMentor = draftEmail(opp, profile);
  assert.match(withMentor, /伦敦大学学院/);
  assert.match(withMentor, /尊敬的张教授/);
  assert.match(withMentor, /李同学/);

  const noMentor = draftEmail({ ...opp, mentors: [] }, profile);
  assert.match(noMentor, /尊敬的招生老师/);

  // 联系方式留占位，不自动填（防误发）
  assert.match(withMentor, /\[联系方式\]/);
});

test("T3-4 · 高缺口驱动建议：简历与 PS 都回应", () => {
  const cv = draftCv(opp, profile, analysis);
  assert.match(cv, /高缺口.*缺机器学习方向的正式项目经历/);
  const ps = draftPs(opp, profile, analysis);
  assert.match(ps, /待人工补充[\s\S]*缺机器学习方向的正式项目经历/);
});

test("T3-5 · 不编造：档案缺失项用占位符", () => {
  const thin = { name: undefined, education: [], experience: [], skills: [], interests: [] };
  const ps = draftPs(opp, thin);
  assert.match(ps, /\[待填写/);
  const email = draftEmail(opp, thin);
  assert.match(email, /\[待填写：姓名\]/);
});

test("T3-6 · 版本化存储：递增、取最新、按版本取", () => {
  const store = createDraftStore(() => new Date("2026-10-19T09:00:00Z"));
  const v1 = store.save("ps", opp.id, draftPs(opp, profile));
  const v2 = store.save("ps", opp.id, draftPs(opp, profile));
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(v1.id, `ps:${opp.id}:v1`);
  assert.equal(v2.id, `ps:${opp.id}:v2`);
  // marker 在存储层同样强制
  assert.equal(v2.marker, AI_DRAFT_MARKER);
  // get() 无版本号时取最新
  assert.equal(store.get("ps", opp.id)?.version, 2);
  assert.equal(store.get("ps", opp.id, 1)?.id, v1.id);
  // 不同 kind / 机会的版本计数独立
  const other = store.save("email", opp.id, draftEmail(opp, profile));
  assert.equal(other.version, 1);
  assert.equal(store.list(opp.id).length, 3);
  assert.equal(store.get("cv", opp.id), undefined);
});

test("T3-7 · 无发送能力：模块不导出任何发送语义的函数", () => {
  const names = Object.keys(drafter);
  // 显式黑名单：出现即失败
  for (const n of names) {
    assert.doesNotMatch(n, /send|deliver|dispatch|submit/i, `send-like export: ${n}`);
  }
  // 允许的导出白名单（值导出；类型在运行时不存在）
  const allowed = new Set([
    "AI_DRAFT_MARKER",
    "createDraftStore",
    "draftCv",
    "draftEmail",
    "draftPs",
  ]);
  for (const n of names) {
    assert.ok(allowed.has(n), `unexpected export: ${n}`);
  }
});

test("T3-8 · 确定性：同样输入产出同样正文（createdAt 只在存储元数据）", () => {
  assert.equal(draftPs(opp, profile, analysis), draftPs(opp, profile, analysis));
  assert.equal(draftEmail(opp, profile), draftEmail(opp, profile));
});

test("T3-9 · 短关键词不误命中（'AI' 不应命中 'said' 类文本）", () => {
  const tricky = {
    ...opp,
    keywords: ["AI"],
  };
  const p = { ...profile, skills: ["said"], experience: [], interests: [], education: [] };
  const md = draftCv(tricky, p);
  assert.match(md, /已覆盖（0）/);
});
