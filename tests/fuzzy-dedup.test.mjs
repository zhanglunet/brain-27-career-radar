import assert from "node:assert/strict";
import test from "node:test";
import {
  FUZZY_DEADLINE_WINDOW_DAYS,
  FUZZY_SIM_THRESHOLD,
  fuzzyDedupe,
  isFuzzyDuplicate,
  normalizeOrg,
  splitMerge,
  titleSimilarity,
} from "../lib/wiki/fuzzy-dedup.ts";
import { validateEntry } from "../lib/wiki/schema.ts";

const base = {
  source_url: "https://example.edu/a",
  source_type: "daily_report",
  d1_evidence: null,
  created: "2026-10-17",
  status: "active",
  facets: { type: "phd", region: "英国", funding: "full", keywords: [] },
  body: "招生简章",
  confidence: "medium",
  last_verified: "2026-10-17",
};

const mk = (over) => ({ ...base, ...over });

const orgOf = (map) => (e) => map.get(e.id) ?? null;
const deadlineOf = (map) => (e) => map.get(e.id) ?? null;

// ── normalizeOrg ────────────────────────────────────────────────────────

test("normalizeOrg：白名单变体归一到同一 canonical", () => {
  assert.equal(normalizeOrg("UCL"), "ucl");
  assert.equal(normalizeOrg("伦敦大学学院"), "ucl");
  assert.equal(normalizeOrg("University College London"), "ucl");
  assert.equal(normalizeOrg("  University College London  "), "ucl");
  assert.equal(normalizeOrg("U.C.L."), "ucl");
});

test("normalizeOrg：未知机构原样返回，不编造", () => {
  assert.equal(normalizeOrg("某不知名研究院"), "某不知名研究院");
});

// ── titleSimilarity ─────────────────────────────────────────────────────

test("titleSimilarity：相同=1，无关≈0，空=0", () => {
  assert.equal(titleSimilarity("UCL 脑机接口博士奖学金", "UCL 脑机接口博士奖学金"), 1);
  assert.ok(titleSimilarity("UCL 脑机接口博士奖学金", "清华 机器人实习") < 0.3);
  assert.equal(titleSimilarity("", "abc"), 0);
  assert.equal(titleSimilarity("", ""), 0);
});

test("titleSimilarity：意译高分（0.818 ≥ 0.8）", () => {
  const sim = titleSimilarity("UCL 脑机接口博士奖学金", "UCL 脑机接口博士奖学金项目");
  assert.ok(sim >= FUZZY_SIM_THRESHOLD, `sim=${sim}`);
});

// ── isFuzzyDuplicate ────────────────────────────────────────────────────

const dupPair = () => {
  const e1 = mk({ id: "d1", title: "脑机接口博士奖学金 2026", source: "UCL 官网" });
  const e2 = mk({ id: "d2", title: "脑机接口博士奖学金 2026", source: "学术桥" });
  const orgs = new Map([["d1", "UCL"], ["d2", "伦敦大学学院"]]);
  const dls = new Map([["d1", "2026-12-01"], ["d2", "2026-12-01"]]);
  return { e1, e2, opts: { orgOf: orgOf(orgs), deadlineOf: deadlineOf(dls) } };
};

test("isFuzzyDuplicate：同机构归一化+同标题+同截止日 → 重复", () => {
  const { e1, e2, opts } = dupPair();
  const r = isFuzzyDuplicate(e1, e2, opts);
  assert.equal(r.duplicate, true);
  assert.equal(r.evidence.reason, "match");
  assert.equal(r.evidence.normalizedOrg, "ucl");
  assert.equal(r.evidence.similarity, 1);
});

test("isFuzzyDuplicate：机构不同 → 不并", () => {
  const { e1, e2, opts } = dupPair();
  const orgs = new Map([["d1", "UCL"], ["d2", "MIT"]]);
  const r = isFuzzyDuplicate(e1, e2, { ...opts, orgOf: orgOf(orgs) });
  assert.equal(r.duplicate, false);
  assert.equal(r.evidence.reason, "org_mismatch");
});

