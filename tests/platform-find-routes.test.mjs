import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { executeRun } from "../platform/find/run.ts";
import { forUser } from "../platform/data/scoped.ts";
import { listPlatformSources } from "../platform/data/shared-sources.ts";
import { activeUser } from "./helpers/platform-client.mjs";
import { findFixture } from "./helpers/find-fixture.mjs";

async function ranFixture() {
  const f = await findFixture();
  assert.equal((await f.c.post(`/goals/${f.goal.id}/find`)).status, 303);
  await executeRun(f.env, f.deps, f.env.FIND_QUEUE.sent.at(-1));
  return f;
}

test("目标页显示机会清单、层级标签、截止与资格判定表", async () => {
  const f = await ranFixture();
  const page = await (await f.c.get(`/goals/${f.goal.id}`)).text();
  assert.match(page, /用户研究校招（公开雷达）/);
  assert.match(page, /来自第三方或聚合平台，待官方确认/);
  assert.match(page, /2026-12-01/);
  assert.match(page, /硕士及以上学历/);
  assert.match(page, /满足/);
  assert.match(page, /教育：示例大学 硕士/);
  assert.match(page, /学历符合/);
  assert.match(page, /完成于/);
});

test("首页目标卡片有查看机会的链接", async () => {
  const f = await findFixture();
  assert.match(await (await f.c.get("/")).text(), new RegExp(`href="/goals/${f.goal.id}"`));
});

test("点击找机会入队，重复点击 409", async () => {
  const f = await findFixture();
  assert.equal((await f.c.post(`/goals/${f.goal.id}/find`)).status, 303);
  assert.equal(f.env.FIND_QUEUE.sent.length, 1);
  const again = await f.c.post(`/goals/${f.goal.id}/find`);
  assert.equal(again.status, 409);
  assert.match(await again.text(), /正在找机会/);
  assert.match(await (await f.c.get(`/goals/${f.goal.id}`)).text(), /排队中/);
});

test("没有目标画像时提示先确认画像", async () => {
  const f = await findFixture();
  await f.c.post("/goals", { title: "无画像", description: "d" });
  const goal = (await f.scope.goals.list()).find((g) => g.title === "无画像");
  const response = await f.c.post(`/goals/${goal.id}/find`);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /请先在我的档案里确认这个目标的画像/);
});

test("A 访问 B 的目标、来源、机会都是 404", async () => {
  const f = await ranFixture();
  const b = await activeUser(f.env, f.deps, "b@example.test");
  await b.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  const [opp] = await f.scope.opportunities.list(f.goal.id);
  const [source] = await f.scope.sources.list(f.goal.id);
  assert.equal((await b.get(`/goals/${f.goal.id}`)).status, 404);
  assert.equal((await b.post(`/goals/${f.goal.id}/find`)).status, 404);
  assert.equal((await b.post(`/goals/${f.goal.id}/sources`, { url: "https://x.example.test/" })).status, 404);
  assert.equal((await b.post(`/goals/${f.goal.id}/sources/${source.id}/delete`)).status, 404);
  assert.equal((await b.post(`/goals/${f.goal.id}/sources/${source.id}/nominate`)).status, 404);
  assert.equal((await b.post(`/opportunities/${opp.id}/mark`, { mark: "done" })).status, 404);
  assert.equal((await f.scope.opportunities.list(f.goal.id))[0].mark, "new");
});

test("标记不感兴趣后默认隐藏，?all=1 可见；非法标记 400", async () => {
  const f = await ranFixture();
  const opp = (await f.scope.opportunities.list(f.goal.id)).find((o) => o.title === "用户研究校招（公开雷达）");
  assert.equal((await f.c.post(`/opportunities/${opp.id}/mark`, { mark: "hacked" })).status, 400);
  const marked = await f.c.post(`/opportunities/${opp.id}/mark`, { mark: "dismissed" });
  assert.equal(marked.status, 303);
  assert.equal(marked.headers.get("location"), `/goals/${f.goal.id}`);
  assert.doesNotMatch(await (await f.c.get(`/goals/${f.goal.id}`)).text(), /用户研究校招（公开雷达）/);
  assert.match(await (await f.c.get(`/goals/${f.goal.id}?all=1`)).text(), /用户研究校招（公开雷达）/);
});

test("机会标题与要求中的 HTML 被转义，外链带 noopener noreferrer nofollow", async () => {
  const f = await findFixture();
  await f.scope.opportunities.upsert(f.goal.id, {
    key: "k1", title: "<script>x</script>", org: "<b>机构</b>", url: "https://jobs.example.test/1", tier: "L3",
    source: { url: "https://jobs.example.test/", tier: "L3" }, location: null, kind: null, deadlineStatus: "unknown", deadlineDate: null,
    requirements: ["<img src=x onerror=y>"], risk: null,
  }, f.deps.now());
  await f.scope.opportunities.setAssessment(f.goal.id, "k1", { items: [{ requirement: "<img src=x onerror=y>", status: "未知", evidence: null }], reasons: ["<i>理由</i>"], gaps: [], score: 10 }, f.deps.now());
  const page = await (await f.c.get(`/goals/${f.goal.id}`)).text();
  assert.doesNotMatch(page, /<script>x|<img src=x|<b>机构|<i>理由/);
  assert.match(page, /href="https:\/\/jobs\.example\.test\/1"[^>]*rel="noopener noreferrer nofollow"/);
  assert.match(page, /target="_blank"/);
});

