import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { forUser } from "../platform/data/scoped.ts";
import { decideNomination, listNominations, listPlatformSources } from "../platform/data/shared-sources.ts";
import { searchPublicOpportunities } from "../platform/data/public-readonly.ts";
import { AGGREGATOR_DOMAINS, isAggregator } from "../platform/find/tiers.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { createSqliteD1, tempDbPath } from "./helpers/sqlite-d1.mjs";

async function userWithGoal(env, deps, email) {
  const c = await activeUser(env, deps, email);
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await c.post("/goals", { title: "国内校招", description: "d" });
  const scope = forUser(env.PRIVATE_DB, c.user.id);
  const [goal] = await scope.goals.list();
  return { c, scope, goal };
}

test("来源去重按规范化 URL", async () => {
  const { env, deps } = await makeEnv();
  const { scope, goal } = await userWithGoal(env, deps, "a@example.test");
  const first = await scope.sources.add(goal.id, { url: "http://Jobs.Example.test/campus/?utm_source=x", org: "示例公司", tier: "L3", origin: "user" }, 1);
  const second = await scope.sources.add(goal.id, { url: "https://jobs.example.test/campus", org: null, tier: "L3", origin: "user" }, 2);
  assert.equal(first.id, second.id);
  assert.equal((await scope.sources.list(goal.id)).length, 1);
  assert.equal((await scope.sources.list(goal.id))[0].url, "http://Jobs.Example.test/campus/?utm_source=x", "按原始网址保存，规范化结果只用于去重");
});

test("非法网址被拒", async () => {
  const { env, deps } = await makeEnv();
  const { scope, goal } = await userWithGoal(env, deps, "a@example.test");
  await assert.rejects(() => scope.sources.add(goal.id, { url: "javascript:alert(1)", org: null, tier: "L3", origin: "user" }, 1), (e) => e.status === 400);
});

test("每目标最多 20 个用户来源", async () => {
  const { env, deps } = await makeEnv();
  const { scope, goal } = await userWithGoal(env, deps, "a@example.test");
  for (let i = 0; i < 20; i += 1) await scope.sources.add(goal.id, { url: `https://jobs.example.test/${i}`, org: null, tier: "L3", origin: "user" }, i);
  await assert.rejects(() => scope.sources.add(goal.id, { url: "https://jobs.example.test/x", org: null, tier: "L3", origin: "user" }, 99), (e) => e.status === 400 && /最多添加 20 个来源/.test(e.message));
  await scope.sources.add(goal.id, { url: "https://found.example.test/x", org: null, tier: "L2", origin: "search" }, 100);
});

test("A 不能删除或提名 B 的来源", async () => {
  const { env, deps } = await makeEnv();
  const a = await userWithGoal(env, deps, "a@example.test");
  const b = await userWithGoal(env, deps, "b@example.test");
  const source = await b.scope.sources.add(b.goal.id, { url: "https://jobs.example.test/b", org: null, tier: "L3", origin: "user" }, 1);
  assert.equal(await a.scope.sources.remove(b.goal.id, source.id), false);
  assert.equal(await a.scope.sources.nominate(b.goal.id, source.id, 2), false);
  assert.equal((await b.scope.sources.list(b.goal.id)).length, 1);
  assert.deepEqual(await listNominations(env.PRIVATE_DB, "pending"), []);
});

test("提名进入审核表且不带提名人身份；批准后进入平台共享来源", async () => {
  const { env, deps } = await makeEnv();
  const { scope, goal } = await userWithGoal(env, deps, "a@example.test");
  const source = await scope.sources.add(goal.id, { url: "https://careers.example.test/", org: "示例公司", tier: "L3", origin: "user" }, 1);
  assert.equal(await scope.sources.nominate(goal.id, source.id, 2), true);
  const [nomination] = await listNominations(env.PRIVATE_DB, "pending");
  assert.deepEqual(Object.keys(nomination).sort(), ["createdAt", "id", "org", "url"]);
  assert.equal(nomination.url, "https://careers.example.test/");
  assert.equal(await decideNomination(env.PRIVATE_DB, nomination.id, "approved", 3), true);
  assert.deepEqual((await listPlatformSources(env.PRIVATE_DB)).map((s) => s.url), ["https://careers.example.test/"]);
  assert.equal(await decideNomination(env.PRIVATE_DB, nomination.id, "rejected", 4), false, "已处理的提名不能再处理");
});

test("聚合平台链接不能提名", async () => {
  const { env, deps } = await makeEnv();
  const { scope, goal } = await userWithGoal(env, deps, "a@example.test");
  const source = await scope.sources.add(goal.id, { url: "https://www.zhipin.com/job/1", org: null, tier: "L4", origin: "user" }, 1);
  assert.equal(await scope.sources.nominate(goal.id, source.id, 2), false);
});

test("isAggregator 识别子域，不误伤相似域名", () => {
  assert.ok(AGGREGATOR_DOMAINS.includes("nowcoder.com"));
  assert.equal(isAggregator("https://m.zhipin.com/job/1"), true);
  assert.equal(isAggregator("https://www.linkedin.com/jobs/1"), true);
  assert.equal(isAggregator("https://notzhipin.com/"), false);
  assert.equal(isAggregator("https://careers.example.test/"), false);
});

test("searchPublicOpportunities 只返回已发布、按词匹配，带截止与真实性字段", async () => {
  const path = tempDbPath();
  const w = createSqliteD1({ path });
  await w.exec("CREATE TABLE opportunities (id TEXT PRIMARY KEY, name TEXT, org TEXT, kind TEXT, location TEXT, deadline TEXT, url TEXT, published INTEGER, tags_json TEXT, deadline_status TEXT, deadline_at TEXT, authenticity_state TEXT);");
  const rows = [
    ["o1", "用户研究校招", "示例公司", "校招", "北京", "待定", "https://a.example.test/1", 1, "[]", "unknown", null, "trusted"],
    ["o2", "算法实习", "示例实验室", "实习", "上海", "2026-12-01", "https://a.example.test/2", 1, '["用户研究"]', "confirmed", "2026-12-01", "unverified"],
    ["o3", "用户研究（未发布）", "x", "校招", "北京", "", "https://a.example.test/3", 0, "[]", "unknown", null, "trusted"],
  ];
  for (const r of rows) await w.prepare("INSERT INTO opportunities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(...r).run();
  const db = createSqliteD1({ readonly: true, path });
  const found = await searchPublicOpportunities(db, ["用户研究", "  "], 50);
  assert.deepEqual(found.map((o) => o.id).sort(), ["o1", "o2"]);
  const o2 = found.find((o) => o.id === "o2");
  assert.equal(o2.deadlineStatus, "confirmed");
  assert.equal(o2.deadlineAt, "2026-12-01");
  assert.equal(o2.authenticityState, "unverified");
  assert.deepEqual(await searchPublicOpportunities(db, [], 50), []);
});
