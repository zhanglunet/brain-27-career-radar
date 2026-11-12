import assert from "node:assert/strict";
import test from "node:test";
import { planQueries } from "../platform/find/queries.ts";
import { normalizeProfile } from "../platform/profile/schema.ts";
import { fakeLlm } from "./helpers/fake-llm.mjs";

const PROFILE = normalizeProfile({
  basics: { name: "张三（示例）", location: "北京" },
  education: [{ school: "示例大学", degree: "硕士", major: "心理学", period: "2025-2028" }],
  experience: [{ org: "机密实习公司", title: "实习生", period: "2026", highlight: "机密项目细节" }],
  skills: ["Python", "SPSS"],
});
const TARGET = { kinds: ["校招"], directions: ["用户研究"], cities: ["北京", "上海"], timing: "2027 届", notes: null };
const GOAL = { title: "国内校招", description: "互联网用户研究岗" };

test("交给模型的材料不含姓名与经历细节", async () => {
  const llm = fakeLlm([{ queries: ["用户研究 校园招聘 官网"] }]);
  await planQueries(llm, { goal: GOAL, target: TARGET, profile: PROFILE });
  const sent = llm.calls[0].map((m) => m.content).join("\n");
  assert.doesNotMatch(sent, /张三/);
  assert.doesNotMatch(sent, /机密实习公司|机密项目细节/);
  assert.match(sent, /用户研究/);
  assert.match(sent, /心理学/);
  assert.match(sent, /硕士/);
});

test("最多 5 条、去重、截断到 60 字、剔除含姓名的检索词", async () => {
  const llm = fakeLlm([{ queries: ["a 招聘", "a 招聘", "张三（示例） 招聘", "字".repeat(80), "b", "c", "d", "e", "f", 7] }]);
  const queries = await planQueries(llm, { goal: GOAL, target: TARGET, profile: PROFILE });
  assert.equal(queries.length, 5);
  assert.equal(new Set(queries).size, 5);
  assert.ok(queries.every((q) => [...q].length <= 60));
  assert.ok(!queries.some((q) => q.includes("张三")));
});

test("模型返回空时用目标画像兜底", async () => {
  const queries = await planQueries(fakeLlm([{ queries: [] }]), { goal: GOAL, target: TARGET, profile: null });
  assert.ok(queries.length >= 1 && queries.length <= 3);
  assert.ok(queries.every((q) => q.includes("用户研究")));
  assert.ok(queries.some((q) => q.includes("北京")));
});

test("没有画像也没有模型输出时，用目标标题兜底", async () => {
  const queries = await planQueries(fakeLlm([{}]), { goal: GOAL, target: { kinds: [], directions: [], cities: [], timing: null, notes: null }, profile: null });
  assert.deepEqual(queries, ["国内校招 招聘 官网"]);
});

test("提示词包含小写 json，并要求找官方页面", async () => {
  const llm = fakeLlm([{ queries: ["x"] }]);
  await planQueries(llm, { goal: GOAL, target: TARGET, profile: PROFILE });
  assert.ok(llm.calls[0][0].content.includes("json"));
  assert.match(llm.calls[0][0].content, /官方/);
});
