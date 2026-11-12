import assert from "node:assert/strict";
import test from "node:test";
import { approve, client, inviteCode, makeEnv } from "./helpers/platform-client.mjs";
import { handleRequest } from "../platform/app.ts";
import { createResetToken, findUserByEmail } from "../platform/data/accounts.ts";

const PASSWORD = "password-123";

async function register(c, invite, email, password = PASSWORD) {
  return c.post("/register", { invite, email, password });
}

test("首个管理员只能经 bootstrap 建立一次", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  assert.equal((await c.get("/setup")).status, 200);
  assert.equal((await c.post("/setup", { token: "wrong", email: "admin@example.test", password: "adminpass1" })).status, 403);
  const created = await c.post("/setup", { token: "test-bootstrap", email: "admin@example.test", password: "adminpass1" });
  assert.equal(created.status, 303);
  assert.ok(c.jar.session, "建立管理员后应已登录");
  const admin = await findUserByEmail(env.PRIVATE_DB, "admin@example.test");
  assert.equal(admin.role, "admin");
  assert.equal(admin.status, "active");
  const other = client(env, deps);
  assert.equal((await other.get("/setup")).status, 404);
  assert.equal((await other.post("/setup", { token: "test-bootstrap", email: "x@example.test", password: "adminpass1" })).status, 404);
});

test("未设置 bootstrap 口令时 /setup 不存在", async () => {
  const { env, deps } = await makeEnv({ ADMIN_BOOTSTRAP_TOKEN: undefined });
  assert.equal((await client(env, deps).get("/setup")).status, 404);
});

test("注册→待审批→不能登录→审批后可登录", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  const response = await register(c, await inviteCode(env, deps), "new@example.test");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /等待管理员审批/);
  const pending = await c.post("/login", { email: "new@example.test", password: PASSWORD });
  assert.equal(pending.status, 403);
  assert.match(await pending.text(), /账号等待审批/);
  assert.equal(c.jar.session, undefined);
  await approve(env, deps, "new@example.test");
  const ok = await c.post("/login", { email: "new@example.test", password: PASSWORD });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/");
  assert.ok(c.jar.session);
});

test("大小写不同的同一邮箱不能重复注册，且不消耗邀请码", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  await register(c, await inviteCode(env, deps), " A@Example.test ");
  const second = await inviteCode(env, deps);
  const duplicate = await register(c, second, "a@example.test");
  assert.equal(duplicate.status, 409);
  assert.match(await duplicate.text(), /该邮箱已注册/);
  const third = await register(c, second, "b@example.test");
  assert.equal(third.status, 200, "第二个邀请码应仍可用");
});

test("邀请码用过后或无效时注册失败，且不留下账号", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  const code = await inviteCode(env, deps);
  await register(c, code, "first@example.test");
  const reused = await register(c, code, "second@example.test");
  assert.equal(reused.status, 400);
  assert.match(await reused.text(), /邀请码无效或已过期/);
  assert.equal(await findUserByEmail(env.PRIVATE_DB, "second@example.test"), null);
  const bogus = await register(c, "bogus", "third@example.test");
  assert.equal(bogus.status, 400);
});

test("注册校验邮箱与密码长度", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  assert.equal((await register(c, await inviteCode(env, deps), "no-at-sign", PASSWORD)).status, 400);
  assert.equal((await register(c, await inviteCode(env, deps), "short@example.test", "1234567")).status, 400);
  assert.equal((await register(c, await inviteCode(env, deps), "long@example.test", "x".repeat(257))).status, 400);
  assert.equal(await findUserByEmail(env.PRIVATE_DB, "short@example.test"), null);
});

test("邮箱不存在与密码错误提示一致", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  await register(c, await inviteCode(env, deps), "known@example.test");
  await approve(env, deps, "known@example.test");
  const wrong = await c.post("/login", { email: "known@example.test", password: "wrong-password" });
  const unknown = await c.post("/login", { email: "unknown@example.test", password: "wrong-password" });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.match(await wrong.text(), /邮箱或密码错误/);
  assert.match(await unknown.text(), /邮箱或密码错误/);
});

