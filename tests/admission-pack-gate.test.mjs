// PRD-554/T3 测试（trend #2690 的 T3 环节）：brain-27-career-radar 机会采集技能准入检查 校验闸门。
//
// 运行：node --test tests/admission-pack-gate.test.mjs（仓库根执行）
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdmissionLedger } from '../lib/admission-pack.mjs';
import {
  ERROR_CODES, appendOnlyGate, checkLayerCoverage, checkNoAutoAdmit,
  checkOneVote, gateSummary,
} from '../lib/admission-pack-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const entry = (over = {}) => ({ layer: 'L1_quality', verdict: '过',
                                evidence: '占位',
                                checked_at: '2026-11-20T00:00:00Z', ...over });
const full = () => LAYERS_COV();

function LAYERS_COV() {
  return ['L1_quality', 'L2_security', 'L3_overlap', 'L4_synth', 'L5_live']
    .map((l) => entry({ layer: l }));
}

test('appendOnlyGate：全等放行', () => {
  const es = full();
  assert.equal(appendOnlyGate(es, es[0], es.length).gate, 'pass');
});

test('appendOnlyGate：删条目 ADMISSION_LEDGER_DRIFT 拦下', () => {
  const es = full();
  const d = appendOnlyGate(es.slice(1), es[0], es.length);
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'ADMISSION_LEDGER_DRIFT');
});

test('appendOnlyGate：首条改写拦下', () => {
  const es = full();
  const altered = [{ ...es[0], verdict: '改（占位）' }, ...es.slice(1)];
  const d = appendOnlyGate(altered, es[0], es.length);
  assert.equal(d.gate, 'block');
});

test('checkLayerCoverage：五层覆盖放行', () => {
  assert.equal(checkLayerCoverage(full()).gate, 'pass');
});

test('checkLayerCoverage：缺层/词表外拦下', () => {
  const miss = full().filter((e) => e.layer !== 'L4_synth');
  assert.equal(checkLayerCoverage(miss).reasons[0].code,
               'LAYER_COVERAGE_GAP');
  const alien = full().concat([entry({ layer: 'L9_alien（占位）' })]);
  assert.equal(checkLayerCoverage(alien).reasons[0].code,
               'LAYER_COVERAGE_GAP');
});

test('checkOneVote：一票否决不可绕', () => {
  const d = checkOneVote([entry({ verdict: '不过' })], '可进收件箱');
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'ONE_VOTE_BYPASS');
  assert.equal(checkOneVote([entry()], '不进（整改）').gate, 'pass');
});

test('checkNoAutoAdmit：词表封闭四值放行', () => {
  for (const a of ['可进收件箱', '不进（整改）', '待复核', '待补测']) {
    assert.equal(checkNoAutoAdmit(a).gate, 'pass', a);
  }
  const d = checkNoAutoAdmit('自动准入');
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'AUTO_ADMIT');
});

test('gateSummary：多闸一票否决', () => {
  const ok = gateSummary([appendOnlyGate([], null, 0),
                          checkNoAutoAdmit('待补测')]);
  assert.equal(ok.gate, 'pass');
  const bad = gateSummary([checkNoAutoAdmit('待补测'),
                           checkOneVote([entry({ verdict: '不过' })],
                                        '可进收件箱')]);
  assert.equal(bad.gate, 'block');
});

test('ERROR_CODES 词表封闭', () => {
  assert.deepEqual([...ERROR_CODES].sort(),
                   ['ADMISSION_LEDGER_DRIFT', 'AUTO_ADMIT',
                    'LAYER_COVERAGE_GAP', 'ONE_VOTE_BYPASS'].sort());
});

test('T2 留痕真实条目过闸（集成）', () => {
  const led = new AdmissionLedger(null);
  const rec = led.record(entry());
  assert.equal(checkOneVote([rec], '待补测').gate, 'pass');
  assert.equal(checkNoAutoAdmit('待补测').gate, 'pass');
  assert.equal(checkLayerCoverage(full()).gate, 'pass');
});
