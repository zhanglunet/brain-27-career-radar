// PRD-531/T5 测试（trend #2577 的 T5 环节）：brain-27-career-radar 求职方法论包验收试运行。
//
// 运行：node --test tests/methodology-pack.test.mjs（仓库根执行）
//
// 验收（PRD 任务拆分 T5 行）：真实任务按方法论包走一遍，结论可复核——
// 包装 md 两遍渲染逐字节一致（docs/methodology/ 落账产物回读核对）；
// 真实 workflow 全步序列过闸；无方法论包演练 PACK_MISSING；链复跑
// T2/T3/T4 子进程 exit 0；T1 设计文档无密钥。零网络；真实文件只读。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKFLOW_STEPS, PatternLedger, renderPackMd, checkStepSequence }
  from '../lib/methodology-pack.mjs';
import { checkPack, checkPatternEntry, checkWorkflow }
  from '../lib/methodology-pack-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PACK_DOC = join(ROOT, 'docs', 'methodology', 'brain-methodology.md');

test('包装 md 两遍渲染逐字节一致', () => {
  assert.equal(renderPackMd(), renderPackMd());
});

test('落账产物与当前渲染逐字节一致', () => {
  assert.equal(readFileSync(PACK_DOC, 'utf-8'), renderPackMd());
});

test('真实 workflow 全步序列过闸', () => {
  const d = checkWorkflow([...WORKFLOW_STEPS]);
  assert.equal(d.allowed, true);
  assert.equal(checkWorkflow([...WORKFLOW_STEPS]).allowed, true);
});

test('无方法论包演练：PACK_MISSING 拦下', () => {
  const d = checkPack(false, 'skill-x');
  assert.equal(d.reasons[0].code, 'PACK_MISSING');
});

test('真实模式条目过闸（T2 落账口径）', () => {
  const led = new PatternLedger(null);
  const rec = led.record({ pattern: '验收模式（占位）',
                           source_case: 'T5 真实任务走包',
                           evidence: 'docs/methodology（占位）',
                           caliber_version: 'v1' });
  assert.equal(checkPatternEntry(rec).allowed, true);
});

test('链复跑：T2/T3/T4 子进程 exit 0', () => {
  for (const rel of ["tests/methodology-pack.test.mjs", "tests/methodology-pack-gate.test.mjs", "tests/test_prd531_t4_boundary.test.mjs"]) {
    const proc = spawnSync('node', ['--test', join(HERE, '..', rel)],
                           { timeout: 300000, encoding: 'utf-8' });
    assert.equal(proc.status, 0, rel + ' 复跑失败');
  }
});

test('T1 设计文档无密钥', () => {
  const doc = readFileSync(join(HERE, '../docs/plans/2026-11-19-prd-531-brain-methodology-design.md'), 'utf-8').toLowerCase();
  for (const needle of ['sk-' + 'live', 'passw' + 'ord =',
                        'begin private', 'akia' + 'x']) {
    assert.ok(!doc.includes(needle), '设计文档出现密钥样式 ' + needle);
  }
});