test("javascript: 链接不会出现在页面上", async () => {
  const f = await findFixture();
  await f.env.PRIVATE_DB.prepare("INSERT INTO user_opportunities (id, user_id, goal_id, key, title, url, tier, deadline_status, first_seen_at, updated_at) VALUES ('evil', ?, ?, 'evil', '坏链接', 'javascript:alert(1)', 'L3', 'unknown', 1, 1)").bind(f.c.user.id, f.goal.id).run();
  const page = await (await f.c.get(`/goals/${f.goal.id}`)).text();
  assert.match(page, /坏链接/);
  assert.doesNotMatch(page, /javascript:/);
});

test("添加内网或非法网址被拒；聚合平台链接存为 L4", async () => {
  const f = await findFixture();
  for (const url of ["http://127.0.0.1/", "javascript:alert(1)", "not a url"]) {
    const response = await f.c.post(`/goals/${f.goal.id}/sources`, { url });
    assert.equal(response.status, 400, url);
    assert.match(await response.text(), /请填写有效的公开网址/);
  }
  assert.equal((await f.c.post(`/goals/${f.goal.id}/sources`, { url: "https://www.zhipin.com/job/1", org: "" })).status, 303);
  const sources = await f.scope.sources.list(f.goal.id);
  assert.equal(sources.find((s) => s.url.includes("zhipin")).tier, "L4");
});

test("删除来源", async () => {
  const f = await findFixture();
  const [source] = await f.scope.sources.list(f.goal.id);
  assert.equal((await f.c.post(`/goals/${f.goal.id}/sources/${source.id}/delete`)).status, 303);
  assert.deepEqual(await f.scope.sources.list(f.goal.id), []);
});

test("提名后管理员可见网址但看不到提名人，批准后进入共享来源", async () => {
  const f = await findFixture();
  const admin = await activeUser(f.env, f.deps, "admin@example.test", { role: "admin" });
  const page = await (await f.c.get(`/goals/${f.goal.id}`)).text();
  assert.match(page, /管理员会看到这个网址，但看不到是谁分享的/);
  const [source] = await f.scope.sources.list(f.goal.id);
  assert.equal((await f.c.post(`/goals/${f.goal.id}/sources/${source.id}/nominate`)).status, 303);
  const adminPage = await (await admin.get("/admin")).text();
  assert.match(adminPage, /hr\.example\.test\/jobs/);
  const section = adminPage.slice(adminPage.indexOf("待审核的共享来源"), adminPage.indexOf("最近的找机会运行"));
  assert.doesNotMatch(section, /a@example\.test/);
  const id = adminPage.match(/\/admin\/nominations\/([0-9a-f-]+)\/approve/)[1];
  assert.equal((await admin.post(`/admin/nominations/${id}/approve`)).status, 303);
  assert.ok((await listPlatformSources(f.env.PRIVATE_DB)).some((s) => s.url === "https://hr.example.test/jobs"));
  assert.equal((await admin.post(`/admin/nominations/${id}/reject`)).status, 409, "已处理的提名");
  assert.equal((await f.c.post(`/admin/nominations/${id}/approve`)).status, 403, "普通用户不能审核");
});

test("管理员的运行列表不含检索词与机会标题", async () => {
  const f = await ranFixture();
  const admin = await activeUser(f.env, f.deps, "admin@example.test", { role: "admin" });
  const page = await (await admin.get("/admin")).text();
  const section = page.slice(page.indexOf("最近的找机会运行"));
  assert.match(section, /a@example\.test/);
  assert.match(section, /done/);
  assert.doesNotMatch(section, /用户研究 校园招聘 官网/);
  assert.doesNotMatch(section, /用户研究校招（公开雷达）|搜索发现岗位/);
});

test("未同意条款不能发起找机会", async () => {
  const f = await findFixture();
  await f.env.PRIVATE_DB.prepare("DELETE FROM consents WHERE user_id = ?").bind(f.c.user.id).run();
  const response = await f.c.post(`/goals/${f.goal.id}/find`);
  assert.equal(response.headers.get("location"), "/consent");
  assert.equal(f.env.FIND_QUEUE.sent.length, 0);
});

test("失败的运行在页面上显示原因", async () => {
  const f = await findFixture();
  delete f.deps.search;
  f.env.BOCHA_API_KEY = undefined;
  await f.c.post(`/goals/${f.goal.id}/find`);
  await executeRun(f.env, f.deps, f.env.FIND_QUEUE.sent.at(-1));
  assert.match(await (await f.c.get(`/goals/${f.goal.id}`)).text(), /失败.*搜索服务未配置/s);
  assert.ok(forUser);
});
