// PRD-260/T4 测试：投递路径断言——仍强制走 PRD-175 批准门（trend issue #1303）。
// 验收：断言测试通过。全程本地零网络；示例公司/岗位/代码形态全虚构。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newCapture, addStep, finishCapture } from '../lib/job-capture.mjs';
import { draftFromCapture, REQUIRED_GATE_LINE } from '../lib/job-skill-draft.mjs';
import {
  assertNoApplyPath, assertGateLinePresent,
  ApplyPathDetected, GateLineMissing, APPLY_PATH_PATTERNS,
} from '../lib/apply-path-assertions.mjs';

const CLEAN_MODULE = `
// 示例岗位列表拉取模块（虚构）：只读公开 RSS，零投递路径
export async function fetchJobs(feedUrl) {
  const res = await fetch(feedUrl);
  return res.text();
}
export function toChecklist(items) {
  return items.map((j) => \`- [ ] 浏览：\${j.title}（仅记录，不提交）\`);
}
`;

test('干净模块通过：无直投形态 → ok:true，且形态表非空（绊线在岗）', () => {
  const out = assertNoApplyPath(CLEAN_MODULE);
  assert.equal(out.ok, true);
  assert.ok(out.patterns >= 5, '至少 5 类静态形态在扫');
  assert.ok(APPLY_PATH_PATTERNS.length >= 5);
});

test('含 autoApply 形态抛错：ApplyPathDetected 且理由指明形态', () => {
  const src = 'export async function run() { await autoApply(job); }';
  assert.throws(() => assertNoApplyPath(src), (e) => {
    assert.ok(e instanceof ApplyPathDetected);
    assert.match(e.message, /autoApply/);
    assert.ok(e.matches.some((m) => /autoApply/.test(m.why)));
    return true;
  });
});

test('含 submitApplication 抛错（注释里出现同样算——保守绊线）', () => {
  const src = '// 这里以后接 submitApplication // 虚构\nexport const x = 1;';
  assert.throws(() => assertNoApplyPath(src), ApplyPathDetected);
  const src2 = 'api.submitApplication(form);';
  assert.throws(() => assertNoApplyPath(src2), (e) => /submitApplication/.test(e.message));
});

test('直接投递 API 调用形态抛错：POST 到 /apply 端点（两种形态）', () => {
  // 形态 A：带 scheme 的直投端点 URL 字面量
  const srcA = 'const r = await fetch("https://api.example.com/v1/applications/create", opts);';
  assert.throws(() => assertNoApplyPath(srcA), (e) => /直投端点 URL/.test(e.message));
  // 形态 B：method POST 与 /apply 路径同现
  const srcB = 'request("/jobs/1/apply", { method: "POST", body });';
  assert.throws(() => assertNoApplyPath(srcB), (e) => /POST/.test(e.message));
});

test('缺门清单行抛错：GateLineMissing；非字符串同样拒绝', () => {
  const bad = '# 某技能清单\n- [ ] 步骤 1：打开页面\n- [ ] 步骤 2：检查表单';
  assert.throws(() => assertGateLinePresent(bad), GateLineMissing);
  assert.throws(() => assertGateLinePresent(''), GateLineMissing);
  assert.throws(() => assertGateLinePresent(null), TypeError);
});

test('门行在场通过：T3 草稿正文过断言并原样返回固定清单行', () => {
  let cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  cap = addStep(cap, { seq: 1, surface_kind: 'site-form', action: '打开示例站点的申请表单', intent: '看清结构', field_kind: 'none', pi_involved: false });
  cap = finishCapture(cap, 'type-导航路径完成');
  const { bodyMarkdown } = draftFromCapture(cap, { name: '示例导航清单', description: '适用场景（虚构）' });
  const line = assertGateLinePresent(bodyMarkdown);           // 不抛 = 在场
  assert.equal(line, REQUIRED_GATE_LINE);
  // 缺失场景：把固定行从正文中删掉（模拟被删/漏插）→ 断言必须拦下
  const stripped = bodyMarkdown.replace(REQUIRED_GATE_LINE, '- [ ] 普通清单项');
  assert.throws(() => assertGateLinePresent(stripped), GateLineMissing);
  // 端到端：干净草稿同时过两道断言（无直投形态 + 门行在场）
  assert.equal(assertNoApplyPath(bodyMarkdown).ok, true);
  assertNoApplyPath(CLEAN_MODULE);
});
