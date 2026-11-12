/** 找机会运行的完整测试场景：用户、目标画像、档案、公开雷达、共享来源、网页、搜索与模型替身。 */
import { CONSENT_VERSION } from "../../platform/consent.ts";
import { forUser } from "../../platform/data/scoped.ts";
import { decideNomination, listNominations, nominateShared } from "../../platform/data/shared-sources.ts";
import { normalizeProfile } from "../../platform/profile/schema.ts";
import { activeUser, makeEnv } from "./platform-client.mjs";
import { createSqliteD1, tempDbPath } from "./sqlite-d1.mjs";
import { fakeWeb, html } from "./fake-web.mjs";
import { fakeSearch, hit } from "./fake-search.mjs";

export const TARGET = { kinds: ["校招"], directions: ["用户研究"], cities: ["北京"], timing: "2027 届", notes: null };
export const PROFILE = normalizeProfile({
  basics: { name: "张三（示例）", location: "北京" },
  education: [{ school: "示例大学", degree: "硕士", major: "心理学", period: "2025-2028" }],
  skills: ["Python"],
});

const REQ = "硕士及以上学历";
export const URLS = {
  userSource: "https://hr.example.test/jobs",
  shared: "https://careers.shared.example.test/",
  public: "https://radar-source.example.test/opp-1",
  official: "https://found.example.test/campus",
  aggregator: "https://www.zhipin.com/job_detail/abc.html",
};

export function pageWith(title, extra = "") {
  return { body: html(`<h1>${title}</h1><p>岗位要求：${REQ}</p><p>截止：2026年12月1日</p>${extra}`, title) };
}

export async function publicDb(rows) {
  const path = tempDbPath();
  const w = createSqliteD1({ path });
  await w.exec("CREATE TABLE opportunities (id TEXT PRIMARY KEY, name TEXT, org TEXT, kind TEXT, location TEXT, deadline TEXT, url TEXT, published INTEGER, tags_json TEXT, deadline_status TEXT, deadline_at TEXT, authenticity_state TEXT);");
  for (const r of rows) await w.prepare("INSERT INTO opportunities VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(...r).run();
  return createSqliteD1({ readonly: true, path });
}

/** 按系统提示词区分三类调用：检索词规划、页面抽取、资格评估。 */
export function routedLlm({ queries = ["用户研究 校园招聘 官网"], official = true } = {}) {
  const calls = { queries: 0, extract: 0, assess: 0 };
  const sent = [];
  return {
    calls,
    sent,
    async completeJson(messages) {
      const system = messages[0].content;
      sent.push(messages);
      if (system.includes("检索词")) {
        calls.queries += 1;
        return { json: { queries }, usage: { promptTokens: 1, completionTokens: 1 } };
      }
      if (system.includes("抽取")) {
        calls.extract += 1;
        const user = messages[1].content;
        const url = user.match(/页面地址：(\S+)/)[1];
        const title = user.match(/页面标题：(.*)/)[1];
        return { json: { official, org: "示例机构", opportunities: [{ title, url, kind: "校招", location: "北京", deadlineStatus: "date", deadlineDate: "2026-12-01", requirements: [REQ] }] }, usage: { promptTokens: 1, completionTokens: 1 } };
      }
      calls.assess += 1;
      const keys = [...messages[1].content.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1]);
      return { json: { results: keys.map((key) => ({ key, items: [{ requirement: REQ, status: "满足", evidence: "教育：示例大学 硕士" }], reasons: ["学历符合"], gaps: [], score: 80 })) }, usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
}

export async function findFixture({ pages = {}, searchMap, llm = routedLlm(), publicRows, realClock = false } = {}) {
  const PUBLIC_DB = await publicDb(publicRows ?? [["pub-1", "用户研究校招（公开雷达）", "示例研究院", "校招", "北京", "2026-12-01", URLS.public, 1, "[]", "confirmed", "2026-12-01", "trusted"]]);
  const { env, deps, clock } = await makeEnv({ PUBLIC_DB });
  // 经 Worker 入口的请求使用真实时间，会话也要按真实时间创建才不会被判过期。
  if (realClock) clock.set(Date.now());
  const c = await activeUser(env, deps, "a@example.test");
  await c.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await c.post("/goals", { title: "国内校招", description: "用户研究" });
  const scope = forUser(env.PRIVATE_DB, c.user.id);
  const [goal] = await scope.goals.list();
  await scope.goals.setTarget(goal.id, TARGET);
  await scope.profile.confirm(PROFILE, deps.now());
  await scope.sources.add(goal.id, { url: URLS.userSource, org: null, tier: "L3", origin: "user" }, deps.now());
  await nominateShared(env.PRIVATE_DB, { url: URLS.shared, org: "共享机构" }, deps.now());
  const [nomination] = await listNominations(env.PRIVATE_DB, "pending");
  await decideNomination(env.PRIVATE_DB, nomination.id, "approved", deps.now());
  const web = fakeWeb({
    [URLS.userSource]: pageWith("用户来源岗位"),
    [URLS.shared]: pageWith("共享来源岗位"),
    [URLS.public]: pageWith("公开雷达详情"),
    [URLS.official]: pageWith("搜索发现岗位"),
    ...pages,
  });
  const search = fakeSearch(searchMap ?? { "*": [hit(URLS.official, "搜索发现岗位"), hit(URLS.aggregator, "聚合平台岗位")] });
  deps.llm = llm;
  deps.search = search;
  deps.fetch = web;
  return { env, deps, clock, c, scope, goal, llm, search, web };
}
