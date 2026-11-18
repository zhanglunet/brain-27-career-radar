// PRD-531/T2 测试（trend #2574 的 T2 环节）：brain-27-career-radar 求职方法论包方法论包落账。
//
// 运行：node --test tests/methodology-pack.test.mjs（仓库根执行）
//
// 覆盖（T1 §1/§3 + 红线）：workflow 封闭词表与步骤序列校验/模式库 JSONL
// append-only 缺件拒绝/渲染两遍逐字节一致/T1 设计稿真实存在+首份模式条目
// 四件齐全/源扫描零网络/无审批代行。零网络；全合成占位 + 真实文件只读。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { METHOD_COMMAND, METHODOLOGY_SCHEMA, SKILLSET_NAME,
         WORKFLOW_STEPS, MethodologyError, PatternLedger,
         checkStepSequence, renderPackMd }
  from '../lib/methodology-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('workflow 封闭词表', () => {
  assert.equal(WORKFLOW_STEPS.length, 5);
  assert.deepEqual(WORKFLOW_STEPS, ["看机会", "评估", "准备", "投递", "跟进"]);
});

test('全序 OK', () => {
  assert.equal(checkStepSequence([...WORKFLOW_STEPS]).ok, true);
});

test('前缀 OK（进行中）', () => {
  const d = checkStepSequence(WORKFLOW_STEPS.slice(0, 2));
  assert.equal(d.ok, true);
  assert.equal(d.detail, '进行中');
});

test('跳步拦下', () => {
  const bad = [WORKFLOW_STEPS[0], WORKFLOW_STEPS[2]];
  const d = checkStepSequence(bad);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'STEP_INVALID');
});

test('乱步拦下', () => {
  const bad = [...WORKFLOW_STEPS].reverse();
  assert.equal(checkStepSequence(bad).reason, 'STEP_INVALID');
});

test('多步拦下', () => {
  const d = checkStepSequence([...WORKFLOW_STEPS, '多余步（占位）']);
  assert.equal(d.reason, 'STEP_INVALID');
});

const mkEntry = () => ({
  pattern: '测试模式（占位）', source_case: '真实案例（占位）',
  evidence: 'docs/plans（占位）', caliber_version: 'v1',
});

test('模式库 JSONL append-only 落盘', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'meth-'));
  const path = join(tmp, 'patterns.jsonl');
  const led = new PatternLedger(path);
  led.record(mkEntry());
  assert.equal(led.entries().length, 1);
  assert.equal(readFileSync(path, 'utf-8').trim().split('\n').length, 1);
});

test('四件缺一 PATTERN_INCOMPLETE 拒绝', () => {
  const led = new PatternLedger(null);
  for (const key of ['pattern', 'source_case', 'evidence',
                     'caliber_version']) {
    const bad = mkEntry();
    delete bad[key];
    assert.throws(() => led.record(bad), /PATTERN_INCOMPLETE/);
  }
});

test('entries 深拷贝隔离', () => {
  const led = new PatternLedger(null);
  led.record(mkEntry());
  const snapshot = led.entries();
  snapshot[0].pattern = '改（占位）';
  assert.equal(led.entries()[0].pattern, '测试模式（占位）');
});

test('渲染两遍逐字节一致', () => {
  assert.equal(renderPackMd(), renderPackMd());
});

test('渲染含四件套要素', () => {
  const text = renderPackMd();
  for (const needle of [METHOD_COMMAND, SKILLSET_NAME,
                        'pattern / source_case / evidence / caliber_version',
                        'append-only']) {
    assert.ok(text.includes(needle), needle);
  }
});

test('T1 设计稿真实存在+首份模式条目真实来源', () => {
  const doc = readFileSync(join(HERE, '..', 'docs', 'plans', '2026-11-19-prd-531-brain-methodology-design.md'), 'utf-8');
  assert.ok(doc.includes('方法论包四件套'));
  assert.ok(doc.includes('/apply'));
});

test('源扫描零网络+无审批代行', () => {
  const src = readFileSync(join(HERE, '..', 'lib', 'methodology-pack.mjs'), 'utf-8');
  for (const banned of ['node:child_process', 'node:http', 'node:https',
                        'node:net', 'fetch(']) {
    assert.ok(!src.includes(banned), banned);
  }
  assert.ok(!/export (async )?function (approve|publish|finalizeReview)/
    .test(src), '出现审批代行符号');
});
