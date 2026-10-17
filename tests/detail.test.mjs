import assert from "node:assert/strict";
import test from "node:test";
import { getOpportunityDetail } from "../lib/mcp/detail.ts";

const NOW = "2026-10-17";

function mk(o) {
  return {
    source: "测试来源",
    source_url: "https://example.test/",
    source_type: "d1_snapshot",
    d1_evidence: "d1://snapshots/test",
    confidence: "high",
    created: "2026-10-01",
    last_verified: "2026-10-17",
    status: "active",
    facets: {},
    body: "测试条目正文。",
    ...o,
  };
}

const ENTRIES = [
  mk({
    id: "d-ucl-phd", title: "UCL 认知神经科学博士", org: "UCL",
    facets: { type: "phd", region: "英国", funding: "full", keywords: ["脑机接口"] },
    deadline: "2027-01-08", deadline_kind: "fixed",
    funding_note: "CSC 联合资助，注意学费差额。",
  }),
  mk({
    id: "d-rolling", title: "滚动招聘 RA", org: null,
    confidence: "medium",
    facets: { type: "ra", region: "英国", funding: "mixed", keywords: ["科研助理"] },
    deadline: "rolling", deadline_kind: "rolling",
  }),
  mk({
    id: "d-rumor", title: "某博士项目（传闻）", org: null,
    confidence: "low", source_type: "manual", d1_evidence: null,
    facets: { type: "phd", region: "英国", funding: "tbd", keywords: ["脑机接口"] },
    deadline: null,
  }),
];

test("按 id 返回完整详情：字段齐全 + 证据链 + 截止日解析", () => {
  const r = getOpportunityDetail("d-ucl-phd", ENTRIES, NOW);
  assert.equal(r.found, true);
  const d = r.detail;
  assert.equal(d.id, "d-ucl-phd");
  assert.equal(d.title, "UCL 认知神经科学博士");
  assert.equal(d.body, "测试条目正文。");
  assert.equal(d.org, "UCL");
  // 证据链
  assert.equal(d.source_url, "https://example.test/");
  assert.equal(d.d1_evidence, "d1://snapshots/test");
  // 截止日解析：2027-01-08 距 2026-10-17 为 83 天
  assert.equal(d.deadline, "2027-01-08");
  assert.equal(d.deadline_kind, "fixed");
  assert.equal(d.days_left, 83);
  // 资助
  assert.equal(d.funding, "full");
  assert.equal(d.funding_note, "CSC 联合资助，注意学费差额。");
  // 核验记录
  assert.equal(d.verification.created, "2026-10-01");
  assert.equal(d.verification.last_verified, "2026-10-17");
  assert.ok(d.verification.note.length > 0);
  // 标签原样带出
  assert.deepEqual(d.facets.keywords, ["脑机接口"]);
});

test("不存在的 id 返回 found:false（路由层映射 404），不抛错", () => {
  const r = getOpportunityDetail("no-such-id", ENTRIES, NOW);
  assert.equal(r.found, false);
  assert.equal(r.id, "no-such-id");
});

test("缺失字段按 null 处理，不崩", () => {
  const r = getOpportunityDetail("d-rumor", ENTRIES, NOW);
  assert.equal(r.found, true);
  assert.equal(r.detail.org, null);
  assert.equal(r.detail.d1_evidence, null);
  assert.equal(r.detail.funding_note, null);
  assert.equal(r.detail.deadline, null);
  assert.equal(r.detail.deadline_kind, "tbd");
  assert.equal(r.detail.days_left, null);
});

test("rolling 截止日：kind 为 rolling，days_left 为 null", () => {
  const r = getOpportunityDetail("d-rolling", ENTRIES, NOW);
  assert.equal(r.found, true);
  assert.equal(r.detail.deadline_kind, "rolling");
  assert.equal(r.detail.days_left, null);
});
