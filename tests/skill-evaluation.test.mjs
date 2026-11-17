// PRD-484/T2：brain-27 机会技能评估最小实现测试（PRD-484/T2）。
//
// 质量门 + 重叠检测的最小实现测试。断言值来自首份评估报告的真实跑分
// （评估脚本按 skill-eval/inventory.json 的真实技能文本算出），不是拍脑袋的数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERDICT_INSUFFICIENT,
  VERDICT_PASS,
  VERDICT_REMEDIATE,
  evaluate,
  gateErrorRate,
  gateRateTrio,
  loadInventory,
  renderReport,
} from '../lib/skill-evaluation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)) , '..');
const INVENTORY = join(ROOT, 'skill-eval', 'inventory.json');

test('评估清单可加载，技能数与来源齐全', () => {
  const inv = loadInventory(INVENTORY);
  assert.equal(inv.prd, 484);
  assert.equal(inv.repo, 'brain-27-career-radar');
  assert.equal(inv.skills.length, 3);
  for (const skill of inv.skills) {
    assert.ok(skill.id && skill.text && skill.source_path);
    assert.equal(skill.metrics.sample_tasks, 0);
  }
});

test('质量门结论全部为证据不足（尚无对照跑分）', () => {
  const report = evaluate(loadInventory(INVENTORY));
  assert.equal(report.skill_count, 3);
  assert.ok(report.verdicts.every((v) => v.verdict === VERDICT_INSUFFICIENT));
  assert.deepEqual(report.remediation_candidates, []);
});

test('重叠检测跑出真实数字', () => {
  const report = evaluate(loadInventory(INVENTORY));
  assert.equal(report.pair_count, 3);
  assert.equal(report.suspected.length, 0);
  if (report.pairs.length > 0) {
    const top = report.pairs[0];
    assert.equal(top.similarity, 0.107);
    assert.deepEqual([top.a, top.b], ['capture:job-capture', 'draft:job-skill-draft']);
  }
});

test('质量门边界逻辑', () => {
  const thresholds = { min_sample_tasks: 30, max_error_rate: 0.10,
    max_error_vs_control_ratio: 0.5, min_behavior_change_rate: 0.10,
    min_adoption_rate: 0.80, overlap_similarity: 0.8, error_label: '假信号率' };
  const passing = { sample_tasks: 30, false_signal_rate: 0.04, control_false_signal_rate: 0.10,
    behavior_change_rate: 0.15, adoption_rate: 0.85 };
  assert.equal(gateRateTrio(passing, thresholds)[0], VERDICT_PASS);
  const lowAdoption = { sample_tasks: 30, false_signal_rate: 0.04, control_false_signal_rate: 0.10,
    behavior_change_rate: 0.15, adoption_rate: 0.60 };
  assert.equal(gateRateTrio(lowAdoption, thresholds)[0], VERDICT_REMEDIATE);
  const smallSample = { sample_tasks: 5, false_signal_rate: 0.04, control_false_signal_rate: 0.10,
    behavior_change_rate: 0.15, adoption_rate: 0.85 };
  assert.equal(gateRateTrio(smallSample, thresholds)[0], VERDICT_INSUFFICIENT);
  const noRuns = { sample_tasks: 0, false_signal_rate: null, control_false_signal_rate: null,
    behavior_change_rate: null, adoption_rate: null };
  assert.equal(gateRateTrio(noRuns, thresholds)[0], VERDICT_INSUFFICIENT);
});

test('报告渲染含真实数字与诚实声明', () => {
  const report = evaluate(loadInventory(INVENTORY));
  const text = renderReport(report);
  assert.ok(text.includes('2026-11-17'));
  assert.ok(text.includes(VERDICT_INSUFFICIENT));
  assert.ok(text.includes('证据不足不是失效'));
  assert.ok(text.includes('0.107'));
});
