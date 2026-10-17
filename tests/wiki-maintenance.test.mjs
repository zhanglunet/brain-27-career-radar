import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeEntries,
  dedupeKey,
  detectConflicts,
  markExpired,
  runMaintenance,
} from "../lib/wiki/maintenance.ts";

const base = {
  source: "UCL 官网博士招生页",
  source_url: "https://www.ucl.ac.uk/",
  source_type: "d1_snapshot",
  d1_evidence: "d1://opportunities/ucl-1",
  created: "2026-10-17",
  status: "active",
  facets: { type: "phd", region: "英国", funding: "full", keywords: [] },
  body: "x",
};

const e1 = {
  ...base,
  id: "a1",
  title: "UCL 认知神经科学博士",
  confidence: "medium",
  last_verified: "2026-10-10",
};
const e2 = {
  ...base,
  id: "a2",
  title: "UCL  认知神经科学博士 ", // 空白差异 → 同一条
  confidence: "high",
  last_verified: "2026-10-17",
};
const e3 = {
  ...base,
  id: "b1",
  title: "港中文脑成像 RA",
  facets: { type: "ra", region: "中国香港", keywords: [] },
  confidence: "high",
  last_verified: "2026-10-16",
};

const deadlineOf = (deadlines) => (e) => deadlines[e.id] ?? null;

test("dedupeKey：标题归一化（大小写/空白不敏感）", () => {
  assert.equal(dedupeKey(e1), dedupeKey(e2));
  assert.notEqual(dedupeKey(e1), dedupeKey(e3));
});

test("dedupeEntries：重复条目合并，保留 last_verified 最新者", () => {
  const { entries, merges } = dedupeEntries([e1, e2, e3]);
  assert.equal(merges.length, 1);
  assert.equal(merges[0].keptId, "a2");
  assert.deepEqual(merges[0].mergedIds, ["a1"]);
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(byId.a1.status, "merged");
  assert.equal(byId.a2.status, "active");
  assert.equal(byId.b1.status, "active");
});

test("dedupeEntries：confidence 并列时取高者", () => {
  const x = { ...e1, id: "x1", last_verified: "2026-10-17", confidence: "low" };
  const y = { ...e2, id: "x2", last_verified: "2026-10-17", confidence: "high" };
  const { merges } = dedupeEntries([x, y]);
  assert.equal(merges[0].keptId, "x2");
});

test("markExpired：过去的 fixed 截止 → expired；未来/rolling 不动", () => {
  const dl = deadlineOf({ a1: "2026-09-01", b1: "2027-01-08" });
  const rolling = { ...e3, id: "c1" };
  const dl2 = (e) => (e.id === "c1" ? "rolling" : dl(e));
  const { entries, expiredIds } = markExpired([e1, e3, rolling], "2026-10-17", dl2);
  assert.deepEqual(expiredIds, ["a1"]);
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(byId.a1.status, "expired"); // 保留可追溯
  assert.equal(byId.b1.status, "active");
  assert.equal(byId.c1.status, "active");
});

test("markExpired：无 deadlineOf 时原样返回", () => {
  const { entries, expiredIds } = markExpired([e1], "2026-10-17");
  assert.deepEqual(expiredIds, []);
  assert.equal(entries[0].status, "active");
});

test("detectConflicts：同一机会多种截止日 → 报告", () => {
  const d1 = { ...e1, id: "d1" };
  const d2 = { ...e2, id: "d2" }; // 同 key（标题归一后）
  const dl = deadlineOf({ d1: "2027-01-08", d2: "2027-02-01" });
  const conflicts = detectConflicts([d1, d2], dl);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, "deadline_mismatch");
  assert.deepEqual(conflicts[0].entryIds.sort(), ["d1", "d2"]);
});

test("detectConflicts：截止日一致 → 无矛盾", () => {
  const dl = deadlineOf({ a1: "2027-01-08", a2: "2027-01-08" });
  assert.deepEqual(detectConflicts([e1, e2], dl), []);
});

test("runMaintenance：端到端（去重+过期+报告）", () => {
  const dup = { ...e1, id: "z1" }; // 与 e2 同 key（含截止日）
  const dl = deadlineOf({ z1: "2027-01-08", a2: "2027-01-08", b1: "2026-09-01" });
  const { entries, report } = runMaintenance([dup, e2, e3], {
    nowIso: "2026-10-17",
    deadlineOf: dl,
  });
  assert.equal(report.total, 3);
  assert.equal(report.merges.length, 1);
  assert.deepEqual(report.merges[0].mergedIds, ["z1"]);
  assert.deepEqual(report.expiredIds, ["b1"]); // b1 截止日已过 → expired
  assert.equal(report.changed, 2);
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(byId.z1.status, "merged");
  assert.equal(byId.a2.status, "active");
  assert.equal(byId.b1.status, "expired");
});

test("去重键含截止日：同标题不同截止日不合并（走矛盾检测）", () => {
  const v1 = { ...e1, id: "v1" };
  const v2 = { ...e2, id: "v2" };
  const dl = deadlineOf({ v1: "2027-01-08", v2: "2027-02-01" });
  const { merges } = dedupeEntries([v1, v2], dl);
  assert.equal(merges.length, 0); // key 不同 → 不合并
  assert.equal(detectConflicts([v1, v2], dl).length, 1); // 但报矛盾
});
