import assert from "node:assert/strict";
import test from "node:test";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { handleRequest } from "../platform/app.ts";
import { forUser } from "../platform/data/scoped.ts";
import { findUserByEmail } from "../platform/data/accounts.ts";

async function consentedUser(env, deps, email, options) {
  const c = await activeUser(env, deps, email, options);
  const response = await c.post("/consent", { agree: "yes" });
  assert.equal(response.status, 303);
  return c;
}

async function goalIds(env, user) {
  return (await forUser(env.PRIVATE_DB, user.id).goals.list()).map((goal) => goal.id);
}

test("未同意条款不能进入首页；同意页列出条款；同意后可进入", async () => {
  const { env, deps } = await makeEnv();
  const c = await activeUser(env, deps, "a@example.test");
  const home = await c.get("/");
  assert.equal(home.status, 303);
  assert.equal(home.headers.get("location"), "/consent");
  const page = await (await c.get("/consent")).text();
  assert.match(page, /DeepSeek/);
  assert.match(page, /不是端到端加密/);
  assert.equal((await c.post("/consent", {})).status, 400, "未勾选同意不记录");
  assert.equal((await c.get("/")).status, 303);
  assert.equal((await c.post("/consent", { agree: "yes" })).headers.get("location"), "/");
  assert.equal((await c.get("/")).status, 200);
});

test("未同意条款不能创建目标", async () => {
  const { env, deps } = await makeEnv();
  const c = await activeUser(env, deps, "a@example.test");
  const response = await c.post("/goals", { title: "t", description: "d" });
  assert.equal(response.headers.get("location"), "/consent");
  assert.deepEqual(await goalIds(env, c.user), []);
});

test("创建目标后出现在首页", async () => {
  const { env, deps } = await makeEnv();
  const c = await consentedUser(env, deps, "a@example.test");
  const created = await c.post("/goals", { title: "国内校招", description: "互联网产品经理，北京上海" });
  assert.equal(created.status, 303);
  const page = await (await c.get("/")).text();
  assert.match(page, /国内校招/);
  assert.match(page, /互联网产品经理，北京上海/);
});

test("A 不能删除 B 的目标，且 B 的目标不出现在 A 的页面", async () => {
  const { env, deps } = await makeEnv();
  const a = await consentedUser(env, deps, "a@example.test");
  const b = await consentedUser(env, deps, "b@example.test");
  await b.post("/goals", { title: "B 的专属目标", description: "仅 B 可见" });
  const [bGoal] = await goalIds(env, b.user);
  assert.doesNotMatch(await (await a.get("/")).text(), /B 的专属目标/);
  assert.equal((await a.post(`/goals/${bGoal}/delete`)).status, 404);
  assert.deepEqual(await goalIds(env, b.user), [bGoal]);
  assert.equal((await b.post(`/goals/${bGoal}/delete`)).status, 303);
  assert.deepEqual(await goalIds(env, b.user), []);
});

test("标题与描述长度校验，超长被拒且不写库", async () => {
  const { env, deps } = await makeEnv();
  const c = await consentedUser(env, deps, "a@example.test");
  assert.equal((await c.post("/goals", { title: "t", description: "字".repeat(4001) })).status, 400);
  assert.equal((await c.post("/goals", { title: "字".repeat(101), description: "d" })).status, 400);
  assert.equal((await c.post("/goals", { title: "  ", description: "d" })).status, 400);
  assert.equal((await c.post("/goals", { title: "t", description: "" })).status, 400);
  assert.deepEqual(await goalIds(env, c.user), []);
  assert.equal((await c.post("/goals", { title: "字".repeat(100), description: "字".repeat(4000) })).status, 303);
});

test("目标标题中的 HTML 被转义", async () => {
  const { env, deps } = await makeEnv();
  const c = await consentedUser(env, deps, "a@example.test");
  await c.post("/goals", { title: "<script>x</script>", description: "<img src=x onerror=y>" });
  const page = await (await c.get("/")).text();
  assert.match(page, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(page, /<script>x/);
  assert.doesNotMatch(page, /<img src=x/);
});

test("账号页可访问；导出只含本人数据且无密码哈希与令牌", async () => {
  const { env, deps } = await makeEnv();
  const a = await consentedUser(env, deps, "a@example.test");
  const b = await consentedUser(env, deps, "b@example.test");
  await a.post("/goals", { title: "A 目标", description: "a" });
  await b.post("/goals", { title: "B 目标", description: "b" });
  assert.equal((await a.get("/account")).status, 200);
  const response = await a.get("/account/export");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment/);
  const raw = await response.text();
  const data = JSON.parse(raw);
  assert.equal(data.user.email, "a@example.test");
  assert.deepEqual(data.goals.map((goal) => goal.title), ["A 目标"]);
  assert.ok(!raw.includes("B 目标"));
  assert.ok(!raw.includes("b@example.test"));
  assert.ok(!raw.includes("pbkdf2"));
  assert.ok(!raw.includes(a.jar.session));
});

test("删除账号需要正确密码", async () => {
  const { env, deps } = await makeEnv();
  const a = await consentedUser(env, deps, "a@example.test");
  assert.equal((await a.post("/account/delete", { password: "wrong-password" })).status, 400);
  assert.ok(await findUserByEmail(env.PRIVATE_DB, "a@example.test"));
});

test("删除账号后旧会话失效、数据清空、他人不受影响", async () => {
  const { env, deps } = await makeEnv();
  const a = await consentedUser(env, deps, "a@example.test");
  const b = await consentedUser(env, deps, "b@example.test");
  await a.post("/goals", { title: "A 目标", description: "a" });
  await b.post("/goals", { title: "B 目标", description: "b" });
  const token = a.jar.session;
  const userId = a.user.id;
  const response = await a.post("/account/delete", { password: "password-123" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
  assert.equal(await findUserByEmail(env.PRIVATE_DB, "a@example.test"), null);
  assert.deepEqual(await goalIds(env, { id: userId }), []);
  const replay = await handleRequest(new Request("https://platform.test/", { headers: { cookie: `__Host-session=${token}` } }), env, deps);
  assert.equal(replay.headers.get("location"), "/login");
  assert.equal((await goalIds(env, b.user)).length, 1);
  assert.equal((await b.get("/")).status, 200);
});

test("唯一管理员不能删除自己；有第二个管理员时可以", async () => {
  const { env, deps } = await makeEnv();
  const admin = await consentedUser(env, deps, "admin@example.test", { role: "admin" });
  const refused = await admin.post("/account/delete", { password: "password-123" });
  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /不能删除唯一的管理员账号/);
  await consentedUser(env, deps, "admin2@example.test", { role: "admin" });
  assert.equal((await admin.post("/account/delete", { password: "password-123" })).status, 303);
});
