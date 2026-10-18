import assert from "node:assert/strict";
import test from "node:test";
import {
  runAutoOrganize,
  initialPipelineState,
} from "../lib/wiki/auto-organize.ts";
import { CLASSIFY_RULE_VERSION } from "../lib/wiki/classifier.ts";

function makeEntry({
  id,
  title,
  body = "",
  source = "测试来源",
  last_verified = "2026-10-18",
  facets = {},
  org = null,
}) {
  const e = {
    id,
    title,
    source,
    source_url: "",
    source_type: "daily_report",
    d1_evidence: null,
    confidence: "medium",
    created: "2026-10-18",
    last_verified,
    status: "active",
    facets,
    body,
  };
  if (org) e.org = org; // McpOpportunity 扩展层形态，供 orgOf 读取
  return e;
}

const orgOf = (e) => e.org ?? null;
const deadlineOf = () => null; // 截止日未知 → 跳过窗口检查
const accessors = { orgOf, deadlineOf };

function scenario() {
  // A：主条目（UCL 脑机接口博士奖学金）
  const a = makeEntry({
    id: "a",
    title: "UCL 脑机接口博士奖学金",
    body: "UCL 脑机接口方向博士招生",
    source: "UCL 官网",
    last_verified: "2026-10-18",
    facets: { keywords: ["脑机接口"] },
    org: "UCL",
  });
  // B：A 的精确重复（同标题同源，last_verified 更旧 → 被吸收）
  const b = makeEntry({
    id: "b",
    title: "UCL 脑机接口博士奖学金",
    body: "UCL 脑机接口方向博士招生",
    source: "UCL 官网",
    last_verified: "2026-10-17",
    facets: { keywords: ["脑机接口"] },
    org: "UCL",
  });
  // C：A 的跨来源模糊重复（机构名写法不同、标题措辞微差，相似度 0.947）
  const c = makeEntry({
    id: "c",
    title: "UCL 脑机接口博士奖学金（2026）",
    body: "伦敦大学学院脑机接口博士项目",
    source: "留学资讯",
    last_verified: "2026-10-17",
    facets: { keywords: ["脑机接口"] },
    org: "UCL",
  });
  // D：低置信条目（只有 L3 命中 → needsReview）
  const d = makeEntry({
    id: "d",
    title: "会议通知",
    body: "脑机接口研讨会",
    source: "某学会",
    last_verified: "2026-10-18",
    facets: { keywords: ["脑机接口"] },
  });
  // 历史：H1 同机构(UCL)，H2 同领域(脑机接口)
  const h1 = makeEntry({
    id: "h1",
    title: "UCL 神经调控博士项目",
    last_verified: "2026-09-01",
    facets: { keywords: ["神经调控"] },
    org: "UCL",
  });
  const h2 = makeEntry({
    id: "h2",
    title: "脑机接口产业动态",
    last_verified: "2026-09-15",
    facets: { keywords: ["脑机接口"] },
    org: "某媒体",
  });
  return { drafts: [a, b, c, d], history: [h1, h2] };
}

const NOW = "2026-10-18T12:00:00Z";

// ── 阶段顺序：归类 → 精确去重 → 模糊去重 → 关联 → 待确认 ────────────────

test("全流水线：阶段顺序与输出形态", () => {
  const { drafts, history } = scenario();
  const historySnapshot = JSON.stringify(history);
  const r = runAutoOrganize({
    drafts,
    history,
    state: initialPipelineState(),
    accessors,
    nowIso: NOW,
  });

  assert.equal(r.stats.received, 4);
  assert.equal(r.stats.processed, 4);
  assert.equal(r.stats.skipped, 0);
  assert.equal(r.stats.fullRecompute, true); // 首轮（ruleVersion "" → "0.1"）

  // pending：A（模糊合并复合体）+ D；B 精确吸收、C 模糊吸收
  const ids = r.pending.map((p) => p.id).sort();
  assert.deepEqual(ids, ["a", "d"]);

  // 精确去重：B 被吸收
  const bDrop = r.dropped.find((x) => x.id === "b");
  assert.equal(bDrop.reason, "exact_duplicate");
  assert.equal(bDrop.keptId, "a");
  assert.equal(r.stats.exactMerges, 1);

  // 模糊去重：C 被吸收进 A 的复合体，证据链完整
  const cDrop = r.dropped.find((x) => x.id === "c");
  assert.equal(cDrop.reason, "fuzzy_absorbed");
  assert.equal(cDrop.keptId, "a");
  assert.equal(r.stats.fuzzyMerges, 1);
  const aItem = r.pending.find((p) => p.id === "a");
  assert.ok(aItem.sources.includes("UCL 官网"));
  assert.ok(aItem.sources.includes("留学资讯"));
  assert.deepEqual(aItem.mergeEvidence.mergedIds, ["c"]);
  assert.ok(aItem.reviewReasons.includes("fuzzy_merged"));
  assert.equal(aItem.needsReview, true);

  // 归类：A 挂上三层分类
  assert.equal(aItem.classification.l1, "高校");
  assert.equal(aItem.classification.l2, "phd");
  assert.ok(aItem.classification.l3.includes("脑机接口"));

  // 关联：A 挂出同机构(H1)与同领域(H2)
  const rels = aItem.related;
  assert.ok(rels.some((l) => l.id === "h1" && l.relation === "same_org"));
  assert.ok(rels.some((l) => l.id === "h2" && l.relation === "same_field"));
  assert.ok(r.stats.linked >= 1);

  // 低置信：D 显式标记
  const dItem = r.pending.find((p) => p.id === "d");
  assert.ok(dItem.reviewReasons.includes("low_confidence"));
  assert.equal(dItem.needsReview, true);
  assert.ok(dItem.classification.confidence < 0.7);

  // 历史条目一字不动
  assert.equal(JSON.stringify(history), historySnapshot);

  // 水位推进
  assert.equal(r.state.lastRun, NOW);
  assert.equal(r.state.ruleVersion, CLASSIFY_RULE_VERSION);
  assert.ok(r.state.processedIds.has("a"));
  assert.ok(r.state.processedIds.has("d"));
});