test("isFuzzyDuplicate：无 orgOf → fail-closed 不并", () => {
  const { e1, e2 } = dupPair();
  const r = isFuzzyDuplicate(e1, e2, {});
  assert.equal(r.duplicate, false);
  assert.equal(r.evidence.reason, "org_unknown");
});

test("isFuzzyDuplicate：同机构近似标题但类型不同（博士 vs RA）→ 不并", () => {
  const { e1, e2, opts } = dupPair();
  const e2ra = { ...e2, facets: { ...e2.facets, type: "ra" } };
  const r = isFuzzyDuplicate(e1, e2ra, opts);
  assert.equal(r.duplicate, false);
  assert.equal(r.evidence.reason, "type_mismatch");
});

test("isFuzzyDuplicate：博士 vs 博士后近似标题 → 相似度不足不并", () => {
  const { e1, opts } = dupPair();
  const e3 = mk({ id: "d3", title: "UCL 博士后奖学金 2026" });
  const e1t = mk({ id: "d1", title: "UCL 博士奖学金 2026" });
  const orgs = new Map([["d1", "UCL"], ["d3", "UCL"]]);
  const r = isFuzzyDuplicate(e1t, e3, { ...opts, orgOf: orgOf(orgs) });
  assert.ok(r.evidence.similarity < FUZZY_SIM_THRESHOLD, `sim=${r.evidence.similarity}`);
  assert.equal(r.duplicate, false);
  assert.equal(r.evidence.reason, "similarity_below_threshold");
});

test("isFuzzyDuplicate：同名不同届（截止日差一年）→ 不并", () => {
  const { e1, e2, opts } = dupPair();
  const dls = new Map([["d1", "2026-12-01"], ["d2", "2027-12-01"]]);
  const r = isFuzzyDuplicate(e1, e2, { ...opts, deadlineOf: deadlineOf(dls) });
  assert.equal(r.duplicate, false);
  assert.equal(r.evidence.reason, "deadline_window_exceeded");
});

test("isFuzzyDuplicate：截止日在 30 天窗口内 → 并", () => {
  const { e1, e2, opts } = dupPair();
  const dls = new Map([["d1", "2026-12-01"], ["d2", "2026-12-20"]]);
  const r = isFuzzyDuplicate(e1, e2, { ...opts, deadlineOf: deadlineOf(dls) });
  assert.equal(r.duplicate, true);
});

test("isFuzzyDuplicate：一方截止日未知 → 放行（机构+相似度把关）", () => {
  const { e1, e2, opts } = dupPair();
  const dls = new Map([["d1", "2026-12-01"]]);
  const r = isFuzzyDuplicate(e1, e2, { ...opts, deadlineOf: deadlineOf(dls) });
  assert.equal(r.duplicate, true);
});

test("isFuzzyDuplicate：双方 rolling → 放行", () => {
  const { e1, e2, opts } = dupPair();
  const dls = new Map([["d1", "rolling"], ["d2", "rolling"]]);
  const r = isFuzzyDuplicate(e1, e2, { ...opts, deadlineOf: deadlineOf(dls) });
  assert.equal(r.duplicate, true);
});

test("isFuzzyDuplicate：阈值选项生效（0.818 在 0.8 下并、在 0.95 下不并）", () => {
  const orgs = new Map([["p1", "UCL"], ["p2", "UCL"]]);
  const e1 = mk({ id: "p1", title: "UCL 脑机接口博士奖学金" });
  const e2 = mk({ id: "p2", title: "UCL 脑机接口博士奖学金项目" });
  const o = { orgOf: orgOf(orgs) };
  assert.equal(isFuzzyDuplicate(e1, e2, o).duplicate, true);
  const r = isFuzzyDuplicate(e1, e2, { ...o, simThreshold: 0.95 });
  assert.equal(r.duplicate, false);
  assert.equal(r.evidence.reason, "similarity_below_threshold");
});

test("常量：阈值 0.8、窗口 30 天", () => {
  assert.equal(FUZZY_SIM_THRESHOLD, 0.8);
  assert.equal(FUZZY_DEADLINE_WINDOW_DAYS, 30);
});

