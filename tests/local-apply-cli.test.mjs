import assert from "node:assert/strict";
import test from "node:test";
import {
  cmdPull,
  cmdMatch,
  cmdDraft,
  cmdInterview,
  cmdStatus,
  parseArgs,
  HELP_TEXT,
} from "../lib/local-apply/cli.ts";
import { AI_DRAFT_MARKER, createDraftStore } from "../lib/local-apply/drafter.ts";

// ── 合成 fixture（无真实个人信息） ──

const PROFILE = {
  degree: "实验心理学硕士",
  researchInterests: ["脑机接口", "认知神经科学"],
  skills: ["Python", "EEG 信号处理"],
  mentorsOfInterest: ["张三"],
  targetRegions: ["英国"],
  targetTypes: ["ra"],
  fundingNeed: "any",
  name: "测试用户",
  experience: ["硕士期间做过运动想象脑机接口实验"],
};

const RAW_OPPORTUNITIES = [
  {
    id: "ox-ra-1",
    title: "牛津大学脑机接口研究助理",
    org: "牛津大学",
    type: "ra",
    region: "英国",
    funding: "full",
    deadline: "2027-01-15",
    keywords: ["脑机接口", "认知神经科学"],
    mentors: ["张三"],
    requirements: ["硕士学历"],
  },
  {
    id: "cam-ra-1",
    title: "剑桥大学认知神经科学研究助理",
    org: "剑桥大学",
    type: "ra",
    region: "英国",
    keywords: ["认知神经科学"],
  },
  { id: "bad-1", title: 123 }, // 非法：title 不是字符串，应被丢弃
  { title: "缺 id 的条目" }, // 非法：无 id，应被丢弃
  {
    id: "sz-intern-1",
    title: "深圳 AI 公司算法实习生",
    org: "某科技公司",
    type: "intern",
    region: "深圳",
  },
];

function pulledCache() {
  return cmdPull(RAW_OPPORTUNITIES).cached;
}

// ── pull ──

test("pull：校验白名单字段，非法条目被丢弃并计数", () => {
  const r = cmdPull(RAW_OPPORTUNITIES);
  assert.equal(r.total, 5);
  assert.equal(r.kept, 3);
  assert.equal(r.dropped, 2);
  assert.deepEqual(
    r.cached.map((o) => o.id).sort(),
    ["cam-ra-1", "ox-ra-1", "sz-intern-1"],
  );
  // 白名单外的字段不应进入缓存
  assert.ok(!("unknownField" in r.cached[0]));
});

test("pull：--type/--region 过滤", () => {
  const byType = cmdPull(RAW_OPPORTUNITIES, { type: "ra" });
  assert.deepEqual(
    byType.cached.map((o) => o.id).sort(),
    ["cam-ra-1", "ox-ra-1"],
  );
  const byRegion = cmdPull(RAW_OPPORTUNITIES, { region: "英国" });
  assert.equal(byRegion.kept, 2);
  const both = cmdPull(RAW_OPPORTUNITIES, { type: "intern", region: "深圳" });
  assert.deepEqual(
    both.cached.map((o) => o.id),
    ["sz-intern-1"],
  );
});

test("pull：非数组输入视为空", () => {
  const r = cmdPull({ not: "an array" });
  assert.equal(r.kept, 0);
  assert.equal(r.total, 0);
});

// ── match ──

test("match：牛津 RA 得分高于对照组，且有缺口解释", () => {
  const cache = pulledCache();
  const ox = cmdMatch(cache, PROFILE, "ox-ra-1", new Date("2026-10-19"));
  const ctrl = cmdMatch(cache, PROFILE, "sz-intern-1", new Date("2026-10-19"));
  assert.ok(ox.result.score > ctrl.result.score, `ox=${ox.result.score} ctrl=${ctrl.result.score}`);
  assert.equal(ox.result.dimensions.length, 3);
  for (const d of ox.result.dimensions) {
    assert.ok(d.reasons.length >= 1, "每维度恒有理由");
  }
  assert.ok(ox.text.includes("匹配度"));
});

test("match：机会不存在时抛错点名", () => {
  const cache = pulledCache();
  assert.throws(() => cmdMatch(cache, PROFILE, "no-such-id"), /机会不存在/);
});

// ── draft ──

