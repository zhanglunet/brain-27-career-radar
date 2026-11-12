import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { assessOpportunities, verifyAssessment } from "../platform/find/assess.ts";
import { forUser } from "../platform/data/scoped.ts";
import { normalizeProfile } from "../platform/profile/schema.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { fakeLlm } from "./helpers/fake-llm.mjs";

const REQS = ["硕士及以上学历", "熟悉 Python", "有海外交流经历"];
const PROFILE = normalizeProfile({ education: [{ school: "示例大学", degree: "硕士", major: "心理学" }], skills: ["Python"] });
const TARGET = { kinds: ["校招"], directions: ["用户研究"], cities: ["北京"], timing: null, notes: null };

test("缺依据的满足 / 不满足改为未知，漏掉的要求补未知", () => {
  const result = verifyAssessment({
    items: [
      { requirement: "硕士及以上学历", status: "满足", evidence: "档案：示例大学 硕士" },
      { requirement: "熟悉 Python", status: "满足", evidence: "" },
    ],
    reasons: ["方向一致"],
    gaps: [],
    score: 87.6,
  }, REQS);
  assert.deepEqual(result.items, [
    { requirement: "硕士及以上学历", status: "满足", evidence: "档案：示例大学 硕士" },
    { requirement: "熟悉 Python", status: "未知", evidence: null },
    { requirement: "有海外交流经历", status: "未知", evidence: null },
  ]);
  assert.equal(result.score, 88);
});

test("模型引用页面没有的要求被丢弃；状态非法改为未知；同一要求只取第一项", () => {
  const result = verifyAssessment({
    items: [
      { requirement: "有五年工作经验", status: "不满足", evidence: "x" },
      { requirement: "熟悉 Python", status: "大概满足", evidence: "y" },
      { requirement: "熟悉 Python", status: "满足", evidence: "z" },
    ],
  }, ["熟悉 Python"]);
  assert.deepEqual(result.items, [{ requirement: "熟悉 Python", status: "未知", evidence: null }]);
});

test("score 夹在 0–100，缺省 0；理由与差距各最多 5 条、每条 200 字", () => {
  assert.equal(verifyAssessment({ score: 140 }, []).score, 100);
  assert.equal(verifyAssessment({ score: -3 }, []).score, 0);
  assert.equal(verifyAssessment({}, []).score, 0);
  const result = verifyAssessment({ reasons: Array.from({ length: 9 }, () => "理".repeat(300)), gaps: ["差距"] }, []);
  assert.equal(result.reasons.length, 5);
  assert.ok(result.reasons.every((r) => [...r].length === 200));
  assert.deepEqual(result.gaps, ["差距"]);
});

test("超过 5 条分批调用模型，结果按 key 返回", async () => {
  const opps = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, title: `岗位${i}`, org: null, requirements: ["熟悉 Python"], location: null, kind: null }));
  const llm = fakeLlm((messages) => {
    const keys = [...messages[1].content.matchAll(/"key":"(k\d)"/g)].map((m) => m[1]);
    return { results: keys.map((key) => ({ key, items: [{ requirement: "熟悉 Python", status: "满足", evidence: "技能：Python" }], score: 70 })) };
  });
  const map = await assessOpportunities(llm, PROFILE, TARGET, opps);
  assert.equal(llm.calls.length, 2);
  assert.equal(map.size, 7);
  assert.equal(map.get("k6").items[0].status, "满足");
});

test("模型漏掉某条机会时，该机会全部判未知", async () => {
  const opps = [{ key: "a", title: "A", org: null, requirements: ["熟悉 Python"], location: null, kind: null }];
  const map = await assessOpportunities(fakeLlm([{ results: [] }]), PROFILE, TARGET, opps);
  assert.deepEqual(map.get("a").items, [{ requirement: "熟悉 Python", status: "未知", evidence: null }]);
});

test("评估提示词要求依据档案原话，含小写 json，且不含姓名", async () => {
  const llm = fakeLlm([{ results: [] }]);
  await assessOpportunities(llm, normalizeProfile({ basics: { name: "张三（示例）" }, skills: ["Python"] }), TARGET, [{ key: "a", title: "A", org: null, requirements: [], location: null, kind: null }]);
  const [system, user] = llm.calls[0];
  assert.ok(system.content.includes("json"));
  assert.match(system.content, /未知/);
  assert.doesNotMatch(user.content, /张三/);
});

