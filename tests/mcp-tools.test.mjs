/**
 * PRD-018/T2+T3 · 只读 MCP tools 测试（trend #72 / #73）。
 * 合成数据 + 固定 now（2026-10-17），保证确定性；绝不碰生产数据。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_TOOLS,
  SEARCH_OPPORTUNITIES_TOOL,
  UPCOMING_DEADLINES_TOOL,
  WIKI_DIRECTIONS,
  McpError,
  dispatchToolCall,
  encodeCursor,
  decodeCursor,
  handleSearchOpportunities,
  handleUpcomingDeadlines,
} from "../lib/mcp/tools.ts";
import {
  WIKI_FUNDINGS,
  WIKI_OPPORTUNITY_TYPES,
  WIKI_REGIONS,
} from "../lib/wiki/schema.ts";
import { FIXTURE_ENTRIES } from "../lib/wiki/fixtures.ts";
import { daysUntil, parseDeadline } from "../lib/mcp/deadlines.ts";

const NOW = "2026-10-17";
const ctx = (entries, now = NOW) => ({ entries, now });
const byId = (id) => FIXTURE_ENTRIES.find((e) => e.id === id);

// 带截止日的合成条目（MCP 扩展字段；D1 真实映射由 PRD-017/T5 实现）
const DL_ENTRIES = [
  { ...byId("wiki-ucl-phd-2027"), org: "UCL", deadline: "2027-01-08", deadline_kind: "fixed", funding_note: "CSC 联合资助" },
  { ...byId("wiki-cuhk-ra-2026"), org: "CUHK", deadline: "2026-11-30", deadline_kind: "fixed" },
  { ...byId("wiki-ohbm-2027"), org: "OHBM", deadline: "2027-01-15", deadline_kind: "estimated" },
  {
    id: "wiki-rolling-x", title: "测试大学脑机接口博士（滚动申请）", source: "测试", source_url: "https://example.test/",
    source_type: "manual", d1_evidence: null, confidence: "high", created: "2026-10-01",
    last_verified: "2026-10-10", status: "active",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["脑机接口"] },
    body: "滚动申请，全年可投。", org: "测试大学", deadline: "rolling", deadline_kind: "rolling",
  },
  {
    id: "wiki-tbd-x", title: "测试会议（日期待确认）", source: "测试", source_url: "https://example.test/",
    source_type: "manual", d1_evidence: null, confidence: "medium", created: "2026-10-01",
    last_verified: "2026-10-10", status: "active",
    facets: { keywords: ["conference"] }, body: "日期待确认。",
    org: "测试会议", deadline: "tbd", deadline_kind: "tbd",
  },
  {
    id: "wiki-past-x", title: "已过截止的校招", source: "测试", source_url: "https://example.test/",
    source_type: "manual", d1_evidence: null, confidence: "high", created: "2026-08-01",
    last_verified: "2026-09-01", status: "active",
    facets: { type: "campus", region: "中国大陆", funding: "full", keywords: ["校招"] },
    body: "已于 9 月截止。", org: "测试公司", deadline: "2026-09-01", deadline_kind: "fixed",
  },
];

test("tool schemas：枚举与 PRD-018 定义逐字一致", () => {
  assert.equal(MCP_TOOLS.length, 2);
  const s1 = SEARCH_OPPORTUNITIES_TOOL.inputSchema.properties;
  assert.deepEqual([...s1.region.enum], [...WIKI_REGIONS]);
  assert.deepEqual([...s1.type.enum], [...WIKI_OPPORTUNITY_TYPES]);
  assert.deepEqual([...s1.funding.enum], [...WIKI_FUNDINGS]);
  assert.deepEqual([...s1.direction.enum], [...WIKI_DIRECTIONS]);
  const s2 = UPCOMING_DEADLINES_TOOL.inputSchema.properties;
  assert.equal(s2.days.default, 30);
  assert.deepEqual([...s2.direction.enum], [...WIKI_DIRECTIONS]);
});

test("deadlines：daysUntil 按 UTC 日期算", () => {
  assert.equal(daysUntil("2026-11-30", NOW), 44);
  assert.equal(daysUntil("2027-01-08", NOW), 83);
  assert.equal(daysUntil("2026-09-01", NOW), -46);
  assert.equal(daysUntil("rolling", NOW), null);
  const r = parseDeadline("rolling");
  assert.equal(r.kind, "rolling");
  assert.equal(parseDeadline(null).kind, "tbd");
  assert.equal(parseDeadline("2027-01-08").kind, "fixed");
});

test("search_opportunities：方向查询命中 top1 且带证据链", () => {
  const res = handleSearchOpportunities({ direction: "脑机接口" }, ctx(FIXTURE_ENTRIES));
  assert.ok(res.total > 0);
  assert.equal(res.opportunities[0].id, "wiki-ucl-phd-2027");
  const o = res.opportunities[0];
  assert.equal(o.evidence_url, "https://www.ucl.ac.uk/");
  assert.equal(o.confidence, "high");
  assert.equal(o.last_verified, "2026-10-17");
  // FIXTURE_ENTRIES 无 deadline 扩展字段 → 按 "tbd" 处理，不编造
  assert.equal(o.deadline, "tbd");
  assert.equal(o.deadline_kind, "tbd");
  // 带 deadline 扩展字段的条目 → 原样透出
  const withDl = handleSearchOpportunities({ direction: "脑机接口" }, ctx(DL_ENTRIES));
  const ucl = withDl.opportunities.find((x) => x.id === "wiki-ucl-phd-2027");
  assert.equal(ucl.deadline, "2027-01-08");
  assert.equal(ucl.deadline_kind, "fixed");
  assert.equal(ucl.org, "UCL");
  assert.equal(ucl.funding_note, "CSC 联合资助");
});

test("search_opportunities：facets 过滤 + 传闻默认不进结果", () => {
  const res = handleSearchOpportunities({ type: "ra" }, ctx(FIXTURE_ENTRIES));
  assert.ok(res.total > 0);
  assert.ok(res.opportunities.every((o) => o.type === "ra"));
  const all = handleSearchOpportunities({ direction: "脑机接口" }, ctx(FIXTURE_ENTRIES));
  assert.ok(all.opportunities.every((o) => o.id !== "wiki-rumor-phd"));
});

test("search_opportunities：无 direction 时为列表模式", () => {
  const res = handleSearchOpportunities({}, ctx(FIXTURE_ENTRIES));
  assert.ok(res.total > 0);
  assert.ok(res.opportunities.every((o) => o.confidence !== "low"));
});

test("search_opportunities：非法参数 400 并附合法值", () => {
  assert.throws(() => handleSearchOpportunities({ region: "美国" }, ctx(FIXTURE_ENTRIES)),
    (e) => e instanceof McpError && e.code === 400 && e.data.allowed.includes("英国"));
  assert.throws(() => handleSearchOpportunities({ direction: "BCI" }, ctx(FIXTURE_ENTRIES)),
    (e) => e instanceof McpError && e.code === 400 && e.data.allowed.includes("脑机接口"));
  assert.throws(() => handleSearchOpportunities({ limit: 99 }, ctx(FIXTURE_ENTRIES)),
    (e) => e instanceof McpError && e.code === 400);
});

test("search_opportunities：cursor 翻页无重叠无遗漏", () => {
  const p1 = handleSearchOpportunities({ limit: 2 }, ctx(FIXTURE_ENTRIES));
  assert.ok(p1.next_cursor);
  const p2 = handleSearchOpportunities({ limit: 2, cursor: p1.next_cursor }, ctx(FIXTURE_ENTRIES));
  const ids1 = p1.opportunities.map((o) => o.id);
  const ids2 = p2.opportunities.map((o) => o.id);
  assert.equal(new Set([...ids1, ...ids2]).size, ids1.length + ids2.length);
  assert.equal(p1.total, p2.total);
  assert.throws(() => handleSearchOpportunities({ cursor: "not-a-cursor!!" }, ctx(FIXTURE_ENTRIES)),
    (e) => e instanceof McpError && e.code === 400);
  assert.equal(decodeCursor(encodeCursor("abc")), "abc");
});

test("upcoming_deadlines：分组排序符合 T1 §三", () => {
  const res = handleUpcomingDeadlines({ days: 90 }, ctx(DL_ENTRIES));
  assert.equal(res.total, 6);
  const groups = res.items.map((i) => i.group);
  assert.deepEqual(groups, ["upcoming", "upcoming", "past", "estimated", "rolling", "tbd"]);
  assert.equal(res.items[0].id, "wiki-cuhk-ra-2026");
  assert.equal(res.items[0].days_left, 44);
  assert.equal(res.items[1].id, "wiki-ucl-phd-2027");
  assert.equal(res.items[1].days_left, 83);
  assert.equal(res.items[3].days_left, 90); // estimated
  assert.equal(res.items[4].days_left, null); // rolling
  assert.equal(res.items[5].days_left, null); // tbd
});

test("upcoming_deadlines：条目带 confidence + last_verified（review comment 1）", () => {
  const res = handleUpcomingDeadlines({ days: 90 }, ctx(DL_ENTRIES));
  for (const i of res.items) {
    assert.ok(i.confidence, i.id);
    assert.ok(i.last_verified, i.id);
    assert.ok(i.evidence_url, i.id);
  }
});

test("upcoming_deadlines：by_month 聚合 + days 窗口", () => {
  const res = handleUpcomingDeadlines({ days: 90 }, ctx(DL_ENTRIES));
  assert.deepEqual(res.by_month, { "2026-09": 1, "2026-11": 1, "2027-01": 2 });
  const narrow = handleUpcomingDeadlines({ days: 30 }, ctx(DL_ENTRIES));
  assert.ok(narrow.items.every((i) => i.group !== "upcoming"));
  assert.ok(narrow.items.some((i) => i.group === "fixed")); // 窗口外 fixed 仍可见，不静默丢弃
});

test("upcoming_deadlines：direction 过滤", () => {
  const res = handleUpcomingDeadlines({ days: 365, direction: "脑机接口" }, ctx(DL_ENTRIES));
  assert.ok(res.total > 0);
  assert.ok(res.items.every((i) => ["wiki-ucl-phd-2027", "wiki-rolling-x"].includes(i.id)));
});

test("upcoming_deadlines：cursor 翻页", () => {
  const p1 = handleUpcomingDeadlines({ days: 90, limit: 2 }, ctx(DL_ENTRIES));
  assert.ok(p1.next_cursor);
  const p2 = handleUpcomingDeadlines({ days: 90, limit: 2, cursor: p1.next_cursor }, ctx(DL_ENTRIES));
  assert.equal(p2.items[0].group, "past");
  assert.equal(p1.total, p2.total);
});

test("dispatchToolCall：未知 tool 400", () => {
  assert.throws(() => dispatchToolCall("delete_everything", {}, ctx([])),
    (e) => e instanceof McpError && e.code === 400);
  const r = dispatchToolCall("search_opportunities", { limit: 1 }, ctx(FIXTURE_ENTRIES));
  assert.equal(r.opportunities.length, 1);
});