// ── fuzzyDedupe ─────────────────────────────────────────────────────────

const mixedFixture = () => {
  const e1 = mk({
    id: "m1", title: "脑机接口博士奖学金 2026", source: "UCL 官网",
    source_url: "https://ucl.ac.uk/a", confidence: "high", last_verified: "2026-10-17",
  });
  const e2 = mk({
    id: "m2", title: "脑机接口博士奖学金 2026", source: "学术桥",
    source_url: "https://bridge.example/b", confidence: "medium", last_verified: "2026-10-10",
  });
  const e3 = mk({
    id: "m3", title: "清华 机器人方向实习", source: "清华就业网",
    facets: { type: "intern", region: "中国大陆", funding: "self", keywords: [] },
  });
  const e4 = mk({
    id: "m4", title: "脑机接口博士奖学金 2026", source: "UCL 官网",
    source_url: "https://ucl.ac.uk/a",
  });
  const orgs = new Map([["m1", "UCL"], ["m2", "伦敦大学学院"], ["m3", "清华大学"], ["m4", "UCL"]]);
  const dls = new Map([["m1", "2026-12-01"], ["m2", "2026-12-01"], ["m4", "2027-12-01"]]);
  return { entries: [e1, e2, e3, e4], opts: { orgOf: orgOf(orgs), deadlineOf: deadlineOf(dls) } };
};

test("fuzzyDedupe：跨来源合并，多源证据链完整，合并条目待人工确认", () => {
  const { entries, opts } = mixedFixture();
  const { entries: out, merged, merges } = fuzzyDedupe(entries, opts);

  assert.equal(merges.length, 1);
  assert.equal(merges[0].keptId, "m1"); // last_verified 最新
  assert.deepEqual(merges[0].mergedIds, ["m2"]);
  assert.equal(merges[0].normalizedOrg, "ucl");

  assert.equal(merged.length, 1);
  const m = merged[0];
  assert.equal(m.id, "m1");
  assert.equal(m.source, "UCL 官网"); // source: string 本体不动
  assert.deepEqual(m.sources, ["UCL 官网", "学术桥"]);
  assert.deepEqual(m.sourceUrls, ["https://ucl.ac.uk/a", "https://bridge.example/b"]);
  assert.equal(m.needsReview, true);
  assert.deepEqual(m.mergeEvidence.mergedIds, ["m2"]);
  assert.equal(m.mergeEvidence.keptId, "m1");
  assert.equal(m.mergeEvidence.similarities.length, 1);
  assert.deepEqual(validateEntry(m), []); // 仍是合法 WikiEntry

  // entries 数组：kept 被合成条目替换，m2 标 merged，m3/m4 不动
  const byId = new Map(out.map((e) => [e.id, e]));
  assert.equal(byId.get("m1").needsReview, true);
  assert.equal(byId.get("m2").status, "merged");
  assert.equal(byId.get("m3").status, "active");
  assert.equal(byId.get("m4").status, "active"); // 不同届不并
});

test("fuzzyDedupe：无 orgOf → fail-closed，一个不并", () => {
  const { entries } = mixedFixture();
  const r = fuzzyDedupe(entries, {});
  assert.equal(r.merges.length, 0);
  assert.equal(r.merged.length, 0);
  assert.deepEqual(r.entries.map((e) => e.id), ["m1", "m2", "m3", "m4"]);
});

test("splitMerge：合并可拆分回滚，原始条目恢复", () => {
  const { entries, opts } = mixedFixture();
  const { merged } = fuzzyDedupe(entries, opts);
  const restored = splitMerge(merged[0]);
  assert.equal(restored.length, 2);
  const byId = new Map(restored.map((e) => [e.id, e]));
  assert.equal(byId.get("m1").source, "UCL 官网");
  assert.equal(byId.get("m2").source, "学术桥");
  assert.ok(restored.every((e) => e.status === "active"));
  assert.ok(!("needsReview" in byId.get("m1")));
});
