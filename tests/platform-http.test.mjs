import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpError,
  clearSessionCookie,
  escapeHtml,
  isAllowedHost,
  isAllowedOrigin,
  jsonDownload,
  logEvent,
  parseCookies,
  readForm,
  redirect,
  sessionCookie,
  withSecurityHeaders,
} from "../platform/http.ts";

const env = { PLATFORM_HOST: "platform.test" };

test("安全头", () => {
  const response = withSecurityHeaders(new Response("x", { headers: { "cache-control": "public, max-age=60" } }));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("会话 cookie 属性", () => {
  const cookie = sessionCookie("tok");
  for (const part of ["__Host-session=tok", "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) {
    assert.ok(cookie.includes(part), part);
  }
  assert.ok(clearSessionCookie().includes("Max-Age=0"));
});

test("parseCookies", () => {
  assert.deepEqual(parseCookies("a=1; __Host-session=xyz"), { a: "1", "__Host-session": "xyz" });
  assert.deepEqual(parseCookies(null), {});
});

test("redirect 为 303 并可带 cookie", () => {
  const response = redirect("/login", "a=b");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
  assert.equal(response.headers.get("set-cookie"), "a=b");
});

test("jsonDownload 设置附件文件名", async () => {
  const response = jsonDownload({ a: 1 }, "export.json");
  assert.match(response.headers.get("content-disposition"), /attachment; filename="export.json"/);
  assert.deepEqual(await response.json(), { a: 1 });
});

test("Host 校验拒绝 workers.dev 与其他域名", () => {
  assert.equal(isAllowedHost(new Request("https://platform.test/"), env), true);
  assert.equal(isAllowedHost(new Request("https://PLATFORM.test/"), env), true);
  assert.equal(isAllowedHost(new Request("https://x.y.workers.dev/"), env), false);
  assert.equal(isAllowedHost(new Request("https://evil.test/"), env), false);
  assert.equal(isAllowedHost(new Request("https://platform.test.evil.test/"), env), false);
});

test("POST 的 Origin 必须匹配", () => {
  const post = (origin) => new Request("https://platform.test/login", { method: "POST", headers: origin ? { origin } : {} });
  assert.equal(isAllowedOrigin(post("https://platform.test"), env), true);
  assert.equal(isAllowedOrigin(post("https://evil.test"), env), false);
  assert.equal(isAllowedOrigin(post("http://platform.test"), env), false);
  assert.equal(isAllowedOrigin(post(null), env), false);
  assert.equal(isAllowedOrigin(new Request("https://platform.test/"), env), true);
});

test("本地开发主机允许 http 与端口", () => {
  const local = { PLATFORM_HOST: "platform.localhost" };
  const post = (origin) => new Request("http://platform.localhost:8787/login", { method: "POST", headers: { origin } });
  assert.equal(isAllowedOrigin(post("http://platform.localhost:8787"), local), true);
  assert.equal(isAllowedOrigin(post("http://evil.localhost:8787"), local), false);
});

test("readForm 解析表单", async () => {
  const request = new Request("https://platform.test/x", {
    method: "POST",
    body: "a=1&b=%E4%BD%A0",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const form = await readForm(request);
  assert.equal(form.get("a"), "1");
  assert.equal(form.get("b"), "你");
});

test("超大请求体 413", async () => {
  const request = new Request("https://platform.test/x", {
    method: "POST",
    body: "a=" + "x".repeat(70000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  await assert.rejects(() => readForm(request), (error) => error instanceof HttpError && error.status === 413);
});

test("logEvent 丢弃白名单外字段", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  logEvent("x", { userId: "u1", email: "a@example.test", password: "p", count: 2 });
  assert.deepEqual(JSON.parse(lines[0]), { event: "x", userId: "u1", count: 2 });
});

test("escapeHtml", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});
