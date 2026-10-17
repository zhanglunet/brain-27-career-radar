/**
 * PRD-019/T5 · 摘要模式回归验证（trend #86）。
 *
 * 回归目标（trend #86）：
 *  1. 计数对账：摘要里的分类计数必须与全量逐项复算一致，差 1 条即失败。
 *  2. 关键字段不丢失：摘要条目不得丢截止日/资助类型（缺失须标 incomplete）。
 *  3. token 断言：measureJsonBytes(摘要) * 10 <= measureJsonBytes(全量)。
 *
 * 数据集：63 条确定性合成条目（T1 示例量级），非生产数据。
 * 诚实注记：token 1/10 目标针对生产量级数据；生产环境须用真实数据重跑本文件。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SUMMARY_NOTICE,
  buildFullList,
  buildStats,
  buildSummary,
  listOpportunities,
  measureJsonBytes,
} from "../lib/mcp/summary.ts";

const NOW = "2026-10-17";
const N = 63; // T1 示例量级

const TYPES = ["phd", "joint_phd", "ra", "campus", "intern", "research"];
const REGIONS = ["英国", "中国大陆", "中国香港", "爱尔兰"];
const FUNDINGS = ["full", "partial", "mixed", "self", "tbd"];
const DIRS = ["脑机接口", "认知神经科学", "脑成像", "计算神经科学", "神经调控"];

/** 确定性合成数据集：63 条，截止日/类型/地区/资助均匀分布。 */
function genEntries(n) {
  const base = Date.UTC(2026, 9, 17);
  const day = 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const k = i % 10;
    let deadline, deadline_kind;
    if (k < 6) {
      deadline = iso(base + ((i * 7) % 90) * day);
      deadline_kind = "fixed";
    } else if (k === 6) {
      deadline = "rolling";
      deadline_kind = "rolling";
    } else if (k === 7) {
      deadline = null;
      deadline_kind = "tbd";
    } else {
      deadline = iso(base + (30 + ((i * 3) % 60)) * day);
      deadline_kind = "estimated";
    }
    entries.push({
      id: `reg-${i}`,
      title: `${DIRS[i % DIRS.length]}${TYPES[i % TYPES.length]}机会${i}`,
      org: `机构${i}`,
      source: "回归测试合成来源",
      source_url: "https://example.test/",
      source_type: "d1_snapshot",
      d1_evidence: `d1://snapshots/reg-${i}`,
      confidence: i % 9 === 0 ? "medium" : "high",
      created: "2026-10-01",
      last_verified: "2026-10-17",
      status: "active",
      facets: {
        type: TYPES[i % TYPES.length],
        region: REGIONS[i % REGIONS.length],
        funding: FUNDINGS[i % FUNDINGS.length],
        keywords: [DIRS[i % DIRS.length]],
      },
      body: `第${i}条合成条目正文：方向${DIRS[i % DIRS.length]}，类型${TYPES[i % TYPES.length]}，地区${REGIONS[i % REGIONS.length]}。正文需要一定长度以模拟生产数据体量，使 token 断言具有代表性。申请截止与资助方式以官网原文为准，国际学生注意学费差额风险。`,
      deadline,
      deadline_kind,
    });
  }
  return entries;
}

const ENTRIES = genEntries(N);

test("计数对账：摘要统计段 == 全量逐项复算，差 1 条即失败", () => {
  const summary = buildSummary(ENTRIES, { nowIso: NOW });
  const full = buildFullList(ENTRIES);
  // 用全量条目逐项复算统计
  const recomputed = buildStats(full.items);
  assert.deepEqual(summary.stats, recomputed);
  assert.equal(summary.stats.total, N);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(sum(summary.stats.by_type), N);
  assert.equal(sum(summary.stats.by_region), N);
  assert.equal(sum(summary.stats.by_funding), N);
});

test("token 断言：摘要字节数 * 10 <= 全量字节数", () => {
  const summary = buildSummary(ENTRIES, { nowIso: NOW });
  const full = buildFullList(ENTRIES);
  const sBytes = measureJsonBytes(summary);
  const fBytes = measureJsonBytes(full);
  console.log(`    summary=${sBytes}B full=${fBytes}B ratio=${(fBytes / sBytes).toFixed(1)}x`);
  assert.ok(
    sBytes * 10 <= fBytes,
    `token 压缩比不足 10x：摘要 ${sBytes}B，全量 ${fBytes}B`,
  );
});

test("关键字段不丢失：Top N 条目 deadline/funding/org 缺一即标 incomplete", () => {
  const summary = buildSummary(ENTRIES, { nowIso: NOW });
  assert.ok(summary.upcoming.items.length > 0);
  for (const item of summary.upcoming.items) {
    const complete =
      item.deadline !== null && item.funding !== null && item.org !== null;
    assert.ok(
      complete || item.incomplete === true,
      `条目 ${item.id} 缺关键字段却未标 incomplete`,
    );
  }
});

test("防误判标注：摘要顶部与统计段均带强制 note", () => {
  const summary = buildSummary(ENTRIES, { nowIso: NOW });
  assert.equal(summary.notice, SUMMARY_NOTICE);
  assert.equal(summary.stats.note, SUMMARY_NOTICE);
});

test("listOpportunities 默认走摘要：回归默认行为", () => {
  const r = listOpportunities(ENTRIES, { nowIso: NOW });
  assert.equal(r.mode, "summary");
  assert.equal(r.stats.total, N);
});
