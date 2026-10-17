import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SUMMARY_CONFIG,
  resolveSummaryConfig,
} from "../lib/mcp/summary-config.ts";
import { listOpportunities } from "../lib/mcp/summary.ts";

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

// now=2026-10-17 时：a=8天内，b=15天内，c=44天外
const ENTRIES = [
  mk({ id: "c-a", title: "A", org: "OA",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["脑机接口"] },
    deadline: "2026-10-25", deadline_kind: "fixed" }),
  mk({ id: "c-b", title: "B", org: "OB",
    facets: { type: "ra", region: "中国香港", funding: "partial", keywords: ["脑成像"] },
    deadline: "2026-11-01", deadline_kind: "fixed" }),
  mk({ id: "c-c", title: "C", org: "OC",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["脑机接口"] },
    deadline: "2026-11-30", deadline_kind: "fixed" }),
];

test("默认配置：enabled=true，topN=10，upcomingDays=30", () => {
  assert.deepEqual(resolveSummaryConfig(), {
    enabled: true,
    topN: 10,
    upcomingDays: 30,
  });
  assert.deepEqual(resolveSummaryConfig({}), DEFAULT_SUMMARY_CONFIG);
});

test("部分覆盖：只改一项，其余走默认", () => {
  assert.deepEqual(resolveSummaryConfig({ topN: 5 }), {
    enabled: true,
    topN: 5,
    upcomingDays: 30,
  });
});

test("非法值抛错", () => {
  assert.throws(() => resolveSummaryConfig({ topN: 0 }), /topN/);
  assert.throws(() => resolveSummaryConfig({ topN: 51 }), /topN/);
  assert.throws(() => resolveSummaryConfig({ topN: 2.5 }), /topN/);
  assert.throws(() => resolveSummaryConfig({ upcomingDays: 0 }), /upcomingDays/);
  assert.throws(() => resolveSummaryConfig({ upcomingDays: 366 }), /upcomingDays/);
  assert.throws(() => resolveSummaryConfig({ enabled: "yes" }), /enabled/);
});

test("开关关闭（enabled=false）→ 回全量列表", () => {
  const r = listOpportunities(ENTRIES, { config: { enabled: false }, nowIso: NOW });
  assert.equal(r.mode, "full");
  assert.equal(r.total, 3);
});

test("full=true 不受开关影响，始终回全量", () => {
  const r = listOpportunities(ENTRIES, {
    full: true,
    config: { enabled: false },
    nowIso: NOW,
  });
  assert.equal(r.mode, "full");
});

test("默认（开关开）→ 摘要模式", () => {
  const r = listOpportunities(ENTRIES, { nowIso: NOW });
  assert.equal(r.mode, "summary");
});

test("自定义 topN 生效", () => {
  const r = listOpportunities(ENTRIES, {
    config: { topN: 1 },
    nowIso: NOW,
  });
  assert.equal(r.mode, "summary");
  assert.ok(r.upcoming.items.length <= 1);
  assert.equal(r.upcoming.top_n, 1);
});

test("自定义 upcomingDays 生效：窗口收窄后条目减少", () => {
  const wide = listOpportunities(ENTRIES, {
    config: { upcomingDays: 30 },
    nowIso: NOW,
  });
  const narrow = listOpportunities(ENTRIES, {
    config: { upcomingDays: 10 },
    nowIso: NOW,
  });
  // 30 天窗口：a(8天)+b(15天)；10 天窗口：仅 a(8天)
  assert.equal(wide.upcoming.items.length, 2);
  assert.equal(narrow.upcoming.items.length, 1);
  assert.equal(narrow.upcoming.items[0].id, "c-a");
});
