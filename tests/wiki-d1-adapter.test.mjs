import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateToEntry,
  KIND_TO_TYPE,
  locationToRegion,
  opportunityToEntry,
  reviewRowToVerdict,
} from "../lib/wiki/d1-adapter.ts";
import { validateEntry } from "../lib/wiki/schema.ts";

const OPP = {
  id: "opp-1",
  source_id: "src-1",
  name: "2027 博士研究生",
  org: "清华大学心理与认知科学系",
  kind: "博士",
  status: "等待开放",
  fit: "高度匹配",
  location: "北京",
  deadline: "2026-11-30",
  why: "最贴近实验心理学、脑影像、认知与智能。",
  action: "现在完成 5000 字研究计划。",
  tags_json: '["心理学","脑影像"]',
  url: "https://www.pcs.tsinghua.edu.cn/info/1031/2141.htm",
  published: 1,
  source_verified_at: "2026-10-16",
  created_at: "2026-10-15 08:00:00",
};

const SOURCES = new Map([
  ["src-1", { id: "src-1", name: "清华 PCS 招生页", url: "https://www.pcs.tsinghua.edu.cn/" }],
]);

test("KIND_TO_TYPE：中文 kind 映射（博士/联培博士/科研助理/校招/实习）", () => {
  assert.equal(KIND_TO_TYPE["博士"], "phd");
  assert.equal(KIND_TO_TYPE["联培博士"], "joint_phd");
  assert.equal(KIND_TO_TYPE["科研助理"], "ra");
  assert.equal(KIND_TO_TYPE["校招"], "campus");
  assert.equal(KIND_TO_TYPE["实习"], "intern");
});

test("locationToRegion：北京→中国大陆；香港/英国/爱尔兰特例", () => {
  assert.equal(locationToRegion("北京"), "中国大陆");
  assert.equal(locationToRegion("深圳"), "中国大陆");
  assert.equal(locationToRegion("香港"), "中国香港");
  assert.equal(locationToRegion("伦敦"), "英国");
  assert.equal(locationToRegion("都柏林"), "爱尔兰");
  assert.equal(locationToRegion("火星"), undefined); // 未知不硬编
  assert.equal(locationToRegion(""), undefined);
});

test("opportunityToEntry：published=1 映射完整，id 双向链接", () => {
  const e = opportunityToEntry(OPP, { sources: SOURCES });
  assert.ok(e);
  assert.equal(e.id, "wiki-d1-opp-opp-1"); // D1 行 id 可反推 wiki id
  assert.equal(e.title, "2027 博士研究生");
  assert.equal(e.source, "清华 PCS 招生页");
  assert.equal(e.source_url, OPP.url);
  assert.equal(e.source_type, "d1_snapshot");
  assert.equal(e.d1_evidence, "d1://opportunities/opp-1");
  assert.equal(e.confidence, "medium"); // 默认待核验
  assert.equal(e.facets.type, "phd");
  assert.equal(e.facets.region, "中国大陆");
  assert.deepEqual(e.facets.keywords, ["心理学", "脑影像"]);
  assert.equal(e.org, "清华大学心理与认知科学系");
  assert.equal(e.deadline, "2026-11-30");
  assert.equal(e.last_verified, "2026-10-16");
  assert.deepEqual(validateEntry(e), []);
});

test("opportunityToEntry：published=0 → null（不入库）", () => {
  assert.equal(opportunityToEntry({ ...OPP, published: 0 }), null);
});

test("opportunityToEntry：verdict 参数决定 confidence", () => {
  const e = opportunityToEntry(OPP, { verdict: "confirmed" });
  assert.equal(e.confidence, "high");
  const e2 = opportunityToEntry(OPP, { verdict: "debunked" });
  assert.equal(e2.confidence, "low");
});

test("candidateToEntry：无 verdict（未审核）→ null（T1 纪律不入库）", () => {
  const row = {
    id: "cand-1",
    source_id: "src-1",
    snapshot_id: "snap-9",
    canonical_url: "https://example.test/x",
    dedupe_key: "k",
    title: "某博士项目",
    org: "某校",
    kind: "博士",
    location: "北京",
    deadline: null,
    opportunity_status: null,
    extracted_json: "{}",
    state: "observed",
    first_seen_at: "2026-10-17 08:00:00",
    last_seen_at: "2026-10-17 08:00:00",
  };
  assert.equal(candidateToEntry(row), null);
  const e = candidateToEntry(row, { verdict: "pending", sources: SOURCES });
  assert.ok(e);
  assert.equal(e.id, "wiki-d1-cand-cand-1");
  assert.equal(e.d1_evidence, "d1://snapshots/snap-9"); // 有快照指快照
  assert.equal(e.confidence, "medium");
  assert.deepEqual(validateEntry(e), []);
});

test("candidateToEntry：无快照时证据指候选行", () => {
  const row = {
    id: "cand-2",
    source_id: "src-1",
    snapshot_id: null,
    canonical_url: "https://example.test/y",
    dedupe_key: "k2",
    title: "另一项目",
    org: "另一校",
    kind: null,
    location: null,
    deadline: null,
    opportunity_status: null,
    extracted_json: "{}",
    state: "observed",
    first_seen_at: "2026-10-17 08:00:00",
    last_seen_at: "2026-10-17 08:00:00",
  };
  const e = candidateToEntry(row, { verdict: "confirmed" });
  assert.equal(e.d1_evidence, "d1://candidates/cand-2");
  assert.equal(e.confidence, "high");
  assert.equal(e.facets.type, undefined); // 未知 kind 不硬编
});

test("reviewRowToVerdict：payload 主信号，reason 兜底，默认 pending", () => {
  const base = { id: "r1", reason: "", payload_json: "{}" };
  assert.equal(reviewRowToVerdict({ ...base, status: "pending" }), "pending");
  assert.equal(
    reviewRowToVerdict({ ...base, status: "resolved", payload_json: '{"verdict":"confirmed"}' }),
    "confirmed",
  );
  assert.equal(
    reviewRowToVerdict({ ...base, status: "resolved", payload_json: '{"verdict":"debunked"}' }),
    "debunked",
  );
  assert.equal(
    reviewRowToVerdict({ ...base, status: "resolved", reason: "经核实为传闻" }),
    "rumor",
  );
  assert.equal(
    reviewRowToVerdict({ ...base, status: "resolved", reason: "xxx", payload_json: "坏json" }),
    "pending",
  );
});
