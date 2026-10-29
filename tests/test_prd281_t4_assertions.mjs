// PRD-281/T4 测试：投递路径断言——175 门不变（trend issue #1409）。
// 验收：结构断言通过。全程本地零网络（读的只是本仓库两个模块的源码文本）；
// 代码形态与示例全虚构。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  assertNoApplyDeps, assertGateReferencePresent, scanApplyDeps,
  ApplyPathDetected, GateReferenceMissing,
  APPLY_PATH_PATTERNS, REQUIRED_GATE_REFERENCE,
} from '../lib/profile-apply-assertions.mjs';

// 本条代码 = T2/T3 两个模块的全源（从磁盘读，静态扫描，零执行）
const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib');
const DRAFT_SOURCE = readFileSync(join(LIB_DIR, 'profile-draft.mjs'), 'utf8');
const FLOW_SOURCE = readFileSync(join(LIB_DIR, 'profile-confirm-flow.mjs'), 'utf8');
const TWO_MODULES = [
  { name: 'lib/profile-draft.mjs', source: DRAFT_SOURCE },
  { name: 'lib/profile-confirm-flow.mjs', source: FLOW_SOURCE },
];

const CLEAN_MODULE = `
// 虚构示例：只读档案字段做本地展示清单，零投递执行依赖
export function toChecklist(profile) {
  return Object.keys(profile).map((k) => \`- \${k}\`);
}
`;

// 六形态 × 各一命中样例（形态词出现在注释里同样算——保守绊线）
const SIX_FORMS = [
  ['submitApplication', 'api.submitApplication(form);'],
  ['autoApply', 'await autoApply(jobs);'],
  ['auto_apply', 'settings.auto_apply = true;'],
  ['applyToJob', 'applyToJob(job, resume);'],
  ['deliverResume', 'deliverResume(profile);'],
  ['直投端点 URL', 'fetch("https://api.example.com/v1/apply", { method: "POST" });'],
];

test('干净模块通过：无投递执行依赖 → ok:true，六形态绊线在岗', () => {
  const out = assertNoApplyDeps(CLEAN_MODULE);
  assert.equal(out.ok, true);
  assert.equal(out.modules, 1);
  assert.equal(out.patterns, 6, '六形态静态扫描');
  assert.equal(APPLY_PATH_PATTERNS.length, 6);
  assert.deepEqual(scanApplyDeps(CLEAN_MODULE), [], '单源扫描零命中');
});

test('六形态各一命中即抛：ApplyPathDetected 且理由指明形态', () => {
  for (const [label, snippet] of SIX_FORMS) {
    assert.throws(() => assertNoApplyDeps(snippet), (e) => {
      assert.ok(e instanceof ApplyPathDetected, `${label} 应抛 ApplyPathDetected`);
      assert.ok(e.matches.length >= 1, `${label} 应留命中形态`);
      return true;
    }, `形态「${label}」未被拦截`);
  }
});

test('两文件全源通过：profile-draft + profile-confirm-flow 全源零投递依赖', () => {
  // 先确认读到的是真模块本体（防读错文件让断言空转）
  assert.match(DRAFT_SOURCE, /export function makeDraft/);
  assert.match(FLOW_SOURCE, /export function confirmFlow/);
  const out = assertNoApplyDeps(TWO_MODULES);
  assert.equal(out.ok, true);
  assert.equal(out.modules, 2, '两个模块全源都在扫');
  // 单独扫每个模块同样干净
  assert.equal(scanApplyDeps(DRAFT_SOURCE).length, 0);
  assert.equal(scanApplyDeps(FLOW_SOURCE).length, 0);
});

test('175 门引用在场：两模块都带设计红线行；删行即抛 GateReferenceMissing', () => {
  const line = assertGateReferencePresent(TWO_MODULES);   // 不抛 = 两模块都在场
  assert.equal(line, REQUIRED_GATE_REFERENCE);
  assert.equal(REQUIRED_GATE_REFERENCE, '投递动作仍走 PRD-175 批准门');
  // 模拟红线行被删/漏写：断言必须拦下并指明缺失模块
  const stripped = FLOW_SOURCE.replaceAll(REQUIRED_GATE_REFERENCE, '投递动作另行处理');
  assert.throws(
    () => assertGateReferencePresent([
      { name: 'lib/profile-draft.mjs', source: DRAFT_SOURCE },
      { name: 'lib/profile-confirm-flow.mjs', source: stripped },
    ]),
    (e) => {
      assert.ok(e instanceof GateReferenceMissing);
      assert.deepEqual(e.moduleNames, ['lib/profile-confirm-flow.mjs']);
      assert.match(e.message, /lib\/profile-confirm-flow\.mjs/);
      return true;
    },
  );
  // 投递路径 + 门行双断言端到端：真模块同时过两道
  assert.equal(assertNoApplyDeps(TWO_MODULES).ok, true);
  assertGateReferencePresent(TWO_MODULES);
});

test('抛错含形态名与所在模块：多源命中可定位、命中片段留痕', () => {
  const dirty = [
    { name: 'lib/profile-draft.mjs', source: DRAFT_SOURCE },
    { name: 'lib/other-fictional.mjs', source: 'export const x = deliverResume(profile);' },
  ];
  assert.throws(() => assertNoApplyDeps(dirty), (e) => {
    assert.ok(e instanceof ApplyPathDetected);
    assert.match(e.message, /deliverResume/);                 // 形态名在场
    assert.match(e.message, /lib\/other-fictional\.mjs/);    // 模块名在场
    assert.deepEqual(e.moduleNames, ['lib/other-fictional.mjs']);
    assert.ok(e.matches.every((m) => typeof m.sample === 'string' && m.sample.length > 0),
      '命中片段留痕（可审计）');
    return true;
  });
  // 单字符串输入同样含形态名
  assert.throws(() => assertNoApplyDeps('run(); autoApply(job);'),
    (e) => /autoApply/.test(e.message));
});

test('确定性：同输入重复扫描结论与报错逐字节可复现（纯静态、无时钟无随机）', () => {
  for (const [label, snippet] of SIX_FORMS) {
    const a = scanApplyDeps(snippet);
    const b = scanApplyDeps(snippet);
    assert.deepEqual(a, b, `形态「${label}」重复扫描应全等`);
    assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
  }
  const e1 = (() => { try { assertNoApplyDeps('autoApply(x)'); } catch (e) { return e.message; } })();
  const e2 = (() => { try { assertNoApplyDeps('autoApply(x)'); } catch (e) { return e.message; } })();
  assert.equal(e1, e2, '报错消息逐字节一致');
  const clean1 = assertNoApplyDeps(TWO_MODULES);
  const clean2 = assertNoApplyDeps(TWO_MODULES);
  assert.deepEqual(clean1, clean2, '干净结论逐字段可复现');
});

test('用法错：非字符串源码一律 TypeError，不静默放行', () => {
  assert.throws(() => assertNoApplyDeps(null), TypeError);
  assert.throws(() => assertNoApplyDeps([{ name: 'x', source: 42 }]), TypeError);
  assert.throws(() => scanApplyDeps(123), TypeError);
  assert.throws(() => assertGateReferencePresent([{ name: 'x', source: null }]), TypeError);
});
