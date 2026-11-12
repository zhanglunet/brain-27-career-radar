import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { activeUser, fakeAi, makeEnv } from "./helpers/platform-client.mjs";
import { fakeLlm } from "./helpers/fake-llm.mjs";
import { forUser } from "../platform/data/scoped.ts";
import { LlmError } from "../platform/llm/types.ts";
import { formToProfile, formToTarget, profileToForm, targetToForm } from "../platform/profile/form.ts";

const enc = new TextEncoder();
const PDF = { name: "cv.pdf", type: "application/pdf", bytes: enc.encode("%PDF-1.7 示例简历") };
const MODEL_DRAFT = {
  profile: {
    basics: { name: "张三（示例）", location: "北京" },
    education: [{ school: "示例大学", degree: "硕士", major: "心理学", period: "2025-2028" }],
    experience: [{ org: "示例公司", title: "研究实习生", period: "2026", highlight: "做过眼动实验" }],
    skills: ["Python", "SPSS"],
    outputs: [{ kind: "paper", title: "示例论文", venue: "示例期刊", year: "2026" }],
  },
  target: { kinds: ["校招"], directions: ["用户研究"], cities: ["北京", "上海"], timing: "2027 届", notes: null },
};

async function setup(llmResponses = [MODEL_DRAFT]) {
  const { env, deps } = await makeEnv();
  deps.llm = fakeLlm(llmResponses);
  const c = await activeUser(env, deps, "a@example.test");
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  return { env, deps, c, scope: forUser(env.PRIVATE_DB, c.user.id) };
}

async function makeDraft(c, scope, fields = {}) {
  const response = await c.post("/profile/draft", fields);
  assert.equal(response.status, 303, await response.clone().text());
  const location = response.headers.get("location");
  assert.match(location, /^\/profile\/drafts\/[0-9a-f-]+$/);
  return location.split("/").pop();
}

function confirmFields(draftForm, overrides = {}) {
  return { ...draftForm, ...overrides };
}

test("上传简历 → 生成草稿 → 修改后确认 → 当前档案为修改后的内容", async () => {
  const { c, scope, deps } = await setup();
  await c.upload("/resume", "resume", PDF);
  const [resume] = await scope.resumes.list();
  const draftId = await makeDraft(c, scope, { resumeId: resume.id });
  const [messages] = deps.llm.calls;
  assert.match(messages[1].content, /示例简历/);
  assert.equal((await scope.resumes.get(resume.id)).textChars > 0, true);
  const page = await (await c.get(`/profile/drafts/${draftId}`)).text();
  assert.match(page, /请逐项核对/);
  assert.match(page, /张三（示例）/);
  const form = profileToForm(MODEL_DRAFT.profile);
  const response = await c.post(`/profile/drafts/${draftId}/confirm`, confirmFields(form, { name: "张三", education: "示例大学 | 硕士 | 心理学 | 2025-2028" }));
  assert.equal(response.status, 303);
  const current = await scope.profile.current();
  assert.equal(current.version, 1);
  assert.equal(current.data.basics.name, "张三");
  assert.equal(current.data.education[0].school, "示例大学");
  assert.deepEqual(current.data.skills, ["Python", "SPSS"]);
});

test("只写意向也能生成草稿", async () => {
  const { c, scope, deps } = await setup();
  await makeDraft(c, scope, { intent: "想找北京的用户研究校招" });
  assert.match(deps.llm.calls[0][1].content, /<intent>/);
  assert.doesNotMatch(deps.llm.calls[0][1].content, /<resume>/);
});

test("未确认的草稿不成为当前档案", async () => {
  const { c, scope } = await setup();
  await makeDraft(c, scope, { intent: "x" });
  assert.equal(await scope.profile.current(), null);
});

test("同一草稿确认两次，第二次 409 且版本不变；已丢弃的草稿不能确认", async () => {
  const { c, scope } = await setup([MODEL_DRAFT, MODEL_DRAFT]);
  const id = await makeDraft(c, scope, { intent: "x" });
  const form = profileToForm(MODEL_DRAFT.profile);
  assert.equal((await c.post(`/profile/drafts/${id}/confirm`, form)).status, 303);
  const again = await c.post(`/profile/drafts/${id}/confirm`, { ...form, name: "改过" });
  assert.equal(again.status, 409);
  assert.match(await again.text(), /这份草稿已处理过/);
  assert.equal((await scope.profile.current()).version, 1);
  assert.equal((await scope.profile.current()).data.basics.name, "张三（示例）");
  const second = await makeDraft(c, scope, { intent: "y" });
  assert.equal((await c.post(`/profile/drafts/${second}/discard`)).status, 303);
  assert.equal((await c.post(`/profile/drafts/${second}/confirm`, form)).status, 409);
  assert.equal((await scope.profile.current()).version, 1);
});

