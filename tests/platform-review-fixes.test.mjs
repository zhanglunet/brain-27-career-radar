/** 整分支审查发现的问题：每条先复现，再修复。 */
import assert from "node:assert/strict";
import test from "node:test";
import { activeUser, client, inviteCode, makeEnv } from "./helpers/platform-client.mjs";
import { createResetToken, createUser, findUserByEmail } from "../platform/data/accounts.ts";
import { hashPassword, verifyPassword } from "../platform/crypto.ts";
import { forUser } from "../platform/data/scoped.ts";

// ── Important 1：不持有有效邀请码时，不能探测邮箱是否已注册 ──
test("已注册邮箱配合无效邀请码，与未注册邮箱得到完全相同的响应", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  await c.post("/register", { invite: await inviteCode(env, deps), email: "victim@example.test", password: "password-123" });
  const known = await c.post("/register", { invite: "bogus", email: "Victim@Example.test", password: "password-123" });
  const unknown = await c.post("/register", { invite: "bogus", email: "nobody@example.test", password: "password-123" });
  assert.equal(known.status, unknown.status);
  assert.equal(known.status, 400);
  assert.equal(await known.text(), await unknown.text());
});

test("无效邀请码的注册请求不建任何账号", async () => {
  const { env, deps } = await makeEnv();
  await client(env, deps).post("/register", { invite: "bogus", email: "x@example.test", password: "password-123" });
  assert.equal(await findUserByEmail(env.PRIVATE_DB, "x@example.test"), null);
});

// ── Important 2：重置令牌不出现在 URL 路径中（URL 会进 Workers 调用日志） ──
test("管理员生成的重置链接把令牌放在 # 片段里，不在路径中", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const user = await activeUser(env, deps, "u@example.test");
  const page = await (await admin.post(`/admin/users/${user.user.id}/reset-link`)).text();
  assert.match(page, /https:\/\/platform\.test\/reset#[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(page, /\/reset\/[A-Za-z0-9_-]{20,}/);
});

test("令牌经 POST 表单字段提交即可重置；旧的路径形式不再存在", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "u@example.test");
  const token = await createResetToken(env.PRIVATE_DB, user.user.id, "admin", deps.now());
  const anon = client(env, deps);
  const form = await anon.get("/reset");
  assert.equal(form.status, 200);
  assert.match(await form.text(), /name="token"/);
  assert.equal((await anon.get(`/reset/${token}`)).status, 404);
  assert.equal((await anon.post("/reset", { token, password: "brand-new-pass" })).status, 303);
  assert.equal((await anon.post("/login", { email: "u@example.test", password: "brand-new-pass" })).status, 303);
});

// ── Important 3：迭代次数可从存储值读取（≤ 100000），以后调参不让旧密码全部失效 ──
test("可校验迭代次数较低的旧哈希，拒绝超过 100000 次的哈希", async () => {
  const stored = await hashPassword("old-password");
  const [, , salt] = stored.split("$");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("old-password"), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(salt, "base64url"), iterations: 1000 }, key, 256,
  ));
  const legacy = `pbkdf2$1000$${salt}$${Buffer.from(bits).toString("base64url")}`;
  assert.equal(await verifyPassword("old-password", legacy), true);
  assert.equal(await verifyPassword("wrong", legacy), false);
  assert.equal(await verifyPassword("old-password", legacy.replace("$1000$", "$200000$")), false);
  assert.equal(await verifyPassword("old-password", legacy.replace("$1000$", "$0$")), false);
});

// ── Important 4：管理员可删除账号（含拒绝待审批注册） ──
test("管理员可删除待审批用户，邮箱随即可重新注册", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const pending = await createUser(env.PRIVATE_DB, { email: "p@example.test", passwordHash: "x", role: "user", status: "pending" }, deps.now());
  assert.match(await (await admin.get("/admin")).text(), new RegExp(`/admin/users/${pending.id}/delete`));
  assert.equal((await admin.post(`/admin/users/${pending.id}/delete`)).status, 303);
  assert.equal(await findUserByEmail(env.PRIVATE_DB, "p@example.test"), null);
  const again = await client(env, deps).post("/register", { invite: await inviteCode(env, deps), email: "p@example.test", password: "password-123" });
  assert.equal(again.status, 200);
});

test("管理员删除用户会清空其数据并使会话失效", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const user = await activeUser(env, deps, "u@example.test");
  await user.post("/consent", { agree: "yes" });
  await user.post("/goals", { title: "t", description: "d" });
  assert.equal((await admin.post(`/admin/users/${user.user.id}/delete`)).status, 303);
  assert.deepEqual(await forUser(env.PRIVATE_DB, user.user.id).goals.list(), []);
  assert.equal((await user.get("/")).headers.get("location"), "/login");
  const { results } = await env.PRIVATE_DB.prepare("SELECT action FROM audit_log WHERE action = 'admin.delete'").all();
  assert.equal(results.length, 1);
});

test("管理员不能在后台删除自己（走账号页）", async () => {
  const { env, deps } = await makeEnv();
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  await activeUser(env, deps, "admin2@example.test", { role: "admin" });
  assert.equal((await admin.post(`/admin/users/${admin.user.id}/delete`)).status, 400);
  assert.ok(await findUserByEmail(env.PRIVATE_DB, "admin@example.test"));
});
