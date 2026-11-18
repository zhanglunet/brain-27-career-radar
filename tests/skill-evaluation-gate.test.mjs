// PRD-484/T3 测试（trend #2342 的 T3 环节）：机会技能评估监督回路闸门。
//
// 运行：node --test tests/skill-evaluation-gate.test.mjs（仓库根执行）
//
// 覆盖（T1 红线）：只放行"通过"的技能/整改拦下并追加整改条目/证据不足拦下
// 但不进整改清单/疑似重叠拦下待人确认/未知技能先记账再拒绝/放行与拦截审计
// 留痕/加固出口批量过闸/整改清单 append-only/词表封闭/源扫描零网络/无发布
// 路径/真实清单只读断言。零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, loadInventory }
  from '../lib/skill-evaluation.mjs';
import { BLOCK_REASON_CODES, GATE_AUDIT_KINDS, GATE_SCHEMA, GateError,
         SkillEvaluationLedger, admitToDownstream, checkGate, enforceGate,
         formatRemediationLine, gateOutlet }
  from '../lib/skill_evaluation_gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-11-17T09:00:00Z';
const BY = 'reviewer（占位）';
const INVENTORY = join(HERE, '..', 'skill-eval', 'inventory.json');

const THRESHOLDS = { min_sample_tasks: 20, min_relative_error_drop: 0.2,
                     max_new_error_types: 0, overlap_similarity: 0.8 };
function makeReport(specs) {
  /** 合成 T2 报告：specs = [[skillId, metrics, suspected]]。 */
  const topics = ['岗位画像盘点', '投递批准门槛', '公司研究说明', '简历裁剪策略', '跟进节奏策略', '薪资区间评估', '面试准备推送', '机会去重说明'];
  const skills = specs.map(([sid, metrics, suspected], i) => ({
    id: sid,
    text: `${sid} ${topics[i % topics.length]} 占位`,
    metrics,
  }));
  const report = evaluate({ prd: 484, repo: 'brain-27-career-radar',
                            generated_at: '2026-11-17', version: 1,
                            gate: 'error-rate', thresholds: THRESHOLDS,
                            skills });
  // 与真实清单同构：文本相同的对由 T2 判疑似；测试里按 spec 标记补 suspected。
  if (report.suspected.length === 0) {
    for (const [sid, , suspected] of specs) {
      if (suspected) {
        report.suspected.push({ a: sid, b: `other-${sid}`,
                                similarity: 0.9, suspected: true });
      }
    }
  }
  return report;
}

const PASS_METRICS = { sample_tasks: 25, error_rate_with_skill: 0.10,
                       error_rate_without_skill: 0.40, new_error_types: 0 };
const REMEDIATE_METRICS = { sample_tasks: 25, error_rate_with_skill: 0.10,
                            error_rate_without_skill: 0.40,
                            new_error_types: 1 };
const INSUFFICIENT_METRICS = { sample_tasks: 0, error_rate_with_skill: null,
                               error_rate_without_skill: null,
                               new_error_types: null };
const codes = (verdict) => verdict.reasons.map((r) => r.code);

test('放行"通过"技能', () => {
  const d = checkGate(makeReport([['skill-a', PASS_METRICS, false]]), 'skill-a');
  assert.equal(d.allowed, true);
});

test('整改拦下并给 REMEDIATE', () => {
  const d = checkGate(makeReport([['skill-b', REMEDIATE_METRICS, false]]), 'skill-b');
  assert.equal(d.allowed, false);
  assert.ok(codes(d).includes('REMEDIATE'));
});

test('证据不足拦下但不给 REMEDIATE', () => {
  const d = checkGate(makeReport([['skill-c', INSUFFICIENT_METRICS, false]]), 'skill-c');
  assert.equal(d.allowed, false);
  assert.ok(codes(d).includes('INSUFFICIENT_EVIDENCE'));
  assert.ok(!codes(d).includes('REMEDIATE'));
});

test('疑似重叠拦下待人确认（质量门过了也拦）', () => {
  const d = checkGate(makeReport([['skill-a', PASS_METRICS, true]]), 'skill-a');
  assert.equal(d.allowed, false);
  assert.ok(codes(d).includes('SUSPECTED_OVERLAP'));
});

