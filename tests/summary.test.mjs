import assert from "node:assert/strict";
import test from "node:test";
import {
  SUMMARY_NOTICE,
  buildFullList,
  buildStats,
  buildSummary,
  buildUpcoming,
  listOpportunities,
  measureJsonBytes,
} from "../lib/mcp/summary.ts";

const NOW = "2026-10-17";

function mk(o) {
  return {
    source: "测试来源",
    source_url: "https://example.test/",
    source_type: "d1_snapshot",
    d1_evidence: "d1://snapshots/test",
    confidence: "high",
    created: "2026-10-17",
    last_verified: "2026-10-17",
    status: "active",
    facets: {},
    body: "测试条目正文。",
    ...o,
  };
}

// now=2026-10-17 时：e8=8天, e6=15天, e2=44天, e1=83天, e5=过去, e4=estimated, e7=rolling
const ENTRIES = [
  mk({ id: "s-ucl-phd", title: "UCL 认知神经科学博士", org: "UCL",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["脑机接口"] },
    deadline: "2027-01-08", deadline_kind: "fixed" }),
  mk({ id: "s-cuhk-ra", title: "港中文脑成像科研助理", org: "CUHK",
    facets: { type: "ra", region: "中国香港", funding: "partial", keywords: ["脑成像"] },
    deadline: "2026-11-30", deadline_kind: "fixed" }),
  mk({ id: "s-rumor", title: "某英国高校脑机接口博士（传闻）", org: null,
    confidence: "low",
    facets: { type: "phd", region: "英国", funding: "tbd", keywords: ["脑机接口"] },
    deadline: null }),
  mk({ id: "s-ohbm", title: "OHBM 2027 摘要投稿截止", org: "OHBM",
    confidence: "medium",
    facets: { keywords: ["conference", "脑成像"] },
    deadline: "2027-01-15", deadline_kind: "estimated" }),
  mk({ id: "s-expired", title: "2026 秋季校招（已过期）", org: "某校",
    status: "expired",
    facets: { type: "campus", region: "中国大陆", funding: "full", keywords: ["校招"] },
    deadline: "2026-09-01", deadline_kind: "fixed" }),
  mk({ id: "s-noorg", title: "剑桥计算神经科学博士", org: null, // org 缺失 → incomplete 降级
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["计算神经科学"] },
    deadline: "2026-11-01", deadline_kind: "fixed" }),
  mk({ id: "s-rolling", title: "滚动招聘 RA", org: "某所",
    confidence: "medium",
    facets: { type: "ra", region: "英国", funding: "mixed", keywords: ["科研助理"] },
    deadline: "rolling", deadline_kind: "rolling" }),
  mk({ id: "s-ic-phd", title: "帝国理工神经调控博士", org: "Imperial",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["神经调控"] },
    deadline: "2026-10-25", deadline_kind: "fixed" }),
];

test("三段式结构 + 顶部强制标注（T1 防误判 #1）", () => {
  const s = buildSummary(ENTRIES, { nowIso: NOW });
  assert.equal(s.mode, "summary");
  assert.equal(s.notice, SUMMARY_NOTICE);
  assert.equal(s.stats.note, SUMMARY_NOTICE);
  assert.ok(s.stats && s.upcoming && s.drill_down && s.full_list);
  assert.equal(s.drill_down, "GET /opportunities/:id 返回完整详情（含 D1 证据链接、历次核验记录）");
  assert.equal(s.full_list, "GET /opportunities?full=1 返回全量列表（兼容老调用方）");
});

test("统计段：计数与全量一致，各 breakdown 加总等于 total", () => {
  const st = buildStats(ENTRIES);
  assert.equal(st.total, 8);
  for (const k of ["by_type", "by_region", "by_funding"]) {
    const sum = Object.values(st[k]).reduce((a, b) => a + b, 0);
    assert.equal(sum, st.total, k);
  }
  assert.deepEqual(st.by_type, { phd: 4, ra: 2, campus: 1, unknown: 1 });
  assert.deepEqual(st.by_region, { "英国": 5, "中国香港": 1, "中国大陆": 1, unknown: 1 });
  assert.deepEqual(st.by_funding, { full: 4, partial: 1, tbd: 1, mixed: 1, unknown: 1 });
});

test("Top-N 窗口语义：只取 30 天窗口内的 fixed（review comment 1 裁决）", () => {
  const up = buildUpcoming(ENTRIES, { nowIso: NOW });
  // e8=8天, e6=15天 在窗口内；e2=44天, e1=83天 按裁决不在 Top N 内
  assert.deepEqual(up.items.map((i) => i.id), ["s-ic-phd", "s-noorg"]);
  assert.deepEqual(up.items.map((i) => i.days_left), [8, 15]);
  assert.equal(up.top_n, 10);
});

test("incomplete 降级：org 缺失沉底且不丢弃（T1 防误判 #3）", () => {
  const up = buildUpcoming(ENTRIES, { nowIso: NOW });
  const last = up.items[up.items.length - 1];
  assert.equal(last.id, "s-noorg");
  assert.equal(last.incomplete, true);
  assert.ok(!up.items[0].incomplete);
  // 传闻（low）/过期条目不进 Top N
  assert.ok(up.items.every((i) => i.id !== "s-rumor" && i.id !== "s-expired"));
});

test("more_available：Top N 装不下时为 true", () => {
  const up1 = buildUpcoming(ENTRIES, { nowIso: NOW, topN: 1 });
  assert.deepEqual(up1.items.map((i) => i.id), ["s-ic-phd"]);
  assert.equal(up1.more_available, true);
  const upAll = buildUpcoming(ENTRIES, { nowIso: NOW });
  assert.equal(upAll.more_available, false);
});

test("full=true 返回全量列表（T1 §四 ?full=1）", () => {
  const r = listOpportunities(ENTRIES, { full: true, nowIso: NOW });
  assert.equal(r.mode, "full");
  assert.equal(r.total, ENTRIES.length);
  assert.equal(r.items.length, ENTRIES.length);
});

test("默认返回摘要", () => {
  const r = listOpportunities(ENTRIES, { nowIso: NOW });
  assert.equal(r.mode, "summary");
});

test("measureJsonBytes：摘要小于全量（T5 token 断言的测量基础）", () => {
  const sBytes = measureJsonBytes(buildSummary(ENTRIES, { nowIso: NOW }));
  const fBytes = measureJsonBytes(buildFullList(ENTRIES));
  assert.ok(sBytes > 0 && fBytes > 0);
  assert.ok(sBytes < fBytes, `summary=${sBytes} full=${fBytes}`);
});

test("摘要计数可由全量逐项对账（T1 防误判 #2）", () => {
  const s = buildSummary(ENTRIES, { nowIso: NOW });
  const full = buildFullList(ENTRIES);
  const recount = {};
  for (const e of full.items) {
    const k = e.facets.type ?? "unknown";
    recount[k] = (recount[k] ?? 0) + 1;
  }
  assert.deepEqual(s.stats.by_type, recount);
});

test("low/expired 计入统计但不进 Top N", () => {
  const s = buildSummary(ENTRIES, { nowIso: NOW });
  assert.equal(s.stats.total, 8); // s-rumor(low) 与 s-expired(expired) 都计入
  const ids = s.upcoming.items.map((i) => i.id);
  assert.ok(!ids.includes("s-rumor") && !ids.includes("s-expired"));
});