test("连续 5 次密码错误后锁定，即使密码正确也拒绝；15 分钟后恢复", async () => {
  const { env, deps, clock } = await makeEnv();
  const c = client(env, deps);
  await register(c, await inviteCode(env, deps), "lock@example.test");
  await approve(env, deps, "lock@example.test");
  for (let i = 0; i < 5; i += 1) await c.post("/login", { email: "lock@example.test", password: "wrong-password" });
  const locked = await c.post("/login", { email: "LOCK@example.test", password: PASSWORD });
  assert.equal(locked.status, 429);
  assert.match(await locked.text(), /尝试次数过多/);
  clock.advance(15 * 60_000 + 1);
  assert.equal((await c.post("/login", { email: "lock@example.test", password: PASSWORD })).status, 303);
});

test("错误 Host 404、缺 Origin 的 POST 403", async () => {
  const { env, deps } = await makeEnv();
  assert.equal((await handleRequest(new Request("https://x.workers.dev/login"), env, deps)).status, 404);
  assert.equal((await handleRequest(new Request("https://platform.test/login", { method: "POST" }), env, deps)).status, 403);
  const foreign = new Request("https://platform.test/login", { method: "POST", headers: { origin: "https://evil.test" } });
  assert.equal((await handleRequest(foreign, env, deps)).status, 403);
});

test("每个响应都带安全头，robots.txt 禁止抓取，未知路径 404", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  for (const path of ["/login", "/register", "/robots.txt", "/nope"]) {
    const response = await c.get(path);
    assert.equal(response.headers.get("cache-control"), "private, no-store", path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path);
  }
  assert.equal(await (await c.get("/robots.txt")).text(), "User-agent: *\nDisallow: /\n");
  assert.equal((await c.get("/nope")).status, 404);
  assert.equal((await c.get("/sitemap.xml")).status, 404);
});

test("退出登录撤销会话", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  await register(c, await inviteCode(env, deps), "out@example.test");
  await approve(env, deps, "out@example.test");
  await c.post("/login", { email: "out@example.test", password: PASSWORD });
  const token = c.jar.session;
  const response = await c.post("/logout");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
  assert.equal(c.jar.session, undefined);
  const replay = await handleRequest(new Request("https://platform.test/", { headers: { cookie: `__Host-session=${token}` } }), env, deps);
  assert.equal(replay.status, 303);
  assert.equal(replay.headers.get("location"), "/login");
});

test("重置链接一次有效且会撤销旧会话", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  await register(c, await inviteCode(env, deps), "reset@example.test");
  await approve(env, deps, "reset@example.test");
  await c.post("/login", { email: "reset@example.test", password: PASSWORD });
  const oldToken = c.jar.session;
  const user = await findUserByEmail(env.PRIVATE_DB, "reset@example.test");
  const token = await createResetToken(env.PRIVATE_DB, user.id, "admin", deps.now());
  const anon = client(env, deps);
  assert.equal((await anon.get(`/reset/${token}`)).status, 200);
  const done = await anon.post(`/reset/${token}`, { password: "new-password-456" });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get("location"), "/login");
  const again = await anon.post(`/reset/${token}`, { password: "another-pass-789" });
  assert.equal(again.status, 400);
  const replay = await handleRequest(new Request("https://platform.test/", { headers: { cookie: `__Host-session=${oldToken}` } }), env, deps);
  assert.equal(replay.headers.get("location"), "/login");
  assert.equal((await anon.post("/login", { email: "reset@example.test", password: "new-password-456" })).status, 303);
});

test("超大请求体返回 413 且不建账号", async () => {
  const { env, deps } = await makeEnv();
  const c = client(env, deps);
  const response = await c.post("/register", { invite: await inviteCode(env, deps), email: "big@example.test", password: PASSWORD, pad: "x".repeat(70_000) });
  assert.equal(response.status, 413);
  assert.equal(await findUserByEmail(env.PRIVATE_DB, "big@example.test"), null);
});