test('未知技能显形拒绝 UNKNOWN_SKILL', () => {
  assert.throws(() => checkGate(makeReport([['skill-a', PASS_METRICS, false]]),
                                'nope'), /UNKNOWN_SKILL/);
});

test('坏报告拦下 BAD_REPORT', () => {
  for (const bad of [null, 'x', {}, { prd: 999, repo: 'brain-27-career-radar' },
                     { prd: 484, repo: 'brain-27-career-radar' }]) {
    const d = checkGate(bad, 'skill-a');
    assert.equal(d.allowed, false);
    assert.ok(codes(d).includes('BAD_REPORT'));
  }
});

test('结论词表外给 BAD_REPORT', () => {
  const report = makeReport([['skill-a', PASS_METRICS, false]]);
  report.verdicts[0].verdict = '瞎编结论';
  const d = checkGate(report, 'skill-a');
  assert.equal(d.allowed, false);
  assert.ok(codes(d).includes('BAD_REPORT'));
});

test('按技能认结论不串技能', () => {
  const report = makeReport([['skill-a', { ...PASS_METRICS,
                                             sample_tasks: 0 }, false],
                             ['skill-b', PASS_METRICS, false]]);
  assert.equal(checkGate(report, 'skill-a').allowed, false);
  assert.equal(checkGate(report, 'skill-b').allowed, true);
});

test('enforceGate 拦下显形拒绝、放行返回裁决', () => {
  assert.throws(() => enforceGate(makeReport([['skill-c', { ...PASS_METRICS,
                                                          sample_tasks: 0 },
                                                          false]]), 'skill-c'),
                /GATE_BLOCKED/);
  assert.equal(enforceGate(makeReport([['skill-a', PASS_METRICS, false]]),
                           'skill-a').allowed, true);
});

test('admitToDownstream 拦下记 gate_blocked + remediation 条目', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-'));
  const led = new SkillEvaluationLedger(join(tmp, 'gate.jsonl'));
  assert.throws(() => admitToDownstream(
    makeReport([['skill-b', REMEDIATE_METRICS, false]]),
    'skill-b', { ledger: led, by: BY, at: NOW }), /GATE_BLOCKED/);
  const kinds = led.entries().map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'gate_blocked').length, 1);
  assert.equal(kinds.filter((k) => k === 'remediation').length, 1);
  assert.equal(led.latestFor('skill-b').kind, 'remediation');
});

test('证据不足拦下记审计但不进整改清单', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-'));
  const led = new SkillEvaluationLedger(join(tmp, 'gate.jsonl'));
  assert.throws(() => admitToDownstream(
    makeReport([['skill-c', INSUFFICIENT_METRICS, false]]),
    'skill-c', { ledger: led, by: BY, at: NOW }), /GATE_BLOCKED/);
  const kinds = led.entries().map((e) => e.kind);
  assert.ok(kinds.includes('gate_blocked'));
  assert.ok(!kinds.includes('remediation'));
});

test('放行记 gate_passed 审计', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-'));
  const led = new SkillEvaluationLedger(join(tmp, 'gate.jsonl'));
  const out = admitToDownstream(makeReport([['skill-a', PASS_METRICS, false]]),
                                'skill-a', { ledger: led, by: BY, at: NOW });
  assert.equal(out.verdict.allowed, true);
  assert.deepEqual(led.entries().map((e) => e.kind), ['gate_passed']);
});

test('审计留痕须 by', () => {
  const led = new SkillEvaluationLedger(null);
  assert.throws(() => admitToDownstream(
    makeReport([['skill-a', PASS_METRICS, false]]), 'skill-a',
    { ledger: led, by: '', at: NOW }), /by/);
});

