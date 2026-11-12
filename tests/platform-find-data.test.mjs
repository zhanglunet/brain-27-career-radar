import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { USER_TABLES } from "../platform/data/tables.ts";
import { forUser } from "../platform/data/scoped.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";

const NEW_TABLES = ["user_opportunities", "find_runs", "goal_sources"];

async function seedGoalData(db, userId, goalId, tag) {
  await db.prepare("INSERT INTO goal_sources (id, user_id, goal_id, url, tier, origin, created_at) VALUES (?, ?, ?, ?, 'L3', 'user', 1)").bind(`s-${tag}`, userId, goalId, `https://jobs.example.test/${tag}`).run();
  await db.prepare("INSERT INTO find_runs (id, user_id, goal_id, trigger, status, created_at) VALUES (?, ?, ?, 'manual', 'done', 1)").bind(`r-${tag}`, userId, goalId).run();
  await db.prepare("INSERT INTO user_opportunities (id, user_id, goal_id, key, title, url, tier, deadline_status, first_seen_at, updated_at) VALUES (?, ?, ?, ?, 't', 'https://jobs.example.test/x', 'L2', 'unknown', 1, 1)").bind(`o-${tag}`, userId, goalId, `k-${tag}`).run();
}

async function countFor(db, table, column, value) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(value).first()).n;
}

test("新表都登记在 USER_TABLES 且排在 goals 之前", () => {
  for (const table of NEW_TABLES) {
    assert.ok(USER_TABLES.includes(table), table);
    assert.ok(USER_TABLES.indexOf(table) < USER_TABLES.indexOf("goals"), table);
  }
});

test("删除目标级联删除其来源、运行与机会，不动其他目标", async () => {
  const { env, deps } = await makeEnv();
  const c = await activeUser(env, deps, "a@example.test");
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await c.post("/goals", { title: "一", description: "d" });
  await c.post("/goals", { title: "二", description: "d" });
  const [g1, g2] = await forUser(env.PRIVATE_DB, c.user.id).goals.list();
  await seedGoalData(env.PRIVATE_DB, c.user.id, g1.id, "1");
  await seedGoalData(env.PRIVATE_DB, c.user.id, g2.id, "2");
  assert.equal((await c.post(`/goals/${g1.id}/delete`)).status, 303);
  for (const table of NEW_TABLES) {
    assert.equal(await countFor(env.PRIVATE_DB, table, "goal_id", g1.id), 0, table);
    assert.equal(await countFor(env.PRIVATE_DB, table, "goal_id", g2.id), 1, table);
  }
});

test("删除账号后新表无残留", async () => {
  const { env, deps } = await makeEnv();
  const c = await activeUser(env, deps, "a@example.test");
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await c.post("/goals", { title: "一", description: "d" });
  const [goal] = await forUser(env.PRIVATE_DB, c.user.id).goals.list();
  await seedGoalData(env.PRIVATE_DB, c.user.id, goal.id, "x");
  await env.PRIVATE_DB.prepare("UPDATE llm_usage SET searches = 3 WHERE user_id = ?").bind(c.user.id).run();
  assert.equal((await c.post("/account/delete", { password: "password-123" })).status, 303);
  for (const table of NEW_TABLES) assert.equal(await countFor(env.PRIVATE_DB, table, "user_id", c.user.id), 0, table);
});

test("平台级表不含用户 ID 列", async () => {
  const { env } = await makeEnv();
  for (const table of ["page_cache", "robots_cache", "platform_sources", "source_nominations"]) {
    const columns = (await env.PRIVATE_DB.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name);
    assert.ok(columns.length > 0, `${table} 应存在`);
    assert.ok(!columns.some((c) => c === "user_id" || c.endsWith("_user_id")), table);
  }
});

test("llm_usage 有 searches 列，默认 0", async () => {
  const { env } = await makeEnv();
  const columns = (await env.PRIVATE_DB.prepare("PRAGMA table_info(llm_usage)").all()).results;
  const searches = columns.find((c) => c.name === "searches");
  assert.ok(searches);
  assert.equal(searches.dflt_value, "0");
});
