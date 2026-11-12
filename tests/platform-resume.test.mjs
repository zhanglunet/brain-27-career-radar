import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { forUser } from "../platform/data/scoped.ts";

const enc = new TextEncoder();
const pdf = (text = "示例简历") => ({ name: "cv.pdf", type: "application/pdf", bytes: enc.encode(`%PDF-1.7\n${text}`) });
const docx = () => ({ name: "cv.docx", type: "application/octet-stream", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) });

async function consented(env, deps, email) {
  const c = await activeUser(env, deps, email);
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  return c;
}

test("上传 PDF 与 DOCX 成功，R2 键带用户前缀，列表显示文件名", async () => {
  const { env, deps } = await makeEnv();
  const c = await consented(env, deps, "a@example.test");
  assert.equal((await c.upload("/resume", "resume", pdf())).status, 303);
  assert.equal((await c.upload("/resume", "resume", docx())).status, 303);
  const resumes = await forUser(env.PRIVATE_DB, c.user.id).resumes.list();
  assert.equal(resumes.length, 2);
  assert.deepEqual(resumes.map((r) => r.mime).sort(), ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  assert.deepEqual(env.RESUMES.keys(), resumes.map((r) => `${c.user.id}/resumes/${r.id}`).sort());
  const page = await (await c.get("/profile")).text();
  assert.match(page, /cv\.pdf/);
  assert.match(page, /cv\.docx/);
});

test("伪装文件被拒且不写 R2：PNG 改名 .pdf、zip 不是 .docx、空文件", async () => {
  const { env, deps } = await makeEnv();
  const c = await consented(env, deps, "a@example.test");
  const png = { name: "cv.pdf", type: "application/pdf", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]) };
  const zip = { name: "cv.zip", type: "application/zip", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]) };
  const empty = { name: "cv.pdf", type: "application/pdf", bytes: new Uint8Array() };
  for (const file of [png, zip, empty]) assert.equal((await c.upload("/resume", "resume", file)).status, 400, file.name);
  assert.deepEqual(env.RESUMES.keys(), []);
});

test("超过 5 MB 返回 413 且不写 R2", async () => {
  const { env, deps } = await makeEnv();
  const c = await consented(env, deps, "a@example.test");
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big.set(enc.encode("%PDF-"));
  assert.equal((await c.upload("/resume", "resume", { name: "cv.pdf", bytes: big })).status, 413);
  assert.deepEqual(env.RESUMES.keys(), []);
});

test("每人最多 3 份", async () => {
  const { env, deps } = await makeEnv();
  const c = await consented(env, deps, "a@example.test");
  for (let i = 0; i < 3; i += 1) assert.equal((await c.upload("/resume", "resume", pdf())).status, 303);
  const fourth = await c.upload("/resume", "resume", pdf());
  assert.equal(fourth.status, 400);
  assert.match(await fourth.text(), /最多保存 3 份简历/);
  assert.equal(env.RESUMES.keys().length, 3);
});

test("A 下载 / 删除 B 的简历都是 404，B 的文件仍在", async () => {
  const { env, deps } = await makeEnv();
  const a = await consented(env, deps, "a@example.test");
  const b = await consented(env, deps, "b@example.test");
  await b.upload("/resume", "resume", pdf("B 的简历"));
  const [resume] = await forUser(env.PRIVATE_DB, b.user.id).resumes.list();
  assert.equal((await a.get(`/resume/${resume.id}`)).status, 404);
  assert.equal((await a.post(`/resume/${resume.id}/delete`)).status, 404);
  assert.equal(env.RESUMES.keys().length, 1);
  const own = await b.get(`/resume/${resume.id}`);
  assert.equal(own.status, 200);
  assert.match(new TextDecoder().decode(await own.arrayBuffer()), /B 的简历/);
});

test("本人删除简历同时删 R2 与记录", async () => {
  const { env, deps } = await makeEnv();
  const c = await consented(env, deps, "a@example.test");
  await c.upload("/resume", "resume", pdf());
  const [resume] = await forUser(env.PRIVATE_DB, c.user.id).resumes.list();
  assert.equal((await c.post(`/resume/${resume.id}/delete`)).status, 303);
  assert.deepEqual(env.RESUMES.keys(), []);
  assert.deepEqual(await forUser(env.PRIVATE_DB, c.user.id).resumes.list(), []);
});

test("下载响应为附件、private no-store、文件名不回显用户输入", async () => {
  const { env, deps } = await makeEnv();
  const c = await consented(env, deps, "a@example.test");
  await c.upload("/resume", "resume", { ...pdf(), name: 'a"\r\nX-Evil: 1.pdf' });
  const [resume] = await forUser(env.PRIVATE_DB, c.user.id).resumes.list();
  const response = await c.get(`/resume/${resume.id}`);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="resume.pdf"');
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-evil"), null);
});

test("未同意条款不能上传", async () => {
  const { env, deps } = await makeEnv();
  const c = await activeUser(env, deps, "a@example.test");
  const response = await c.upload("/resume", "resume", pdf());
  assert.equal(response.headers.get("location"), "/consent");
  assert.deepEqual(env.RESUMES.keys(), []);
});

test("文件名中的 HTML 在列表中被转义", async () => {
  const { env, deps } = await makeEnv();
  const c = await consented(env, deps, "a@example.test");
  await c.upload("/resume", "resume", { ...pdf(), name: "<img src=x onerror=y>.pdf" });
  const page = await (await c.get("/profile")).text();
  assert.doesNotMatch(page, /<img src=x/);
  assert.match(page, /&lt;img src=x onerror=y&gt;\.pdf/);
});