test("输入 state 不被修改（返回新对象）", () => {
  const { drafts, history } = scenario();
  const state = initialPipelineState();
  runAutoOrganize({ drafts, history, state, accessors, nowIso: NOW });
  assert.equal(state.processedIds.size, 0);
  assert.equal(state.lastRun, "");
});

// ── 增量语义 ────────────────────────────────────────────────────────────

test("增量：无变化的第二轮 = 空操作", () => {
  const { drafts, history } = scenario();
  const r1 = runAutoOrganize({
    drafts,
    history,
    state: initialPipelineState(),
    accessors,
    nowIso: NOW,
  });
  const r2 = runAutoOrganize({
    drafts,
    history,
    state: r1.state,
    accessors,
    nowIso: "2026-10-18T13:00:00Z",
  });
  assert.equal(r2.stats.processed, 0);
  assert.equal(r2.stats.skipped, 4);
  assert.deepEqual(r2.pending, []);
  assert.deepEqual(r2.dropped, []);
});

test("增量：last_verified 更新的条目被重新处理", () => {
  const { drafts, history } = scenario();
  const r1 = runAutoOrganize({
    drafts,
    history,
    state: initialPipelineState(),
    accessors,
    nowIso: NOW,
  });
  const drafts2 = drafts.map((d) =>
    d.id === "d" ? { ...d, last_verified: "2026-10-19" } : d,
  );
  const r2 = runAutoOrganize({
    drafts: drafts2,
    history,
    state: r1.state,
    accessors,
    nowIso: "2026-10-19T12:00:00Z",
  });
  assert.equal(r2.stats.processed, 1);
  assert.deepEqual(r2.pending.map((p) => p.id), ["d"]);
});

test("规则版本升级 → 全量回算", () => {
  const { drafts, history } = scenario();
  const r1 = runAutoOrganize({
    drafts,
    history,
    state: initialPipelineState(),
    accessors,
    nowIso: NOW,
  });
  const stale = { ...r1.state, ruleVersion: "0.0" };
  const r2 = runAutoOrganize({
    drafts,
    history,
    state: stale,
    accessors,
    nowIso: "2026-10-18T13:00:00Z",
  });
  assert.equal(r2.stats.fullRecompute, true);
  assert.equal(r2.stats.processed, 4);
  assert.equal(r2.state.ruleVersion, CLASSIFY_RULE_VERSION);
});

test("forceFullRecompute：手动全量回算", () => {
  const { drafts, history } = scenario();
  const r1 = runAutoOrganize({
    drafts,
    history,
    state: initialPipelineState(),
    accessors,
    nowIso: NOW,
  });
  const r2 = runAutoOrganize({
    drafts,
    history,
    state: r1.state,
    accessors,
    nowIso: "2026-10-18T13:00:00Z",
    forceFullRecompute: true,
  });
  assert.equal(r2.stats.fullRecompute, true);
  assert.equal(r2.stats.processed, 4);
});

// ── 待确认区纪律 ────────────────────────────────────────────────────────

test("pending 全部待人工确认；显式标记只给低置信与合并", () => {
  const { drafts, history } = scenario();
  // 加一个高置信、非合并、无需逐条核对的条目
  const clean = makeEntry({
    id: "e",
    title: "MIT 脑机接口博士招生",
    body: "MIT 脑机接口方向 PhD",
    source: "MIT 官网",
    last_verified: "2026-10-18",
    facets: { keywords: ["EEG"] },
    org: "MIT",
  });
  const r = runAutoOrganize({
    drafts: [...drafts, clean],
    history,
    state: initialPipelineState(),
    accessors,
    nowIso: NOW,
  });
  const eItem = r.pending.find((p) => p.id === "e");
  assert.ok(eItem);
  assert.equal(eItem.classification.l1, "高校");
  assert.equal(eItem.classification.l2, "phd");
  assert.equal(eItem.needsReview, false);
  assert.deepEqual(eItem.reviewReasons, []);
  // 但它仍在 pending 队列里 = 仍要人工确认（requireHumanConfirm）
  assert.ok(r.pending.some((p) => p.id === "e"));
});
