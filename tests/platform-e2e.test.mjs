/** 端到端：经 Worker 入口驱动完整流程，验证两个用户之间的隔离。 */
import assert from "node:assert/strict";
import test from "node:test";
import worker from "../platform/worker.ts";
import { client, makeEnv } from "./helpers/platform-client.mjs";
import { forUser } from "../platform/data/scoped.ts";
import { findUserByEmail } from "../platform/data/accounts.ts";

const fetchHandler = (request, env) => worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });

async function setup() {
  const { env, deps } = await makeEnv();
  const viaWorker = (c = client(env, deps, { fetchHandler })) => c;
  const admin = viaWorker();
  assert.equal((await admin.post("/setup", { token: "test-bootstrap", email: "admin@example.test", password: "admin-pass-1" })).status, 303);
  await admin.post("/consent", { agree: "yes" });
  const users = {};
  for (const name of ["a", "b"]) {
    const invite = (await (await admin.post("/admin/invites")).text()).match(/<code data-invite>([^<]+)<\/code>/)[1];
    const c = viaWorker();
    assert.equal((await c.post("/register", { invite, email: `${name}@example.test`, password: `${name}-password-1` })).status, 200);
    const record = await findUserByEmail(env.PRIVATE_DB, `${name}@example.test`);
    assert.equal((await admin.post(`/admin/users/${record.id}/approve`)).status, 303);
    assert.equal((await c.post("/login", { email: `${name}@example.test`, password: `${name}-password-1` })).status, 303);
    assert.equal((await c.post("/consent", { agree: "yes" })).status, 303);
    assert.equal((await c.post("/goals", { title: `${name.toUpperCase()} 的目标`, description: `${name} 的意向描述` })).status, 303);
    users[name] = { client: c, id: record.id };
  }
  return { env, deps, admin, users, anon: viaWorker() };
}

test("两个用户全流程隔离", async () => {
  const { env, admin, users } = await setup();
  const { a, b } = users;
  const aHome = await (await a.client.get("/")).text();
  const bHome = await (await b.client.get("/")).text();
  assert.match(aHome, /A 的目标/);
  assert.doesNotMatch(aHome, /B 的目标|b 的意向描述/);
  assert.match(bHome, /B 的目标/);
  assert.doesNotMatch(bHome, /A 的目标|a 的意向描述/);

  const aExport = await (await a.client.get("/account/export")).text();
  assert.doesNotMatch(aExport, /b@example\.test|B 的目标/);
  const bExport = await (await b.client.get("/account/export")).text();
  assert.doesNotMatch(bExport, /a@example\.test|A 的目标/);

  const [bGoal] = await forUser(env.PRIVATE_DB, b.id).goals.list();
  assert.equal((await a.client.post(`/goals/${bGoal.id}/delete`)).status, 404);
  assert.equal((await forUser(env.PRIVATE_DB, b.id).goals.list()).length, 1);

  assert.equal((await admin.post(`/admin/users/${b.id}/disable`)).status, 303);
  const bAfter = await b.client.get("/");
  assert.equal(bAfter.status, 303);
  assert.equal(bAfter.headers.get("location"), "/login");
  assert.equal((await a.client.get("/")).status, 200);
});

test("未登录访问所有私有路由都跳转登录或被拒", async () => {
  const { anon } = await setup();
  for (const path of ["/", "/account", "/account/export", "/admin", "/consent"]) {
    const response = await anon.get(path);
    assert.equal(response.status, 303, path);
    assert.equal(response.headers.get("location"), "/login", path);
  }
  for (const path of ["/goals", "/account/delete", "/admin/invites", "/consent"]) {
    const response = await anon.post(path, {});
    assert.ok([303, 403].includes(response.status), path);
    if (response.status === 303) assert.equal(response.headers.get("location"), "/login", path);
  }
});

test("经 Worker 入口的所有响应都带 private, no-store；错误 Host 被拒", async () => {
  const { env, users } = await setup();
  for (const path of ["/", "/account", "/account/export", "/login", "/robots.txt", "/missing"]) {
    const response = await users.a.client.get(path);
    assert.equal(response.headers.get("cache-control"), "private, no-store", path);
  }
  const foreign = await fetchHandler(new Request("https://job-agent-platform.someone.workers.dev/"), env);
  assert.equal(foreign.status, 404);
});