test("回滚恢复上一版并生成新版本号；无历史时 400", async () => {
  const { c, scope } = await setup([MODEL_DRAFT, MODEL_DRAFT]);
  assert.equal((await c.post("/profile/rollback")).status, 400);
  const first = await makeDraft(c, scope, { intent: "x" });
  await c.post(`/profile/drafts/${first}/confirm`, { ...profileToForm(MODEL_DRAFT.profile), name: "第一版" });
  const second = await makeDraft(c, scope, { intent: "y" });
  await c.post(`/profile/drafts/${second}/confirm`, { ...profileToForm(MODEL_DRAFT.profile), name: "第二版" });
  assert.equal((await scope.profile.current()).version, 2);
  assert.equal((await c.post("/profile/rollback")).status, 303);
  const current = await scope.profile.current();
  assert.equal(current.version, 3);
  assert.equal(current.data.basics.name, "第一版");
});

test("带目标的草稿确认后写入目标画像，首页目标卡片显示", async () => {
  const { c, scope } = await setup();
  await c.post("/goals", { title: "国内校招", description: "用户研究方向" });
  const [goal] = await scope.goals.list();
  const id = await makeDraft(c, scope, { goalId: goal.id });
  const draftPage = await (await c.get(`/profile/drafts/${id}`)).text();
  assert.match(draftPage, /name="cities"/);
  await c.post(`/profile/drafts/${id}/confirm`, { ...profileToForm(MODEL_DRAFT.profile), ...targetToForm(MODEL_DRAFT.target), cities: "深圳" });
  const [updated] = await scope.goals.list();
  assert.deepEqual(updated.target.cities, ["深圳"]);
  assert.deepEqual(updated.target.kinds, ["校招"]);
  const home = await (await c.get("/")).text();
  assert.match(home, /深圳/);
  assert.match(home, /校招/);
});

test("选了目标但没写意向时，用目标的标题和描述作为意向", async () => {
  const { c, scope, deps } = await setup();
  await c.post("/goals", { title: "港硕申请", description: "想申请香港的心理学硕士" });
  const [goal] = await scope.goals.list();
  await makeDraft(c, scope, { goalId: goal.id });
  assert.match(deps.llm.calls[0][1].content, /想申请香港的心理学硕士/);
});

test("goalId 或 resumeId 不是本人的时 404，不调用模型", async () => {
  const { env, deps, c } = await setup();
  const b = await activeUser(env, deps, "b@example.test");
  await b.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await b.post("/goals", { title: "B 目标", description: "d" });
  await b.upload("/resume", "resume", PDF);
  const bScope = forUser(env.PRIVATE_DB, b.user.id);
  const [bGoal] = await bScope.goals.list();
  const [bResume] = await bScope.resumes.list();
  assert.equal((await c.post("/profile/draft", { goalId: bGoal.id, intent: "x" })).status, 404);
  assert.equal((await c.post("/profile/draft", { resumeId: bResume.id })).status, 404);
  assert.equal(deps.llm.calls.length, 0);
});

test("A 访问 B 的草稿（查看 / 确认 / 丢弃）都是 404", async () => {
  const { env, deps, c } = await setup([MODEL_DRAFT, MODEL_DRAFT]);
  const b = await activeUser(env, deps, "b@example.test");
  await b.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  const bScope = forUser(env.PRIVATE_DB, b.user.id);
  const id = await makeDraft(b, bScope, { intent: "B 的意向" });
  assert.equal((await c.get(`/profile/drafts/${id}`)).status, 404);
  assert.equal((await c.post(`/profile/drafts/${id}/confirm`, profileToForm(MODEL_DRAFT.profile))).status, 404);
  assert.equal((await c.post(`/profile/drafts/${id}/discard`)).status, 404);
  assert.equal((await bScope.drafts.get(id)).status, "pending");
});

