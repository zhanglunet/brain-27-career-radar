// PRD-260/T2 测试：求职实操录制——白名单/PII 免字段/J-1~J-4 脱敏/回放（trend issue #1301）。
// 验收：「样例时间线无 PII」。全程本地零网络；示例全虚构；密钥样例占位形态。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newCapture, addStep, finishCapture, dumpCapture, CaptureBlocked,
} from '../lib/job-capture.mjs';

const baseStep = (over = {}) => ({
  seq: 1, surface_kind: 'site-form', action: '打开示例站点的申请表单',
  intent: '看清表单结构', field_kind: 'none', pi_involved: false, ...over,
});

test('白名单：多余字段丢弃+告警；缺必填阻断', () => {
  let cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  cap = addStep(cap, baseStep({ browser_note: '额外字段' }));
  assert.ok(cap._warnings.some((w) => w.includes('browser_note')));
  assert.throws(() => addStep(cap, { seq: 2 }), CaptureBlocked);
});

test('值类禁录字段出现即失败（PII 无侧门）', () => {
  const cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  for (const bad of [{ form_value: '张三' }, { resume_text: '五年经验…' }, { value: '13800138000' }]) {
    assert.throws(() => addStep(cap, baseStep(bad)), /FORBIDDEN/, JSON.stringify(bad));
  }
});

test('pi_involved 只记布尔：涉及 PII 的步骤标记而非记录内容', () => {
  let cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  cap = addStep(cap, baseStep({ action: '填写联系方式字段', field_kind: 'text', pi_involved: true }));
  assert.equal(cap.steps[0].pi_involved, true);
  const blob = dumpCapture(finishCapture(cap, '完成'));
  assert.ok(!/\d{11}/.test(blob)); // 无手机号
});

test('J-1 邮箱/手机号阻断（action 与 jobseeker 两处）', () => {
  const cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'listing-triage');
  assert.throws(() => addStep(cap, baseStep({ action: '发送到 someone@example.com' })), /J-1/);
  assert.throws(() => newCapture('2026-10-28T10:00:00Z', '联系 13812345678', 'form-navigation'), /J-1/);
});

test('J-2 疑似简历句式阻断', () => {
  const cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'resume-check');
  const longResume = '工作经历：' + '负责示例项目，熟练掌握多项技能，取得虚构成果。'.repeat(3);
  assert.throws(() => addStep(cap, baseStep({ action: longResume })), /J-2/);
});

test('J-3 带 token 的 URL 阻断', () => {
  const cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  assert.throws(() => addStep(cap, baseStep({ action: '访问 https://example.com/apply?session=abcdef123456' })), /J-3/);
});

test('J-4 内部词替换', () => {
  let cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  cap = addStep(cap, baseStep({ action: '同步到内部系统' }));
  assert.ok(cap.steps[0].action.includes('<INTERNAL>'));
});

test('全流程回放：虚构求职实操产出时间线，无 PII/值泄漏', () => {
  let cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  cap = addStep(cap, baseStep());
  cap = addStep(cap, baseStep({ seq: 2, action: '填写工作年限下拉', field_kind: 'select', pi_involved: true, intent: '如实选择区间' }));
  cap = addStep(cap, baseStep({ seq: 3, action: '上传前检查文件格式', field_kind: 'file', intent: '确认 PDF', surface_kind: 'doc' }));
  cap = finishCapture(cap, 'type-导航路径完成');
  const blob = dumpCapture(cap);
  const parsed = JSON.parse(blob);
  assert.equal(parsed.schema, 'job-capture-v1');
  assert.equal(parsed.steps.length, 3);
  assert.equal(parsed.steps[1].pi_involved, true);
  assert.ok(!/\d{11}/.test(blob));
  assert.equal(dumpCapture(cap), blob); // 确定性
});
