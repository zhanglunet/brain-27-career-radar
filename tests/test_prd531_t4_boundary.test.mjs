// PRD-531/T4 测试（trend #2576 的 T4 环节）：brain-27-career-radar 求职方法论包划界断言。
//
// 运行：node --test tests/methodology-pack.test.mjs（仓库根执行）
//
// 按 PRD 任务拆分 T4 行：方法论包与契约/评估/评审流水线/监督回路的边界
// 断言；无方法论包不成套。邻居词面零出现+借鉴词零出现+载体词零出现+
// 红线钉值（PACK_MISSING/append-only/无审批代行）+词表封闭+零网络源扫描。
// 只断言，不改任何生产代码。零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PatternLedger } from '../lib/methodology-pack.mjs';
import { ERROR_CODES, checkPack, checkPatternEntry }
  from '../lib/methodology-pack-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NEIGHBORS = ["opportunity_collab_session", "opportunity_review_pipeline", "opportunity_supervision_bench"];
const CARRIERS = ["opportunity_collab_session", "opportunity_review_pipeline", "opportunity_supervision_bench", "crawler"];
const EVAL_MODULES = ['methodology-pack.mjs', 'methodology-pack-gate.mjs'];

const codeOf = (name) => readFileSync(join(HERE, srcOf[name]), 'utf-8')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const srcOf = {
  'methodology-pack.mjs': '../lib/methodology-pack.mjs',
  'methodology-pack-gate.mjs': '../lib/methodology-pack-gate.mjs',
};

test('邻居模块词面零出现（不越界）', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod);
    for (const stem of NEIGHBORS) {
      assert.ok(!code.includes(stem), `${mod} 出现邻居 ${stem}`);
    }
  }
});

test('下游载体词零出现', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod);
    for (const w of CARRIERS) {
      assert.ok(!code.includes(w), `${mod} 出现载体 ${w}`);
    }
  }
});

test('借鉴仓零符号（superpowers/bughunter/ecc/loopforge）', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod).toLowerCase();
    for (const w of ['superpowers', 'bughunter', 'ecc_', 'loopforge']) {
      assert.ok(!code.includes(w), `${mod} 出现借鉴词 ${w}`);
    }
  }
});

test('红线：无方法论包 PACK_MISSING 拦下', () => {
  const d = checkPack(false, 'skill-a');
  assert.equal(d.allowed, false);
  assert.equal(d.reasons[0].code, 'PACK_MISSING');
});

test('红线：模式条目缺证据 PATTERN_INCOMPLETE 拦下', () => {
  const bad = { pattern: 'p（占位）', source_case: 's（占位）',
                evidence: '', caliber_version: 'v1' };
  const d = checkPatternEntry(bad);
  assert.equal(d.allowed, false);
  assert.equal(d.reasons[0].code, 'PATTERN_INCOMPLETE');
});

test('红线：账本 append-only（深拷贝隔离）', () => {
  const led = new PatternLedger(null);
  led.record({ pattern: 'p（占位）', source_case: 's（占位）',
               evidence: 'e（占位）', caliber_version: 'v1' });
  const snapshot = led.entries();
  snapshot[0].pattern = '改（占位）';
  assert.equal(led.entries()[0].pattern, 'p（占位）');
});

test('红线：无审批代行符号', () => {
  for (const mod of EVAL_MODULES) {
    const code = codeOf(mod).toLowerCase();
    for (const w of ['approve', 'publish', 'finalizereview']) {
      assert.ok(!code.includes(w), `${mod} 出现 ${w}`);
    }
  }
});

test('词表封闭+零网络源扫描', () => {
  assert.deepEqual([...ERROR_CODES].sort(),
                   ['PACK_MISSING', 'PATTERN_INCOMPLETE', 'STEP_INVALID']
                     .sort());
  for (const mod of EVAL_MODULES) {
    const src = readFileSync(join(HERE, srcOf[mod]), 'utf-8');
    for (const banned of ['node:child_process', 'node:http', 'node:https',
                          'node:net', 'fetch(']) {
      assert.ok(!src.includes(banned), `${mod} 出现 ${banned}`);
    }
  }
});
