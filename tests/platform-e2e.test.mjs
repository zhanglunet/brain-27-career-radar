/** 端到端：经 Worker 入口驱动完整流程，验证两个用户之间的隔离。 */
import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
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
  await admin.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  const users = {};
  for (const name of ["a", "b"]) {
    const invite = (await (await admin.post("/admin/invites")).text()).match(/<code data-invite>([^<]+)<\/code>/)[1];
    const c = viaWorker();
    assert.equal((await c.post("/register", { invite, email: `${name}@example.test`, password: `${name}-password-1` })).status, 200);
    const record = await findUserByEmail(env.PRIVATE_DB, `${name}@example.test`);
    assert.equal((await admin.post(`/admin/users/${record.id}/approve`)).status, 303);
    assert.equal((await c.post("/login", { email: `${name}@example.test`, password: `${name}-password-1` })).status, 303);
    assert.equal((await c.post("/consent", { agree: "yes", version: CONSENT_VERSION })).status, 303);
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

test("两个用户的简历与档案互相隔离（经 Worker 入口与真实 DeepSeek 调用路径）", async (t) => {
  const { deepSeekReply } = await import("./helpers/fake-llm.mjs");
  const outbound = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    outbound.push(String(url));
    const body = JSON.parse(init.body);
    const isA = body.messages[1].content.includes("甲的简历");
    return deepSeekReply(JSON.stringify({ profile: { basics: { name: isA ? "甲（示例）" : "乙（示例）" }, skills: [isA ? "甲技能" : "乙技能"] }, target: {} }));
  });
  const { env, users } = await setup();
  const { a, b } = users;
  const pdf = (text) => ({ name: `${text}.pdf`, type: "application/pdf", bytes: new TextEncoder().encode(`%PDF-1.7 ${text}`) });
  for (const [user, text] of [[a, "甲的简历"], [b, "乙的简历"]]) {
    assert.equal((await user.client.upload("/resume", "resume", pdf(text))).status, 303);
    const [resume] = await forUser(env.PRIVATE_DB, user.id).resumes.list();
    const draft = await user.client.post("/profile/draft", { resumeId: resume.id });
    assert.equal(draft.status, 303);
    const id = draft.headers.get("location").split("/").pop();
    const page = await (await user.client.get(`/profile/drafts/${id}`)).text();
    const name = page.match(/name="name" value="([^"]*)"/)[1];
    assert.equal((await user.client.post(`/profile/drafts/${id}/confirm`, { name, skills: text.startsWith("甲") ? "甲技能" : "乙技能" })).status, 303);
  }
  assert.ok(outbound.every((url) => url === "https://api.deepseek.com/chat/completions"));
  const aProfile = await (await a.client.get("/profile")).text();
  assert.match(aProfile, /甲（示例）/);
  assert.doesNotMatch(aProfile, /乙（示例）|乙的简历|乙技能/);
  const aExport = await (await a.client.get("/account/export")).text();
  assert.doesNotMatch(aExport, /乙（示例）|乙的简历|乙技能/);
  const [bResume] = await forUser(env.PRIVATE_DB, b.id).resumes.list();
  assert.equal((await a.client.get(`/resume/${bResume.id}`)).status, 404);
  assert.equal((await a.client.post("/account/delete", { password: "a-password-1" })).status, 303);
  assert.ok(env.RESUMES.keys().every((key) => key.startsWith(`${b.id}/`)));
  assert.equal(env.RESUMES.keys().length, 1);
});

