// PRD-577/T3 测试（trend #2897 的 T3 环节）：巡检校验闸门。
//
// 运行：node --test tests/hunting-pack-gate.test.mjs（仓库根执行）
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FindingLedger } from '../lib/hunting-pack.mjs';
import {
  ERROR_CODES, appendOnlyGate, checkFpVeto, checkHuntVocab,
  checkReproEvidence, gateSummary,
} from '../lib/hunting-pack-gate.mjs';

const entry = (over = {}) => ({ finding: '占位', repro: '复现',
                                evidence: '占位',
                                found_at: '2026-11-20T09:00:00Z', ...over });

test('appendOnlyGate：全等放行', () => {
  const es = [entry()];
  assert.equal(appendOnlyGate(es, es[0], es.length).gate, 'pass');
});

test('appendOnlyGate：删条目/改首条拦下', () => {
  const es = [entry(), entry({ finding: '占位2' })];
  const d = appendOnlyGate(es.slice(1), es[0], es.length);
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'FINDING_LEDGER_DRIFT');
  const altered = [{ ...es[0], finding: '改（占位）' }];
  assert.equal(appendOnlyGate(altered, es[0], es.length).gate, 'block');
});

test('checkReproEvidence：全复现放行；缺证据拦下', () => {
  assert.equal(checkReproEvidence([entry()]).gate, 'pass');
  assert.equal(checkReproEvidence([entry({ repro: '未复现' })])
    .reasons[0].code, 'REPRO_MISSING');
  assert.equal(checkReproEvidence([entry({ evidence: '' })])
    .reasons[0].code, 'REPRO_MISSING');
});

test('checkFpVeto：误报条目未摘除 → FP_ADMIT', () => {
  assert.equal(checkFpVeto([entry()]).gate, 'pass');
  const d = checkFpVeto([entry({ review: '误报' })]);
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'FP_ADMIT');
});

test('checkHuntVocab：词表封闭', () => {
  for (const h of ['有发现', '无可复现发现']) {
    assert.equal(checkHuntVocab(h).gate, 'pass', h);
  }
  assert.equal(checkHuntVocab('自动裁决').reasons[0].code, 'HUNT_VOCAB_GAP');
});

test('gateSummary：多闸一票否决', () => {
  assert.equal(gateSummary([checkHuntVocab('有发现')]).gate, 'pass');
  const bad = gateSummary([checkHuntVocab('有发现'),
                           checkFpVeto([entry({ review: '误报' })])]);
  assert.equal(bad.gate, 'block');
});

test('ERROR_CODES 词表封闭', () => {
  assert.deepEqual([...ERROR_CODES].sort(),
                   ['FINDING_LEDGER_DRIFT', 'FP_ADMIT', 'HUNT_VOCAB_GAP',
                    'REPRO_MISSING'].sort());
});

test('T2 留痕真实条目过闸（集成）', () => {
  const led = new FindingLedger(null);
  const rec = led.record(entry());
  assert.equal(checkReproEvidence([rec]).gate, 'pass');
  assert.equal(checkFpVeto([rec]).gate, 'pass');
});