test('账本 JSONL append-only 且 entries 深拷贝', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-'));
  const path = join(tmp, 'gate.jsonl');
  const led = new SkillEvaluationLedger(path);
  led.record({ prd: 484 }, { kind: 'gate_passed', skill_id: 's', by: BY, at: NOW });
  led.record({ prd: 484 }, { kind: 'gate_blocked', skill_id: 's2', by: BY, at: NOW });
  assert.equal(readFileSync(path, 'utf-8').trim().split('\n').length, 2);
  const snapshot = led.entries();
  snapshot[0].kind = '改（占位）';
  assert.equal(led.entries()[0].kind, 'gate_passed');
});

test('未知技能先记账再拒绝', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-'));
  const led = new SkillEvaluationLedger(join(tmp, 'gate.jsonl'));
  assert.throws(() => admitToDownstream(
    makeReport([['skill-a', PASS_METRICS, false]]), 'ghost',
    { ledger: led, by: BY, at: NOW }), /GATE_BLOCKED/);
  assert.equal(led.latestFor('ghost').kind, 'gate_blocked');
});

test('formatRemediationLine 渲染整改行', () => {
  const line = formatRemediationLine({ skill_id: 's', at: NOW,
                                       reason: '质量门未过关',
                                       evidence: '报告', due: '待定',
                                       action: '修' });
  assert.ok(line.includes('技能 s'));
  assert.ok(line.includes('整改期限 待定'));
});

test('gateOutlet 批量过闸', () => {
  const out = gateOutlet(
    makeReport([['skill-a', PASS_METRICS, false],
                ['skill-c', INSUFFICIENT_METRICS, false]]),
    ['skill-a', 'skill-c', 'ghost'], { by: BY, at: NOW });
  assert.deepEqual(out.passed.map((p) => p.skill_id), ['skill-a']);
  assert.equal(out.blocked_count, 2);
});

test('gateOutlet 带账本逐条留痕', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-'));
  const led = new SkillEvaluationLedger(join(tmp, 'g.jsonl'));
  const out = gateOutlet(
    makeReport([['skill-a', PASS_METRICS, false],
                ['skill-b', REMEDIATE_METRICS, false]]),
    ['skill-a', 'skill-b'], { ledger: led, by: BY, at: NOW });
  assert.equal(out.passed.length, 1);
  assert.equal(out.blocked.length, 1);
  const kinds = led.entries().map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'gate_passed').length, 1);
  assert.equal(kinds.filter((k) => k === 'gate_blocked').length, 1);
  assert.equal(kinds.filter((k) => k === 'remediation').length, 1);
});

test('真实清单：全部证据不足全拦（今天实情）', () => {
  const report = evaluate(loadInventory(INVENTORY));
  assert.equal(report.skill_count, 3);
  for (const v of report.verdicts) {
    assert.equal(v.verdict, '证据不足');
    const d = checkGate(report, v.id);
    assert.equal(d.allowed, false);
    assert.ok(codes(d).includes('INSUFFICIENT_EVIDENCE'));
  }
});

test('词表封闭', () => {
  assert.deepEqual([...BLOCK_REASON_CODES].sort(),
                   ['BAD_REPORT', 'INSUFFICIENT_EVIDENCE', 'REMEDIATE',
                    'SUSPECTED_OVERLAP', 'UNKNOWN_SKILL'].sort());
  assert.deepEqual([...GATE_AUDIT_KINDS].sort(),
                   ['gate_blocked', 'gate_passed', 'remediation'].sort());
});

test('无发布路径（源扫描）', () => {
  const src = readFileSync(join(HERE, '..', 'lib', 'skill_evaluation_gate.mjs'), 'utf-8');
  for (const word of ['publish', 'delete_skill', 'remove_skill', 'merge_skill']) {
    assert.ok(!src.toLowerCase().includes(word), word);
  }
});

test('源扫描零网络零子进程', () => {
  for (const [name, base] of [['skill_evaluation_gate.mjs', join(HERE, '..', 'lib')],
                              ['skill-evaluation.mjs', join(HERE, '..', 'lib')]]) {
    const src = readFileSync(join(base, name), 'utf-8');
    for (const banned of ['node:child_process', 'node:http', 'node:https',
                          'node:net']) {
      assert.ok(!src.includes(banned), `${name} 出现 ${banned}`);
    }
  }
});