test("draft：三种草稿都带 AI 标注并版本化", () => {
  const cache = pulledCache();
  const store = createDraftStore(() => new Date("2026-10-19T00:00:00Z"));
  for (const kind of ["cv", "ps", "email"]) {
    const { draft, text } = cmdDraft(cache, PROFILE, store, kind, "ox-ra-1", new Date("2026-10-19"));
    assert.ok(draft.content.includes(AI_DRAFT_MARKER), `${kind} 缺少 AI 标注`);
    assert.equal(draft.version, 1);
    assert.ok(text.includes(draft.id));
  }
  // 第二次保存同种草稿，版本递增
  const again = cmdDraft(cache, PROFILE, store, "ps", "ox-ra-1", new Date("2026-10-19"));
  assert.equal(again.draft.version, 2);
  assert.equal(store.list("ox-ra-1").length, 4);
});

test("draft：草稿内容引用机会与缺口（链式调用生效）", () => {
  const cache = pulledCache();
  const store = createDraftStore(() => new Date("2026-10-19T00:00:00Z"));
  // cam-ra-1 与档案方向部分匹配，应有缺口驱动内容
  const { draft } = cmdDraft(cache, PROFILE, store, "cv", "cam-ra-1", new Date("2026-10-19"));
  assert.ok(draft.content.includes("剑桥大学"));
});

// ── interview ──

test("interview：生成三类问题，非交互版有声明", () => {
  const cache = pulledCache();
  const { questions, text } = cmdInterview(cache, PROFILE, "ox-ra-1", new Date("2026-10-19"));
  assert.ok(questions.length >= 3, "至少三类各 1 题");
  const cats = new Set(questions.map((q) => q.category));
  assert.ok(cats.has("research_depth"));
  assert.ok(cats.has("motivation"));
  assert.ok(cats.has("gap_followup"));
  for (const q of questions) {
    assert.ok(q.intent.length > 0, "每题有考察意图");
  }
  assert.ok(text.includes("非交互版"));
});

// ── status ──

test("status：盘点档案/机会/草稿数量", () => {
  const cache = pulledCache();
  const store = createDraftStore(() => new Date("2026-10-19T00:00:00Z"));
  cmdDraft(cache, PROFILE, store, "email", "ox-ra-1", new Date("2026-10-19"));
  const { text, counts } = cmdStatus(cache, PROFILE, store);
  assert.equal(counts.opportunities, 3);
  assert.equal(counts.drafts, 1);
  assert.equal(counts.profile, "实验心理学硕士");
  assert.ok(text.includes("纯本地"));
});

// ── 全链路 ──

test("全链路：pull → match → draft → interview 串起来", () => {
  const cache = cmdPull(RAW_OPPORTUNITIES, { region: "英国" }).cached;
  assert.equal(cache.length, 2);
  const store = createDraftStore(() => new Date("2026-10-19T00:00:00Z"));
  const now = new Date("2026-10-19");
  const m = cmdMatch(cache, PROFILE, "ox-ra-1", now);
  assert.ok(m.result.score > 0);
  const d = cmdDraft(cache, PROFILE, store, "ps", "ox-ra-1", now);
  assert.ok(d.draft.id.startsWith("ps:ox-ra-1:v"));
  const iv = cmdInterview(cache, PROFILE, "ox-ra-1", now);
  assert.ok(iv.questions.length > 0);
  const st = cmdStatus(cache, PROFILE, store);
  assert.equal(st.counts.drafts, 1);
});

// ── 参数解析 ──

test("parseArgs：五命令 + --key value/--key=value", () => {
  assert.deepEqual(parseArgs(["pull", "--input", "a.json"]).command, "pull");
  assert.deepEqual(parseArgs(["match", "ox-ra-1"]).positional, ["ox-ra-1"]);
  const p = parseArgs(["draft", "ps", "ox-ra-1", "--profile=p.json", "--cache", "c.json"]);
  assert.equal(p.command, "draft");
  assert.deepEqual(p.positional, ["ps", "ox-ra-1"]);
  assert.equal(p.flags["profile"], "p.json");
  assert.equal(p.flags["cache"], "c.json");
  assert.equal(parseArgs([]).command, "help");
  assert.equal(parseArgs(["bogus"]).command, "help");
});

test("--help 文本声明纯本地保证", () => {
  assert.ok(HELP_TEXT.includes("不向任何服务器发送数据"));
  assert.ok(HELP_TEXT.includes("永不出机器"));
});
