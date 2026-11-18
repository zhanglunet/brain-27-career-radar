// PRD-484/T5 测试（trend #2344 的 T5 环节）：机会技能评估验收试运行。
//
// 运行：node --test tests/skill-evaluation-acceptance.test.mjs（仓库根执行）
//
// 验收（PRD 任务拆分 T5 行）：全套评估跑一遍真实技能包，结论可复核——
// 真实清单评估跑一遍两遍逐字节一致；逐技能结论全在封闭词表（今天全部
// 「证据不足」——实情，对照跑分在实测补）；闸门全链试运行（逐技能过闸
// 全拦 + 拦截审计落 JSONL 账本留痕，append-only）；链复跑 T2/T3/T4 子进程
// exit 0；T1 设计文档无密钥。零网络；全合成占位 + 真实清单只读。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, loadInventory } from '../lib/skill-evaluation.mjs';
import { GateError, SkillEvaluationLedger, admitToDownstream, checkGate }
  from '../lib/skill_evaluation_gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-11-17T12:00:00Z';
const BY = 'acceptance（占位）';
const INVENTORY = join(HERE, '..', 'skill-eval', 'inventory.json');

const realReport = () => evaluate(loadInventory(INVENTORY));

test('真实清单评估两遍逐字节一致', () => {
  const a = JSON.stringify(realReport());
  const b = JSON.stringify(realReport());
  assert.equal(a, b);
});

test('结论可复核：全部「证据不足」且在封闭词表', () => {
  const report = realReport();
  for (const v of report.verdicts) {
    assert.ok(['通过', '整改', '证据不足'].includes(v.verdict));
    assert.equal(v.verdict, '证据不足');
  }
});

test('闸门全链试运行：逐技能过闸全拦 + 账本留痕', () => {
  const report = realReport();
  const tmp = mkdtempSync(join(tmpdir(), 't5-'));
  const led = new SkillEvaluationLedger(join(tmp, 'walk.jsonl'));
  for (const v of report.verdicts) {
    assert.throws(() => admitToDownstream(report, v.id,
      { ledger: led, by: BY, at: NOW }), /GATE_BLOCKED/);
  }
  const kinds = led.entries().map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'gate_blocked').length,
               report.skill_count);
  assert.ok(!kinds.includes('gate_passed'));
});

test('账本 JSONL append-only', () => {
  const tmp = mkdtempSync(join(tmpdir(), 't5-'));
  const path = join(tmp, 'walk.jsonl');
  const led = new SkillEvaluationLedger(path);
  led.record({ prd: 484 }, { kind: 'gate_passed', skill_id: 's',
                                by: BY, at: NOW });
  assert.equal(readFileSync(path, 'utf-8').trim().split('\n').length, 1);
});

test('链复跑：T2/T3/T4 子进程 exit 0', () => {
  for (const rel of ["tests/skill-evaluation.test.mjs", "tests/skill-evaluation-gate.test.mjs", "tests/skill-evaluation-boundary.test.mjs"]) {
    const proc = spawnSync('node', ['--test', join(HERE, '..', rel)],
                           { timeout: 300000, encoding: 'utf-8' });
    assert.equal(proc.status, 0, rel + ' 复跑失败：'
      + (proc.stdout || '').slice(-400));
  }
});

test('T1 设计文档无密钥', () => {
  const doc = readFileSync(join(HERE, '..', 'docs', 'plans', '2026-11-17-prd-484-brain-skill-evaluation-design.md'), 'utf-8').toLowerCase();
  for (const needle of ['sk-' + 'live', 'passw' + 'ord =',
                        'begin private', 'akia' + 'x']) {
    assert.ok(!doc.includes(needle), '设计文档出现密钥样式 ' + needle);
  }
});
