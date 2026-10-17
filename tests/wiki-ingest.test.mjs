import assert from "node:assert/strict";
import test from "node:test";
import {
  decideDraft,
  draftFromReport,
  ingestApproved,
  overdueDrafts,
  partitionValid,
  pendingDrafts,
  summarizeIngestion,
} from "../lib/wiki/ingest.ts";
import { WIKI_PIPELINE_CONFIG } from "../lib/wiki/pipeline-config.ts";

const REPORT = {
  id: "rep-20261017",
  period_start: "2026-10-17",
  summary: "今日新增 3 个博士机会，2 篇脑机接口论文。",
  highlights: {
    opportunities: ["UCL 认知神经科学博士", "港中文脑成像 RA"],
    sources: ["UCL 官网"],
    papers: ["闭环脑机接口综述"],
  },
  generated_at: "2026-10-17T08:00:00Z",
};

test("draftFromReport：按 highlights 起草（机会+论文），sources 不起草", () => {
  const drafts = draftFromReport(REPORT, "2026-10-17T09:00:00Z");
  assert.equal(drafts.length, 3);
  assert.ok(drafts.every((d) => d.state === "pending"));
  assert.ok(drafts.every((d) => d.reportId === "rep-20261017"));
  assert.ok(
    drafts.every((d) => d.entry.source_type === "daily_report"),
  );
  // 自动起草 = 待核验
  assert.ok(drafts.every((d) => d.entry.confidence === "medium"));
  // 人工需补字段已列出
  assert.ok(drafts[0].needsFields.includes("facets.type"));
});

test("起草的条目通过 validateEntry 校验门", () => {
  const drafts = draftFromReport(REPORT, "2026-10-17T09:00:00Z");
  const { valid, invalid } = partitionValid(drafts);
  assert.equal(valid.length, 3);
  assert.equal(invalid.length, 0);
});

test("校验门拦下坏草稿（空标题，模拟人工编辑后）", () => {
  const drafts = draftFromReport(REPORT, "2026-10-17T09:00:00Z");
  const bad = { ...drafts[0], entry: { ...drafts[0].entry, title: "" } };
  const { valid, invalid } = partitionValid([bad]);
  assert.equal(valid.length, 0);
  assert.equal(invalid.length, 1);
});

test("decideDraft：人工确认（approved/rejected），确认人=owner", () => {
  const drafts = draftFromReport(REPORT, "2026-10-17T09:00:00Z");
  const id = drafts[0].draftId;
  const after = decideDraft(drafts, id, "approved", "2026-10-17T10:00:00Z");
  const d = after.find((x) => x.draftId === id);
  assert.equal(d.state, "approved");
  assert.equal(d.decidedBy, WIKI_PIPELINE_CONFIG.dailyReport.owner);
  assert.equal(d.decidedAt, "2026-10-17T10:00:00Z");
  // 原数组不动
  assert.equal(drafts[0].state, "pending");
  // 未知 id 不动
  assert.deepEqual(decideDraft(drafts, "nope", "approved"), drafts);
});

test("overdueDrafts：超 24h 未确认标 overdue", () => {
  const drafts = draftFromReport(REPORT, "2026-10-16T08:00:00Z");
  const now = new Date("2026-10-17T09:00:01Z"); // 25h 后
  assert.equal(overdueDrafts(drafts, now).length, 3);
  const now2 = new Date("2026-10-16T20:00:00Z"); // 12h 后
  assert.equal(overdueDrafts(drafts, now2).length, 0);
});

test("ingestApproved：只入库已确认且校验通过的", () => {
  let drafts = draftFromReport(REPORT, "2026-10-17T09:00:00Z");
  drafts = decideDraft(drafts, drafts[0].draftId, "approved");
  drafts = decideDraft(drafts, drafts[1].draftId, "rejected");
  const entries = ingestApproved(drafts);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "draft-rep-20261017-opportunity-0");
});

test("summarizeIngestion：汇总数字对得上", () => {
  const drafts = draftFromReport(REPORT, "2026-10-16T08:00:00Z");
  const s = summarizeIngestion(REPORT, drafts, new Date("2026-10-17T09:00:01Z"));
  assert.equal(s.reportId, "rep-20261017");
  assert.equal(s.drafted, 3);
  assert.equal(s.valid, 3);
  assert.equal(s.invalid, 0);
  assert.equal(s.pending, 3);
  assert.equal(s.overdue, 3);
  assert.ok(pendingDrafts(drafts).length === 3);
});