test("两个用户找机会互相隔离（经 Worker 的 fetch 与 queue）", async () => {
  const { findFixture, URLS } = await import("./helpers/find-fixture.mjs");
  const { activeUser } = await import("./helpers/platform-client.mjs");
  const { CONSENT_VERSION } = await import("../platform/consent.ts");
  const { normalizeProfile } = await import("../platform/profile/schema.ts");
  const f = await findFixture({ realClock: true });
  // Worker 入口不接受注入的依赖，这里用全局 fetch 替身承接网页与搜索请求，并用 deps 外的方式跑队列
  const web = f.web;
  const bochaHits = { data: { webPages: { value: [{ name: "搜索发现岗位", url: URLS.official }] } } };
  const deepseek = f.llm;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target === "https://api.bochaai.com/v1/web-search") return new Response(JSON.stringify(bochaHits), { status: 200 });
    if (target === "https://api.deepseek.com/chat/completions") {
      const { json } = await deepseek.completeJson(JSON.parse(init.body).messages);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    }
    return web(url, init);
  };
  try {
    const b = await activeUser(f.env, f.deps, "b@example.test");
    await b.post("/consent", { agree: "yes", version: CONSENT_VERSION });
    await b.post("/goals", { title: "B 的目标", description: "B 的意向" });
    const bScope = forUser(f.env.PRIVATE_DB, b.user.id);
    const [bGoal] = await bScope.goals.list();
    await bScope.goals.setTarget(bGoal.id, { kinds: ["实习"], directions: ["B方向"], cities: ["深圳"], timing: null, notes: null });
    await bScope.profile.confirm(normalizeProfile({ skills: ["B技能"] }), f.deps.now());
    await bScope.sources.add(bGoal.id, { url: "https://b-only.example.test/jobs", org: "B 专属机构", tier: "L3", origin: "user" }, f.deps.now());
    const viaWorker = (request) => worker.fetch(request, f.env, { waitUntil() {}, passThroughOnException() {} });
    const send = (c, path) => viaWorker(new Request(`https://platform.test${path}`, { method: "POST", headers: { origin: "https://platform.test", cookie: `__Host-session=${c.jar.session}`, "content-type": "application/x-www-form-urlencoded" }, body: "" }));
    assert.equal((await send(f.c, `/goals/${f.goal.id}/find`)).status, 303);
    assert.equal((await send(b, `/goals/${bGoal.id}/find`)).status, 303);
    const acked = [];
    await worker.queue({ messages: f.env.FIND_QUEUE.sent.map((body) => ({ body, ack() { acked.push(body.runId); } })) }, f.env, { waitUntil() {} });
    assert.equal(acked.length, 2);
    const aPage = await (await viaWorker(new Request(`https://platform.test/goals/${f.goal.id}`, { headers: { cookie: `__Host-session=${f.c.jar.session}` } }))).text();
    assert.match(aPage, /用户来源岗位/);
    assert.doesNotMatch(aPage, /B 专属机构|b-only\.example\.test|B 的目标/);
    assert.equal((await viaWorker(new Request(`https://platform.test/goals/${bGoal.id}`, { headers: { cookie: `__Host-session=${f.c.jar.session}` } }))).status, 404);
    const aExport = await (await viaWorker(new Request("https://platform.test/account/export", { headers: { cookie: `__Host-session=${f.c.jar.session}` } }))).text();
    assert.doesNotMatch(aExport, /B 专属机构|b-only\.example\.test|B方向/);
    assert.ok(!(await forUser(f.env.PRIVATE_DB, f.c.user.id).runs.list(f.goal.id, 10)).some((r) => r.goalId === bGoal.id));
    assert.equal((await f.c.post("/account/delete", { password: "password-123" })).status, 303);
    for (const table of ["user_opportunities", "find_runs", "goal_sources"]) {
      const n = (await f.env.PRIVATE_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(f.c.user.id).first()).n;
      assert.equal(n, 0, table);
    }
    assert.ok((await bScope.opportunities.list(bGoal.id)).length > 0, "B 的机会不受影响");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("导出包含来源、运行（含统计、不含检索词）、机会（含评估）与每日用量", async () => {
  const { findFixture } = await import("./helpers/find-fixture.mjs");
  const { startRun, executeRun } = await import("../platform/find/run.ts");
  const f = await findFixture();
  await startRun(f.env, f.deps, f.c.user, f.goal.id, "manual");
  await executeRun(f.env, f.deps, f.env.FIND_QUEUE.sent.at(-1));
  const raw = await (await f.c.get("/account/export")).text();
  const data = JSON.parse(raw);
  assert.ok(data.sources.length >= 1);
  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0].status, "done");
  assert.ok(typeof data.runs[0].stats.pagesFetched === "number");
  assert.ok(data.opportunities.some((o) => o.assessment && o.assessment.items.length));
  assert.ok(data.usage.some((u) => u.calls > 0 && typeof u.searches === "number"));
  assert.doesNotMatch(raw, /用户研究 校园招聘 官网/);
});

/** 模拟 Workers：全局 fetch 被当作对象方法调用（this 不是 undefined / globalThis）时抛 Illegal invocation。 */
function strictFetch(handler) {
  return function fetch(url, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation: function called with incorrect `this` reference");
    return handler(String(url), init);
  };
}

test("经 Worker 入口生成草稿时，全局 fetch 不会被当作对象方法调用", async () => {
  const { deepSeekReply } = await import("./helpers/fake-llm.mjs");
  const realFetch = globalThis.fetch;
  globalThis.fetch = strictFetch(() => deepSeekReply(JSON.stringify({ profile: { basics: { name: "严格（示例）" } }, target: {} })));
  try {
    const { env, deps } = await makeEnv();
    deps.now = Date.now;
    const viaWorker = (request) => worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} });
    const c = client(env, deps, { fetchHandler: viaWorker });
    const { activeUser } = await import("./helpers/platform-client.mjs");
    const u = await activeUser(env, deps, "strict@example.test");
    c.jar.session = u.jar.session;
    await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
    const response = await c.post("/profile/draft", { intent: "想找北京的校招" });
    assert.equal(response.status, 303, await response.clone().text());
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("各提供方与抓取层直接调用传入的 fetch，不以对象方法的形式调用", async () => {
  const { createDeepSeekProvider } = await import("../platform/llm/deepseek.ts");
  const { createBochaProvider } = await import("../platform/search/bocha.ts");
  const { fetchPublicPage } = await import("../platform/fetcher/page.ts");
  const { deepSeekReply } = await import("./helpers/fake-llm.mjs");
  await createDeepSeekProvider({ apiKey: "k", fetch: strictFetch(() => deepSeekReply("{}")) }).completeJson([{ role: "user", content: "x" }]);
  await createBochaProvider({ apiKey: "k", fetch: strictFetch(() => new Response(JSON.stringify({ data: {} }), { status: 200 })) }).search("q");
  const { env, deps } = await makeEnv();
  const result = await fetchPublicPage(env, { now: deps.now, fetch: strictFetch(() => new Response("<p>x</p>", { headers: { "content-type": "text/html" } })) }, "https://jobs.example.test/x");
  assert.equal(result.ok, true);
});
