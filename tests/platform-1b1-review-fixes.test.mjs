/** 1b-1 整分支审查发现的问题：先复现，再修复。 */
import assert from "node:assert/strict";
import test from "node:test";
import { readUpload } from "../platform/upload.ts";
import { forUser } from "../platform/data/scoped.ts";
import { withDailyQuota, shanghaiDay } from "../platform/llm/quota.ts";
import { createDeepSeekProvider } from "../platform/llm/deepseek.ts";
import { LlmError } from "../platform/llm/types.ts";
import { buildDraftMessages } from "../platform/profile/prompt.ts";
import { formToProfile, profileToForm } from "../platform/profile/form.ts";
import { normalizeProfile } from "../platform/profile/schema.ts";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { fakeFetch, fakeLlm } from "./helpers/fake-llm.mjs";

const MESSAGES = [{ role: "system", content: "s" }, { role: "user", content: "u" }];

// ── I1：不带 Content-Length 的分块上传也必须在超限时停止读取 ──
test("没有 Content-Length 的超大上传在读到上限后即停止并返回 413", async () => {
  const boundary = "----probe";
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-`);
  const chunk = new Uint8Array(1024 * 1024);
  let pulled = 0;
  const totalChunks = 50;
  const body = new ReadableStream({
    pull(controller) {
      if (pulled === 0) controller.enqueue(head);
      if (pulled >= totalChunks) return controller.close();
      pulled += 1;
      controller.enqueue(chunk);
    },
  });
  const request = new Request("https://platform.test/resume", {
    method: "POST",
    body,
    duplex: "half",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(request.headers.get("content-length"), null);
  await assert.rejects(() => readUpload(request, "resume", 5 * 1024 * 1024), (error) => error.status === 413);
  assert.ok(pulled < 10, `只应读到上限附近（实际读了 ${pulled} MB）`);
});

test("流式读取后正常文件仍能解析", async () => {
  const form = new FormData();
  form.set("resume", new File([new TextEncoder().encode("%PDF-1.7 正常")], "cv.pdf", { type: "application/pdf" }));
  const upload = await readUpload(new Request("https://platform.test/resume", { method: "POST", body: form }), "resume", 5 * 1024 * 1024);
  assert.equal(upload.filename, "cv.pdf");
  assert.match(new TextDecoder().decode(upload.bytes), /正常/);
});

// ── I2：并发请求不能突破每日调用次数 ──
test("40 个并发调用最多放行 30 个", async () => {
  const { env, deps } = await makeEnv();
  const user = await activeUser(env, deps, "q@example.test");
  const scope = forUser(env.PRIVATE_DB, user.user.id);
  const provider = withDailyQuota(fakeLlm([{}]), scope, user.user.id, deps.now);
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => provider.completeJson(MESSAGES)));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(ok, 30);
  assert.equal((await scope.usage.get(shanghaiDay(deps.now()))).calls, 30);
});

// ── I3：字段内的换行与竖线不能在表单往返后变成假条目 ──
test("亮点里的多行要点与学校名里的竖线，往返后仍是一条", () => {
  const profile = normalizeProfile({
    experience: [{ org: "示例公司", title: "工程师", period: "2026", highlight: "负责A系统\n- 带领5人团队\r\n- 上线B" }],
    education: [{ school: "甲|乙大学", degree: "硕士", major: "心理学", period: "2025-2028" }],
  });
  const round = formToProfile(new URLSearchParams(profileToForm(profile)));
  assert.equal(round.experience.length, 1);
  assert.equal(round.experience[0].org, "示例公司");
  assert.doesNotMatch(round.experience[0].highlight, /\n/);
  assert.match(round.experience[0].highlight, /带领5人团队/);
  assert.equal(round.education.length, 1);
  assert.equal(round.education[0].degree, "硕士");
  assert.match(round.education[0].school, /甲.乙大学/);
});

// ── I4：输出被截断要单独提示，输出上限放宽 ──
test("finish_reason 为 length 时报 too_long，而不是笼统的不可用", async () => {
  const fetch = fakeFetch(() => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"profile":{"basics":' } }], usage: {} }), { status: 200 }));
  await assert.rejects(() => createDeepSeekProvider({ apiKey: "k", fetch }).completeJson(MESSAGES), (error) => error instanceof LlmError && error.kind === "too_long");
});

test("输出上限为 8192 token", async () => {
  const fetch = fakeFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }), { status: 200 }));
  await createDeepSeekProvider({ apiKey: "k", fetch }).completeJson(MESSAGES);
  assert.equal(fetch.requests[0].body.max_tokens, 8192);
});

test("超时真的会中断请求", async () => {
  const fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  await assert.rejects(() => createDeepSeekProvider({ apiKey: "k", fetch, timeoutMs: 20 }).completeJson(MESSAGES), (error) => error instanceof LlmError && error.kind === "unavailable");
});

test("材料过长时页面给出精简提示", async () => {
  const { env, deps } = await makeEnv();
  deps.llm = fakeLlm([new LlmError("too_long", "truncated")]);
  const c = await activeUser(env, deps, "long@example.test");
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  const response = await c.post("/profile/draft", { intent: "很长的意向" });
  assert.equal(response.status, 422);
  assert.match(await response.text(), /材料过长/);
});

// ── 升级：json_object 模式要求提示词里出现小写 json ──
test("system 提示词包含小写的 json", () => {
  const [system] = buildDraftMessages({ resumeText: null, intentText: "x" });
  assert.ok(system.content.includes("json"));
});
