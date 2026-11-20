// PRD-577/T4 测试（trend #2898 的 T4 环节）：巡检划界断言。
//
// 运行：node --test tests/test_prd577_t4_boundary.test.mjs（仓库根执行）
//
// 覆盖：借鉴仓（superpowers/bughunter/opensre）零符号+只找不修钉值+
// 零自动执行钉值+误报一票否决钉值+词表封闭+零网络零子进程源扫描。
// 零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FindingLedger, HUNT_CONCLUSIONS, REPRO_VERDICTS } from '../lib/hunting-pack.mjs';
import {
  ERROR_CODES, checkFpVeto, checkHuntVocab, checkReproEvidence,
} from '../lib/hunting-pack-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BORROWED = ['superpowers', 'bughunter', 'opensre'];
const NEIGHBOR = ['methodology', 'admission', 'admission_check_placeholder',
                  'evaluation', 'review_pipeline', 'supervision'];
const NO_FIX = ['fix_', 'repair', 'apply_fix', 'patch_', 'approve',
                'execute', 'auto_run'];

const stripped = (rel) => readFileSync(join(HERE, rel), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const SOURCES = { mod: stripped('../lib/hunting-pack.mjs'),
                  gate: stripped('../lib/hunting-pack-gate.mjs') };
const namesOf = (src) => [...src.matchAll(/function\s+(\w+)/g)]
  .map((m) => m[1].toLowerCase());

test('借鉴仓零符号（superpowers/bughunter/opensre）', () => {
  for (const [k, src] of Object.entries(SOURCES)) {
    const low = src.toLowerCase();
    for (const w of BORROWED) {
      assert.ok(!low.includes(w), k + ' 出现借鉴词 ' + w);
    }
  }
});

test('邻居模块零导入（不越界）', () => {
  for (const [k, src] of Object.entries(SOURCES)) {
    const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const stem of NEIGHBOR) {
      assert.ok(!specs.some((s) => s.includes(stem)),
                k + ' 导入邻居 ' + stem + '：' + JSON.stringify(specs));
    }
  }
});

test('只找不修+零自动执行：无 fix/approve/execute 符号', () => {
  for (const [k, src] of Object.entries(SOURCES)) {
    const names = namesOf(src);
    for (const w of NO_FIX) {
      assert.ok(!names.some((n) => n.includes(w)), k + ' 出现 ' + w);
    }
  }
});

test('红线钉值：误报一票否决', () => {
  const d = checkFpVeto([{ finding: '占位', repro: '复现', evidence: '占位',
                           found_at: '2026-11-20T09:00:00Z',
                           review: '误报' }]);
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'FP_ADMIT');
});

test('红线钉值：无复现证据拦下', () => {
  const d = checkReproEvidence([{ finding: '占位', repro: '未复现',
                                  evidence: '', found_at: '占位' }]);
  assert.equal(d.reasons[0].code, 'REPRO_MISSING');
});

test('红线钉值：账本 append-only（深拷贝隔离）', () => {
  const led = new FindingLedger(null);
  led.record({ finding: '占位', repro: '复现', evidence: '占位',
               found_at: '2026-11-20T09:00:00Z' });
  const snapshot = led.entries();
  snapshot[0].finding = '改（占位）';
  assert.notEqual(led.entries()[0].finding, '改（占位）');
});

test('词表封闭 + 零网络源扫描', () => {
  assert.deepEqual([...REPRO_VERDICTS].sort(), ['不复现', '复现']);
  assert.deepEqual([...HUNT_CONCLUSIONS].sort(),
                   ['有发现', '无可复现发现'].sort());
  assert.deepEqual([...ERROR_CODES].sort(),
                   ['FINDING_LEDGER_DRIFT', 'FP_ADMIT', 'HUNT_VOCAB_GAP',
                    'REPRO_MISSING'].sort());
  for (const [k, src] of Object.entries(SOURCES)) {
    for (const banned of ['node:child_process', 'node:http', 'node:https',
                          'node:net', 'fetch(']) {
      assert.ok(!src.includes(banned), k + ' 出现 ' + banned);
    }
  }
});
