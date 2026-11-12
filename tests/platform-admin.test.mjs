import assert from "node:assert/strict";
import test from "node:test";
import { activeUser, client, makeEnv } from "./helpers/platform-client.mjs";
import { createUser, findUserByEmail } from "../platform/data/accounts.ts";
import { hashPassword } from "../platform/crypto.ts";

async function pendingUser(env, deps, email) {
  return createUser(env.PRIVATE_DB, { email, passwordHash: await hashPassword("password-123"), role: "user", status: "pending" }, deps.now());
}

test("未登录访问 /admin 跳转登录，普通用户 403", async () => {
  const { env, deps } = await makeEnv();
  const anon = await client(env, deps).get("/admin");
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.get("location"), "/login");
  const user = await activeUser(env, deps, "u@example.test");
  assert.equal((await user.get("/admin")).status, 403);
  assert.equal((await user.post("/admin/invites")).status, 403);
});

test("生成邀请码：页面展示一次明文，可用于注册", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const response = await admin.post("/admin/invites");
  assert.equal(response.status, 200);
  const code = (await response.text()).match(/<code data-invite>([A-Za-z0-9_-]+)<\/code>/)?.[1];
  assert.ok(code);
  assert.doesNotMatch(await (await admin.get("/admin")).text(), new RegExp(code));
  const registered = await client(env, deps).post("/register", { invite: code, email: "new@example.test", password: "password-123" });
  assert.equal(registered.status, 200);
});

test("审批后用户可登录", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const pending = await pendingUser(env, deps, "p@example.test");
  assert.match(await (await admin.get("/admin")).text(), /p@example\.test/);
  assert.equal((await admin.post(`/admin/users/${pending.id}/approve`)).status, 303);
  assert.equal((await client(env, deps).post("/login", { email: "p@example.test", password: "password-123" })).status, 303);
});

test("停用用户后其现有会话立即失效；重新启用后可再登录", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const user = await activeUser(env, deps, "u@example.test");
  await user.post("/consent", { agree: "yes" });
  assert.equal((await user.get("/")).status, 200);
  assert.equal((await admin.post(`/admin/users/${user.user.id}/disable`)).status, 303);
  const after = await user.get("/");
  assert.equal(after.status, 303);
  assert.equal(after.headers.get("location"), "/login");
  assert.equal((await client(env, deps).post("/login", { email: "u@example.test", password: "password-123" })).status, 403);
  assert.equal((await admin.post(`/admin/users/${user.user.id}/enable`)).status, 303);
  assert.equal((await client(env, deps).post("/login", { email: "u@example.test", password: "password-123" })).status, 303);
});

test("唯一管理员不能停用自己", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const response = await admin.post(`/admin/users/${admin.user.id}/disable`);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /不能停用唯一的管理员/);
  assert.equal((await findUserByEmail(env.PRIVATE_DB, "admin@example.test")).status, "active");
});

test("对不存在的用户操作返回 404", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  assert.equal((await admin.post("/admin/users/00000000-0000-0000-0000-000000000000/approve")).status, 404);
});

test("管理页面不含用户目标内容", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const user = await activeUser(env, deps, "u@example.test");
  await user.post("/consent", { agree: "yes" });
  await user.post("/goals", { title: "私人目标-机密", description: "不应被管理员看到" });
  const page = await (await admin.get("/admin")).text();
  assert.match(page, /u@example\.test/);
  assert.doesNotMatch(page, /私人目标-机密/);
  assert.doesNotMatch(page, /不应被管理员看到/);
});

test("重置链接页面只显示一次明文，链接可用", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const user = await activeUser(env, deps, "u@example.test");
  const response = await admin.post(`/admin/users/${user.user.id}/reset-link`);
  assert.equal(response.status, 200);
  const link = (await response.text()).match(/https:\/\/platform\.test\/reset#([A-Za-z0-9_-]+)/);
  assert.ok(link);
  assert.doesNotMatch(await (await admin.get("/admin")).text(), new RegExp(link[1]));
  assert.equal((await client(env, deps).post("/reset", { token: link[1], password: "brand-new-pass" })).status, 303);
});

test("管理操作写入审计", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const pending = await pendingUser(env, deps, "p@example.test");
  await admin.post(`/admin/users/${pending.id}/approve`);
  await admin.post("/admin/invites");
  const { results } = await env.PRIVATE_DB.prepare("SELECT action, actor_user_id, target_user_id FROM audit_log ORDER BY at").all();
  const actions = results.map((row) => row.action);
  assert.ok(actions.includes("admin.approve"));
  assert.ok(actions.includes("admin.invite"));
  assert.ok(results.every((row) => !String(row.target_user_id ?? "").includes("@")));
});
