import assert from "node:assert/strict";
import test from "node:test";
import { createBochaProvider } from "../platform/search/bocha.ts";
import { SearchError } from "../platform/search/types.ts";
import { SEARCH_DAILY_LIMIT, withSearchQuota } from "../platform/search/quota.ts";
import { shanghaiDay } from "../platform/llm/quota.ts";
import { forUser } from "../platform/data/scoped.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { fakeFetch } from "./helpers/fake-llm.mjs";
import { fakeSearch, hit } from "./helpers/fake-search.mjs";

const bochaReply = (value) => new Response(JSON.stringify({ code: 200, data: { webPages: { value } } }), { status: 200 });

test("博查请求格式", async () => {
  const fetch = fakeFetch(() => bochaReply([]));
  await createBochaProvider({ apiKey: "test-bocha", fetch }).search("q");
  const [request] = fetch.requests;
  assert.equal(request.url, "https://api.bochaai.com/v1/web-search");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), "Bearer test-bocha");
  assert.deepEqual(request.body, { query: "q", summary: true, freshness: "oneYear", count: 10 });
  assert.ok(request.signal);
});

test("解析 data.webPages.value，name→title，丢弃非 http(s) 链接", async () => {
  const fetch = fakeFetch(() => bochaReply([
    { name: "示例公司校园招聘", url: "https://careers.example.test/campus", summary: "摘要", siteName: "示例公司", datePublished: "2026-10-01T00:00:00+08:00" },
    { name: "坏链接", url: "javascript:alert(1)" },
    { name: "缺字段", url: "https://b.example.test/" },
  ]));
  const hits = await createBochaProvider({ apiKey: "k", fetch }).search("q");
  assert.deepEqual(hits, [
    { title: "示例公司校园招聘", url: "https://careers.example.test/campus", summary: "摘要", siteName: "示例公司", datePublished: "2026-10-01T00:00:00+08:00" },
    { title: "缺字段", url: "https://b.example.test/", summary: null, siteName: null, datePublished: null },
  ]);
});

test("缺 webPages 返回空数组；非 2xx / 缺 data / 网络错误 → SearchError", async () => {
  const empty = createBochaProvider({ apiKey: "k", fetch: fakeFetch(() => new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 })) });
  assert.deepEqual(await empty.search("q"), []);
  for (const handler of [() => new Response("x", { status: 401 }), () => new Response("{}", { status: 200 }), () => { throw new TypeError("net"); }]) {
    await assert.rejects(() => createBochaProvider({ apiKey: "k", fetch: fakeFetch(handler) }).search("q"), (error) => error instanceof SearchError);
  }
});

test("每日 20 次，第 21 次 429", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "s@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  const provider = withSearchQuota(fakeSearch({ "*": [hit("https://a.example.test/")] }), scope, user.user.id, deps.now);
  assert.equal(SEARCH_DAILY_LIMIT, 20);
  for (let i = 0; i < 20; i += 1) await provider.search("q");
  await assert.rejects(() => provider.search("q"), (error) => error.status === 429 && /今日搜索额度已用完/.test(error.message));
});

test("并发 30 次最多放行 20 次", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "c@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  const provider = withSearchQuota(fakeSearch({ "*": [] }), scope, user.user.id, deps.now);
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => provider.search("q")));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 20);
  const row = await env.PRIVATE_DB.prepare("SELECT searches FROM llm_usage WHERE user_id = ? AND day = ?").bind(user.user.id, shanghaiDay(deps.now())).first();
  assert.equal(row.searches, 20);
});

test("搜索不占用大模型调用次数", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "n@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  await withSearchQuota(fakeSearch({ "*": [] }), scope, user.user.id, deps.now).search("q");
  assert.deepEqual(await scope.usage.get(shanghaiDay(deps.now())), { calls: 0, tokens: 0 });
});

test("日志不含检索词", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "l@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  await withSearchQuota(fakeSearch({ "*": [] }), scope, user.user.id, deps.now).search("机密检索词");
  assert.ok(lines.some((line) => line.includes("platform.search.call")));
  assert.ok(!lines.join("\n").includes("机密检索词"));
});
