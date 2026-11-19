// PRD-554/T4 测试（trend #2691 的 T4 环节）：brain-27-career-radar 机会采集技能准入检查 划界断言。
//
// 运行：node --test tests/test_prd554_t4_boundary.test.mjs（仓库根执行）
//
// 按 PRD 任务拆分 T4 行：准入检查与方法论包/契约/评估/评审流水线/监督
// 回路的边界断言；检查只出结论不代行准入。
// 覆盖：借鉴仓（superpowers/bughunter/cli-anything）零符号+机器不代行
// 准入钉值+词表封闭+零网络零子进程。零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdmissionLedger } from '../lib/admission-pack.mjs';
import {
  ERROR_CODES, checkLayerCoverage, checkNoAutoAdmit, checkOneVote,
} from '../lib/admission-pack-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BORROWED = ['superpowers', 'bughunter', 'cli_anything', 'cli-anything'];
const NEIGHBOR = ['methodology', 'admission_check_placeholder',
                  'contract', 'evaluation', 'review_pipeline', 'supervision'];

const stripped = (rel) => readFileSync(join(HERE, rel), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const SOURCES = { mod: stripped('../lib/admission-pack.mjs'),
                  gate: stripped('../lib/admission-pack-gate.mjs') };

test('借鉴仓零符号（superpowers/bughunter/cli-anything）', () => {
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

test('机器不代行准入：无 approve/admit_/publish 符号', () => {
  for (const [k, src] of Object.entries(SOURCES)) {
    const names = [...src.matchAll(/function\s+(\w+)/g)].map((m) => m[1].toLowerCase());
    for (const w of ['approve', 'admit_', 'publish']) {
      assert.ok(!names.some((n) => n.includes(w)), k + ' 出现 ' + w);
    }
  }
});

test('准入结论词表封闭（四值）', () => {
  for (const a of ['可进收件箱', '不进（整改）', '待复核', '待补测']) {
    assert.equal(checkNoAutoAdmit(a).gate, 'pass', a);
  }
  assert.equal(checkNoAutoAdmit('自动准入').gate, 'block');
});

test('红线钉值：一票否决不可绕', () => {
  const d = checkOneVote([{ layer: 'L1_quality', verdict: '不过' }],
                         '可进收件箱');
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'ONE_VOTE_BYPASS');
});

test('红线钉值：账本 append-only（深拷贝隔离）', () => {
  const led = new AdmissionLedger(null);
  led.record({ layer: 'L1_quality', verdict: '过', evidence: '占位',
               checked_at: '2026-11-20T00:00:00Z' });
  const snapshot = led.entries();
  snapshot[0].verdict = '改（占位）';
  assert.equal(led.entries()[0].verdict, '过');
});

test('红线钉值：五层覆盖（缺层拦下）', () => {
  const d = checkLayerCoverage([{ layer: 'L1_quality', verdict: '过',
                                  evidence: '占位',
                                  checked_at: '2026-11-20T00:00:00Z' }]);
  assert.equal(d.gate, 'block');
  assert.equal(d.reasons[0].code, 'LAYER_COVERAGE_GAP');
});

test('词表封闭 + 零网络源扫描', () => {
  assert.deepEqual([...ERROR_CODES].sort(),
                   ['ADMISSION_LEDGER_DRIFT', 'AUTO_ADMIT',
                    'LAYER_COVERAGE_GAP', 'ONE_VOTE_BYPASS'].sort());
  for (const [k, src] of Object.entries(SOURCES)) {
    for (const banned of ['node:child_process', 'node:http', 'node:https',
                          'node:net', 'fetch(']) {
      assert.ok(!src.includes(banned), k + ' 出现 ' + banned);
    }
  }
});