test("模型输出中的 HTML 在草稿页被转义", async () => {
  const { c, scope } = await setup([{ profile: { basics: { name: "<script>x</script>" }, skills: ["<img src=x onerror=y>"] }, target: {} }]);
  const id = await makeDraft(c, scope, { intent: "x" });
  const page = await (await c.get(`/profile/drafts/${id}`)).text();
  assert.doesNotMatch(page, /<script>x/);
  assert.doesNotMatch(page, /<img src=x/);
  assert.match(page, /&lt;script&gt;x&lt;\/script&gt;/);
});

test("模型不可用时 502，不产生草稿", async () => {
  const { c, scope } = await setup([new LlmError("unavailable", "down")]);
  const response = await c.post("/profile/draft", { intent: "x" });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /智能体暂时不可用/);
  assert.deepEqual(await scope.drafts.listPending(), []);
});

test("扫描件简历提示改用文字版，不调用模型", async () => {
  const { env, c, scope, deps } = await setup();
  env.AI = fakeAi(() => ({ format: "markdown", data: "\n\n" }));
  await c.upload("/resume", "resume", PDF);
  const [resume] = await scope.resumes.list();
  const response = await c.post("/profile/draft", { resumeId: resume.id });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /扫描件/);
  assert.equal(deps.llm.calls.length, 0);
});

test("意向超过 4000 字被拒，不调用模型", async () => {
  const { c, deps } = await setup();
  assert.equal((await c.post("/profile/draft", { intent: "字".repeat(4001) })).status, 400);
  assert.equal(deps.llm.calls.length, 0);
});

test("档案页列出当前档案与待确认草稿", async () => {
  const { c, scope } = await setup([MODEL_DRAFT, MODEL_DRAFT]);
  const first = await makeDraft(c, scope, { intent: "x" });
  await c.post(`/profile/drafts/${first}/confirm`, profileToForm(MODEL_DRAFT.profile));
  await makeDraft(c, scope, { intent: "y" });
  const page = await (await c.get("/profile")).text();
  assert.match(page, /版本 1/);
  assert.match(page, /示例大学/);
  assert.match(page, /待确认的草稿/);
});

test("导出包含档案、历史版本、草稿与简历元数据，不含简历文件内容", async () => {
  const { c, scope } = await setup([MODEL_DRAFT, MODEL_DRAFT]);
  await c.upload("/resume", "resume", PDF);
  const first = await makeDraft(c, scope, { intent: "x" });
  await c.post(`/profile/drafts/${first}/confirm`, profileToForm(MODEL_DRAFT.profile));
  const second = await makeDraft(c, scope, { intent: "y" });
  await c.post(`/profile/drafts/${second}/confirm`, { ...profileToForm(MODEL_DRAFT.profile), name: "第二版" });
  const raw = await (await c.get("/account/export")).text();
  const data = JSON.parse(raw);
  assert.equal(data.profile.version, 2);
  assert.equal(data.profileVersions.length, 1);
  assert.equal(data.drafts.length, 2);
  assert.equal(data.resumes[0].filename, "cv.pdf");
  assert.ok(!raw.includes("%PDF"));
});

test("form 往返：profileToForm → formToProfile 不丢字段", () => {
  const round = formToProfile(new URLSearchParams(profileToForm(MODEL_DRAFT.profile)));
  assert.deepEqual(round, MODEL_DRAFT.profile);
  const target = formToTarget(new URLSearchParams(Object.entries(targetToForm(MODEL_DRAFT.target)).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))));
  assert.deepEqual(target, MODEL_DRAFT.target);
});

test("form 解析：缺列补 null、多余列并入最后一列、空行跳过", () => {
  const profile = formToProfile(new URLSearchParams({
    education: "示例大学 | 硕士\n\n  \n另一所大学 | 本科 | 心理学 | 2021-2025 | 多余",
    outputs: "奖项 | 示例奖 | | 2024\n未知类型 | 示例项目",
  }));
  assert.deepEqual(profile.education, [
    { school: "示例大学", degree: "硕士", major: null, period: null },
    { school: "另一所大学", degree: "本科", major: "心理学", period: "2021-2025 | 多余" },
  ]);
  assert.deepEqual(profile.outputs, [
    { kind: "award", title: "示例奖", venue: null, year: "2024" },
    { kind: "other", title: "示例项目", venue: null, year: null },
  ]);
});