async function scopeWithGoal() {
  const { env, deps } = await makeEnv();
  const c = await activeUser(env, deps, "a@example.test");
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await c.post("/goals", { title: "目标", description: "d" });
  const scope = forUser(env.PRIVATE_DB, c.user.id);
  const [goal] = await scope.goals.list();
  return { env, deps, c, scope, goal };
}

const base = (overrides = {}) => ({
  key: "https://careers.example.test/ux-1",
  title: "用户研究工程师",
  org: "示例公司",
  url: "https://careers.example.test/ux-1",
  tier: "L2",
  source: { url: "https://careers.example.test/campus", tier: "L2" },
  location: "北京",
  kind: "校招",
  deadlineStatus: "unknown",
  deadlineDate: null,
  requirements: ["熟悉 Python"],
  risk: null,
  ...overrides,
});

test("同一机会从两个来源进入时合并，保留两个来源，层级取更可信者", async () => {
  const { scope, goal } = await scopeWithGoal();
  await scope.opportunities.upsert(goal.id, base(), 1);
  await scope.opportunities.upsert(goal.id, base({ tier: "L1", source: { url: "https://radar.example.test/o1", tier: "L1" }, deadlineStatus: "date", deadlineDate: "2026-12-01", org: null }), 2);
  const [opp] = await scope.opportunities.list(goal.id);
  assert.equal(opp.tier, "L1");
  assert.deepEqual(opp.sources.map((s) => s.url), ["https://careers.example.test/campus", "https://radar.example.test/o1"]);
  assert.equal(opp.deadlineDate, "2026-12-01");
  assert.equal(opp.org, "示例公司", "空值不覆盖已有值");
});

test("upsert 返回要求是否有变化（供决定是否重新评估）", async () => {
  const { scope, goal } = await scopeWithGoal();
  assert.deepEqual(await scope.opportunities.upsert(goal.id, base(), 1), { created: true, requirementsChanged: true });
  assert.deepEqual(await scope.opportunities.upsert(goal.id, base(), 2), { created: false, requirementsChanged: false });
  assert.deepEqual(await scope.opportunities.upsert(goal.id, base({ requirements: ["熟悉 Python", "硕士"] }), 3), { created: false, requirementsChanged: true });
});

test("评估写入后按分数排序，未评估的排在后面", async () => {
  const { scope, goal } = await scopeWithGoal();
  for (const key of ["a", "b", "c"]) await scope.opportunities.upsert(goal.id, base({ key, url: `https://x.example.test/${key}` }), 1);
  await scope.opportunities.setAssessment(goal.id, "a", { items: [], reasons: [], gaps: [], score: 30 }, 2);
  await scope.opportunities.setAssessment(goal.id, "b", { items: [], reasons: [], gaps: [], score: 90 }, 2);
  assert.deepEqual((await scope.opportunities.list(goal.id)).map((o) => o.key), ["b", "a", "c"]);
  assert.equal((await scope.opportunities.list(goal.id))[0].assessment.score, 90);
});

test("用户标记在重新运行后保留；不感兴趣的默认不列出", async () => {
  const { scope, goal } = await scopeWithGoal();
  await scope.opportunities.upsert(goal.id, base(), 1);
  const [opp] = await scope.opportunities.list(goal.id);
  assert.equal(await scope.opportunities.mark(opp.id, "dismissed"), true);
  await scope.opportunities.upsert(goal.id, base({ title: "更新后的标题" }), 2);
  assert.deepEqual(await scope.opportunities.list(goal.id), []);
  const [all] = await scope.opportunities.list(goal.id, { includeDismissed: true });
  assert.equal(all.mark, "dismissed");
  assert.equal(all.title, "更新后的标题");
});

test("A 不能标记 B 的机会；非法标记被拒", async () => {
  const a = await scopeWithGoal();
  const b = forUser(a.env.PRIVATE_DB, "someone-else");
  await a.scope.opportunities.upsert(a.goal.id, base(), 1);
  const [opp] = await a.scope.opportunities.list(a.goal.id);
  assert.equal(await b.opportunities.mark(opp.id, "done"), false);
  await assert.rejects(() => a.scope.opportunities.mark(opp.id, "hacked"));
  assert.equal((await a.scope.opportunities.list(a.goal.id))[0].mark, "new");
});

test("机会只能写入本人的目标", async () => {
  const a = await scopeWithGoal();
  const other = forUser(a.env.PRIVATE_DB, "someone-else");
  assert.deepEqual(await other.opportunities.upsert(a.goal.id, base(), 1), { created: false, requirementsChanged: false });
  assert.deepEqual(await a.scope.opportunities.list(a.goal.id), []);
});
