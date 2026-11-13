import assert from "node:assert/strict";
import test from "node:test";
import { createDeepSeekProvider } from "../platform/llm/deepseek.ts";
import { LlmError } from "../platform/llm/types.ts";
import { shanghaiDay, withDailyQuota } from "../platform/llm/quota.ts";
import { llmFor } from "../platform/llm/context.ts";
import { forUser } from "../platform/data/scoped.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { deepSeekReply, fakeFetch, fakeLlm } from "./helpers/fake-llm.mjs";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { HttpError } from "../platform/http.ts";

const MESSAGES = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
// 上海时间 2026-11-12 23:00
const NOV12_23H = Date.UTC(2026, 10, 12, 15, 0, 0);

test("DeepSeek 请求格式", async () => {
  const fetch = fakeFetch(() => deepSeekReply('{"ok":true}'));
  await createDeepSeekProvider({ apiKey: "test-key", fetch }).completeJson(MESSAGES);
  const [request] = fetch.requests;
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), "Bearer test-key");
  assert.equal(request.body.model, "deepseek-chat");
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.max_tokens, 8192);
  assert.deepEqual(request.body.messages, MESSAGES);
  assert.ok(request.signal, "应带超时信号");
});

test("解析 JSON 内容与 usage", async () => {
  const fetch = fakeFetch(() => deepSeekReply('{"a":1}', { prompt_tokens: 10, completion_tokens: 5 }));
  const result = await createDeepSeekProvider({ apiKey: "k", fetch }).completeJson(MESSAGES);
  assert.deepEqual(result, { json: { a: 1 }, usage: { promptTokens: 10, completionTokens: 5 } });
});

test("5xx、网络错误、超时 → unavailable；非 JSON 内容 → bad_response", async () => {
  const cases = [
    [() => new Response("oops", { status: 503 }), "unavailable"],
    [() => { throw new TypeError("network"); }, "unavailable"],
    [() => { throw new DOMException("timeout", "TimeoutError"); }, "unavailable"],
    [() => deepSeekReply("not json"), "bad_response"],
    [() => new Response("{}", { status: 200 }), "bad_response"],
  ];
  for (const [handler, kind] of cases) {
    const provider = createDeepSeekProvider({ apiKey: "k", fetch: fakeFetch(handler) });
    await assert.rejects(() => provider.completeJson(MESSAGES), (error) => error instanceof LlmError && error.kind === kind, kind);
  }
});

test("shanghaiDay 按 UTC+8 切日", () => {
  assert.equal(shanghaiDay(Date.UTC(2026, 10, 12, 15, 59)), "2026-11-12");
  assert.equal(shanghaiDay(Date.UTC(2026, 10, 12, 16, 1)), "2026-11-13");
});

test("额度：第 31 次调用被拒，次日恢复", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "q@example.test");
  let now = NOV12_23H;
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  const provider = withDailyQuota(fakeLlm([{}]), scope, user.user.id, () => now);
  for (let i = 0; i < 30; i += 1) await provider.completeJson(MESSAGES);
  await assert.rejects(() => provider.completeJson(MESSAGES), (error) => error instanceof HttpError && error.status === 429 && /今日智能体额度已用完/.test(error.message));
  now = Date.UTC(2026, 10, 12, 16, 1);
  await provider.completeJson(MESSAGES);
});

test("token 超限同样拒绝", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "t@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  await scope.usage.addTokens(shanghaiDay(NOV12_23H), 150000);
  const provider = withDailyQuota(fakeLlm([{}]), scope, user.user.id, () => NOV12_23H);
  await assert.rejects(() => provider.completeJson(MESSAGES), (error) => error.status === 429);
});

test("调用失败也计次数，不计 token；成功计 token", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "f@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  const failing = withDailyQuota(fakeLlm([new LlmError("unavailable", "down")]), scope, user.user.id, () => NOV12_23H);
  await assert.rejects(() => failing.completeJson(MESSAGES));
  assert.deepEqual(await scope.usage.get(shanghaiDay(NOV12_23H)), { calls: 1, tokens: 0 });
  await withDailyQuota(fakeLlm([{}]), scope, user.user.id, () => NOV12_23H).completeJson(MESSAGES);
  assert.deepEqual(await scope.usage.get(shanghaiDay(NOV12_23H)), { calls: 2, tokens: 150 });
});

test("日志不含提示词与模型输出", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  t.mock.method(console, "error", (line) => lines.push(String(line)));
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "l@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  const inner = createDeepSeekProvider({ apiKey: "k", fetch: fakeFetch(() => deepSeekReply('{"x":"机密输出"}')) });
  await withDailyQuota(inner, scope, user.user.id, () => NOV12_23H).completeJson([{ role: "user", content: "机密简历内容" }]);
  const joined = lines.join("\n");
  assert.ok(joined.includes("platform.llm.call"));
  assert.ok(!joined.includes("机密简历内容"));
  assert.ok(!joined.includes("机密输出"));
});

function ctxFor(env, deps, user) {
  return { request: new Request("https://platform.test/x"), env, deps, url: new URL("https://platform.test/x"), user };
}

test("未同意条款时 llmFor 跳转 /consent；缺 key 返回 503；注入的 llm 优先", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "c@example.test");
  await assert.rejects(() => llmFor(ctxFor(env, deps), user.user), (error) => error.status === 303 && error.location === "/consent");
  await user.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await assert.rejects(() => llmFor(ctxFor({ ...env, DEEPSEEK_API_KEY: undefined }, deps), user.user), (error) => error.status === 503);
  const injected = fakeLlm([{ hi: 1 }]);
  const provider = await llmFor(ctxFor(env, { ...deps, llm: injected }), user.user);
  assert.deepEqual((await provider.completeJson(MESSAGES)).json, { hi: 1 });
  assert.equal(injected.calls.length, 1);
});

test("调用失败时日志记下不含内容的错误细节（HTTP 状态码、超时、内容格式）", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(String(line)));
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "d@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  const cases = [
    [() => new Response("unauthorized", { status: 401 }), "http_401"],
    [() => { throw new DOMException("t", "TimeoutError"); }, "timeout"],
    [() => deepSeekReply("not json"), "content_not_json"],
  ];
  for (const [handler, detail] of cases) {
    const provider = withDailyQuota(createDeepSeekProvider({ apiKey: "k", fetch: fakeFetch(handler) }), scope, user.user.id, () => NOV12_23H);
    await assert.rejects(() => provider.completeJson(MESSAGES));
    assert.ok(lines.some((line) => line.includes("platform.llm.call") && line.includes(detail)), detail);
  }
});

test("key 首尾的空白与换行被去掉后再放进请求头", async () => {
  const fetch = fakeFetch(() => deepSeekReply("{}"));
  await createDeepSeekProvider({ apiKey: "  sk-test-key\n", fetch }).completeJson(MESSAGES);
  assert.equal(fetch.requests[0].headers.get("authorization"), "Bearer sk-test-key");
});

test("key 含非法字符时不发请求，报 key_invalid_chars", async () => {
  const fetch = fakeFetch(() => deepSeekReply("{}"));
  for (const bad of ["sk-ab cd", "sk-全角", "sk-a\nb"]) {
    await assert.rejects(() => createDeepSeekProvider({ apiKey: bad, fetch }).completeJson(MESSAGES), (e) => e instanceof LlmError && e.detail === "key_invalid_chars", JSON.stringify(bad));
  }
  assert.equal(fetch.requests.length, 0);
});
