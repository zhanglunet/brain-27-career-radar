// PRD-531/T3 测试（trend #2575 的 T3 环节）：brain-27-career-radar 求职方法论包方法论包校验闸门。
//
// 运行：node --test tests/methodology-pack-gate.test.mjs（仓库根执行）
import test from 'node:test';
import assert from 'node:assert/strict';

import { WORKFLOW_STEPS as WORKFLOW_REF, PatternLedger }
  from '../lib/methodology-pack.mjs';
import { ERROR_CODES, enforcePack, checkPack, checkPatternEntry,
         checkWorkflow, gateSummary }
  from '../lib/methodology-pack-gate.mjs';

const entry = () => ({
  pattern: '测试模式（占位）', source_case: '真实案例（占位）',
  evidence: 'docs/plans（占位）', caliber_version: 'v1',
});

test('PACK_MISSING 拦下', () => {
  const d = checkPack(false, 'skill-a');
  assert.equal(d.allowed, false);
  assert.equal(d.reasons[0].code, 'PACK_MISSING');
});

test('有包放行+enforcePack 显形拒绝', () => {
  assert.equal(checkPack(true, 'skill-a').allowed, true);
  assert.throws(() => enforcePack(false, 'skill-a'), /GATE_BLOCKED/);
});

test('四件缺一 PATTERN_INCOMPLETE 拦下', () => {
  for (const key of ['pattern', 'source_case', 'evidence',
                     'caliber_version']) {
    const bad = entry();
    delete bad[key];
    const d = checkPatternEntry(bad);
    assert.equal(d.allowed, false);
    assert.equal(d.reasons[0].code, 'PATTERN_INCOMPLETE');
  }
});

test('完整条目放行', () => {
  assert.equal(checkPatternEntry(entry()).allowed, true);
});

test('STEP_INVALID 拦下（跳步/多步）', () => {
  assert.equal(checkWorkflow(WORKFLOW_REF.slice(0, 1)
    .concat(WORKFLOW_REF.slice(2))).reasons[0].code, 'STEP_INVALID');
  assert.equal(checkWorkflow([...WORKFLOW_REF, '多余步（占位）'])
    .reasons[0].code, 'STEP_INVALID');
});

test('全序放行', () => {
  assert.equal(checkWorkflow(WORKFLOW_REF).allowed, true);
});

test('一票否决', () => {
  const ok = [checkPack(true), checkPatternEntry(entry()),
              checkWorkflow(WORKFLOW_REF)];
  assert.equal(gateSummary(ok).gate, 'pass');
  assert.equal(gateSummary([checkPack(true), checkPack(false)]).gate,
               'block');
});

test('ERROR_CODES 导出', () => {
  assert.deepEqual([...ERROR_CODES].sort(),
                   ['PACK_MISSING', 'PATTERN_INCOMPLETE', 'STEP_INVALID']
                     .sort());
});

test('T2 落账真实条目过闸', () => {
  const led = new PatternLedger(null);
  const rec = led.record(entry());
  assert.equal(checkPatternEntry(rec).allowed, true);
});
