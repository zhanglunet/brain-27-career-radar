import assert from "node:assert/strict";
import test from "node:test";
import { buildIndex, search, tokenize } from "../lib/wiki/rag.ts";
import {
  CONFIDENCE_WEIGHTS,
  WIKI_FUNDINGS,
  WIKI_OPPORTUNITY_TYPES,
  WIKI_REGIONS,
  validateEntry,
  verdictToConfidence,
} from "../lib/wiki/schema.ts";
import { WIKI_PIPELINE_CONFIG, isDraftOverdue } from "../lib/wiki/pipeline-config.ts";
import { FIXTURE_ENTRIES } from "../lib/wiki/fixtures.ts";

const byId = (id) => FIXTURE_ENTRIES.find((e) => e.id === id);

test("review comment 1：confidence 从审核 verdict 映射，而非“审核过 ⇒ high”", () => {
  assert.equal(verdictToConfidence("confirmed"), "high"); // 证实
  assert.equal(verdictToConfidence("pending"), "medium"); // 待核验
  assert.equal(verdictToConfidence("debunked"), "low"); // 证伪
  assert.equal(verdictToConfidence("rumor"), "low"); // 传闻
});

test("review comment 2：facets 复用 PRD-018 枚举，非法值被校验器拦下", () => {
  assert.deepEqual([...WIKI_REGIONS], ["英国", "中国大陆", "中国香港", "爱尔兰", "全球"]);
  assert.deepEqual([...WIKI_OPPORTUNITY_TYPES], ["phd", "joint_phd", "ra", "campus", "intern", "research"]);
  assert.deepEqual([...WIKI_FUNDINGS], ["full", "partial", "mixed", "self", "tbd"]);
  const bad = {
    ...byId("wiki-ucl-phd-2027"),
    facets: { type: "postdoc", region: "英国", funding: "full" },
  };
  assert.ok(validateEntry(bad).some((i) => i.field === "facets.type"));
});

test("validateEntry：合法条目通过；S1 缺证据 / 正文超长被拦", () => {
  assert.deepEqual(validateEntry(byId("wiki-ucl-phd-2027")), []);
  const noEvidence = { ...byId("wiki-ucl-phd-2027"), d1_evidence: null };
  assert.ok(validateEntry(noEvidence).some((i) => i.field === "d1_evidence"));
  const longBody = { ...byId("wiki-ucl-phd-2027"), body: "啊".repeat(301) };
  assert.ok(validateEntry(longBody).some((i) => i.field === "body"));
});

test("tokenize：中文 bigram + 英文词切分", () => {
  const toks = tokenize("脑机接口 PhD");
  assert.ok(toks.includes("脑机"));
  assert.ok(toks.includes("接口"));
  assert.ok(toks.includes("phd"));
});

test("自然语言查询返回带证据链的结果", () => {
  const index = buildIndex(FIXTURE_ENTRIES);
  const hits = search(index, "脑机接口博士机会");
  assert.ok(hits.length > 0);
  assert.equal(hits[0].entry.id, "wiki-ucl-phd-2027");
  const ev = hits[0].evidence;
  assert.equal(ev.source_url, "https://www.ucl.ac.uk/");
  assert.equal(ev.d1_evidence, "d1://snapshots/ucl-phd-20261017");
  assert.equal(ev.last_verified, "2026-10-17");
});

test("默认只返 active：expired / merged 被过滤", () => {
  const index = buildIndex(FIXTURE_ENTRIES);
  const hits = search(index, "校招 脑科学");
  assert.ok(hits.every((h) => h.entry.status === "active"));
  const expired = search(index, "校招 脑科学", { status: "expired" });
  assert.ok(expired.some((h) => h.entry.id === "wiki-expired-campus"));
});

test("low 可信度默认不进结果，显式打开才纳入", () => {
  const index = buildIndex(FIXTURE_ENTRIES);
  const def = search(index, "脑机接口博士");
  assert.ok(def.every((h) => h.entry.id !== "wiki-rumor-phd"));
  const withLow = search(index, "脑机接口博士", { includeLowConfidence: true });
  assert.ok(withLow.some((h) => h.entry.id === "wiki-rumor-phd"));
});

test("confidence 影响排序：同类文本 high 排在 medium 前", () => {
  const index = buildIndex(FIXTURE_ENTRIES);
  const hits = search(index, "UCL 认知神经科学博士");
  const ids = hits.map((h) => h.entry.id);
  assert.ok(ids.includes("wiki-ucl-phd-2027"));
  assert.ok(ids.includes("wiki-ucl-phd-pending"));
  assert.ok(ids.indexOf("wiki-ucl-phd-2027") < ids.indexOf("wiki-ucl-phd-pending"));
});

test("facets 过滤面：按地区 / 类型过滤", () => {
  const index = buildIndex(FIXTURE_ENTRIES);
  const hk = search(index, "脑", { facets: { region: "中国香港" } });
  assert.ok(hk.length > 0);
  assert.ok(hk.every((h) => h.entry.facets.region === "中国香港"));
  const ra = search(index, "脑", { facets: { type: "ra" } });
  assert.ok(ra.length > 0);
  assert.ok(ra.every((h) => h.entry.facets.type === "ra"));
});

test("空查询返回空数组；limit 生效", () => {
  const index = buildIndex(FIXTURE_ENTRIES);
  assert.deepEqual(search(index, "   "), []);
  const hits = search(index, "脑", { limit: 1, status: "all", includeLowConfidence: true });
  assert.equal(hits.length, 1);
});

test("review comment 3：S2 流水线 owner + SLA 定死在配置里", () => {
  const s2 = WIKI_PIPELINE_CONFIG.dailyReport;
  assert.ok(s2.owner.length > 0);
  assert.equal(s2.slaHours, 24);
  assert.equal(s2.requireHumanConfirm, true);
  assert.equal(
    isDraftOverdue(new Date(Date.now() - 25 * 3600 * 1000).toISOString(), "dailyReport"),
    true,
  );
  assert.equal(isDraftOverdue(new Date().toISOString(), "dailyReport"), false);
});

test("CONFIDENCE_WEIGHTS 单调：high > medium > low", () => {
  assert.ok(CONFIDENCE_WEIGHTS.high > CONFIDENCE_WEIGHTS.medium);
  assert.ok(CONFIDENCE_WEIGHTS.medium > CONFIDENCE_WEIGHTS.low);
});
