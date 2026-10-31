// PRD-260/T3 测试：清单技能草稿生成 + 人 review 状态（trend issue #1302）。
// 验收：「草稿含 review 状态」。全程本地零网络；示例公司/岗位/表单全虚构。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newCapture, addStep, finishCapture,
} from '../lib/job-capture.mjs';
import {
  draftFromCapture, renderSkillMd, removeGateLine,
  REQUIRED_GATE_TEXT, REQUIRED_GATE_LINE, DraftRejected,
} from '../lib/job-skill-draft.mjs';

function sampleCapture() {
  let cap = newCapture('2026-10-28T10:00:00Z', '<JOBSEEKER>', 'form-navigation');
  cap = addStep(cap, { seq: 1, surface_kind: 'site-form', action: '打开示例站点的申请表单', intent: '看清表单结构', field_kind: 'none', pi_involved: false });
  cap = addStep(cap, { seq: 2, surface_kind: 'site-form', action: '填写工作年限下拉', intent: '如实选择区间', field_kind: 'select', pi_involved: true });
  cap = addStep(cap, { seq: 3, surface_kind: 'doc', action: '上传前检查文件格式', intent: '确认是 PDF', field_kind: 'file', pi_involved: false });
  return finishCapture(cap, 'type-导航路径完成');
}

const draftArgs = () => ({ name: '示例站点申请表导航清单', description: '适用场景：在示例站点填写申请表前的检查清单（虚构）' });

test('草稿含 review 状态与 recorded 来源：frontmatter 四块齐全', () => {
  const { frontmatter } = draftFromCapture(sampleCapture(), draftArgs());
  assert.deepEqual(frontmatter.review, { state: 'draft', reviewer: '', decided_at: '' });
  assert.equal(frontmatter.source, 'recorded');
  assert.equal(frontmatter.triggers.canonical.length, 1);
  assert.deepEqual(frontmatter.triggers.colloquial, []);
  assert.equal(frontmatter.name, '示例站点申请表导航清单');
  // 渲染出的 SKILL.md 同样可见 review 块（人 review 依据）
  const md = renderSkillMd(draftFromCapture(sampleCapture(), draftArgs()));
  assert.ok(md.includes('state: draft') && md.includes('source: recorded'), md);
});

test('固定批准门清单项在场且 required：生成器强制插入，requiredGateLine 返回', () => {
  const { bodyMarkdown, requiredGateLine } = draftFromCapture(sampleCapture(), draftArgs());
  assert.ok(bodyMarkdown.includes(REQUIRED_GATE_TEXT));
  assert.ok(bodyMarkdown.includes('required:true'));
  assert.equal(requiredGateLine, REQUIRED_GATE_LINE);
  assert.ok(bodyMarkdown.includes(REQUIRED_GATE_LINE));
  assert.ok(bodyMarkdown.includes('## 投递前置检查项'));
  // 渲染整份 SKILL.md 仍然在场（T4 断言口径的前置）
  assert.ok(renderSkillMd(draftFromCapture(sampleCapture(), draftArgs())).includes(REQUIRED_GATE_LINE));
});

test('非法输入拒绝：空步骤/缺 name/缺 description/非 job-capture-v1', () => {
  assert.throws(() => draftFromCapture({ schema: 'job-capture-v1', task_kind: 'other', steps: [] }, draftArgs()), DraftRejected);
  const cap = sampleCapture();
  assert.throws(() => draftFromCapture(cap, { description: 'x' }), DraftRejected);
  assert.throws(() => draftFromCapture(cap, { name: 'x' }), DraftRejected);
  assert.throws(() => draftFromCapture({ schema: 'other', steps: [{ seq: 1, surface_kind: 'doc' }] }, draftArgs()), DraftRejected);
});

test('确定性：同输入两次生成逐字节一致（frontmatter+body+整份渲染）', () => {
  const a = draftFromCapture(sampleCapture(), draftArgs());
  const b = draftFromCapture(sampleCapture(), draftArgs());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(renderSkillMd(a), renderSkillMd(b));
});

test('removeGateLine 恒 false：required 固定项不可删（含/缺该行都拒绝）', () => {
  const { bodyMarkdown } = draftFromCapture(sampleCapture(), draftArgs());
  assert.equal(removeGateLine(bodyMarkdown), false);        // 含固定项：拒绝删除
  assert.equal(removeGateLine('没有固定项的正文'), false);   // 缺固定项：闸门校验同样失败
  assert.equal(removeGateLine(''), false);
});

test('正文含全部步骤 action（清单逐步对应录制时间线）', () => {
  const { bodyMarkdown } = draftFromCapture(sampleCapture(), draftArgs());
  for (const frag of ['打开示例站点的申请表单', '填写工作年限下拉', '上传前检查文件格式']) {
    assert.ok(bodyMarkdown.includes(frag), `缺步骤动作: ${frag}`);
  }
  assert.ok(bodyMarkdown.includes('该步涉及个人信息')); // pi_involved 步骤带"注意什么"
});

test('整份草稿无 PII 值泄漏：渲染产物只有清单与占位，不带求职者身份', () => {
  const md = renderSkillMd(draftFromCapture(sampleCapture(), draftArgs()));
  assert.ok(!/\d{11}/.test(md) && !/@/.test(md)); // 无手机号/邮箱形态
  assert.ok(!md.includes('<JOBSEEKER>')); // 技能清单不携带求职者身份（who 无关，只有 how）
});
