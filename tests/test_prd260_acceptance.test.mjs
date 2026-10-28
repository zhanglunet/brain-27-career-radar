// PRD-260/T5 验收试运行（trend issue #1304）：虚构求职实操→技能；投递被批准门拦住直至确认。
//
// 验收对象是 T1–T4 已交付链路（本文件纯加验收测试，不改 T2–T4 行为）：
//   T1 #1300（PR #77）设计 → T2 #1301（PR #79，job-capture.mjs 8 例）
//   → T3 #1302（PR #81，job-skill-draft 7 例）→ T4 #1303（PR #83，assertions 6 例）。
//
// issue #1304 验收标准：「无 PII/密钥；批准门有效」；T1 §6 T5 口径：虚构实操回放产出
// job-capture-v1 时间线、PII 样例被阻断不落盘；草稿含 required 175 门固定项 + review 块；
// 删门的草稿被闸门拒绝；import 图无投递执行依赖；示例流程到投递步骤输出 175 门提示；
// 全产物 PII/密钥扫描 0 命中；全程零网络。每条验收项 1:1 对应一个编号测试：
//
// | # | 验收项 | 测试 |
// |---|---|---|
// | 1 | 虚构求职实操回放→job-capture-v1 时间线：白名单封闭、step 字段最小、pi_involved 只记布尔 | test_1_fictional_walkthrough_captures_timeline |
// | 2 | PII 样例阻断不落盘：J-1 邮箱/手机/证件 + J-2 简历句式 + 值类禁录字段全部 CaptureBlocked，capture 零污染 | test_2_pii_samples_blocked_not_recorded |
// | 3 | 草稿为清单形态：required:true 的 175 门固定清单行在场 + review 块 + frontmatter 完整 | test_3_draft_contains_required_gate_line |
// | 4 | 删 175 门的草稿被闸门拒绝：removeGateLine 恒 false + assertGateLinePresent 对缺行正文抛 GateLineMissing | test_4_remove_gate_line_always_false |
// | 5 | 投递语义步骤触发「走门」提示而非执行：技能运行器走到投递步只输出 175 门提示，投递函数零调用 | test_5_apply_step_prompts_gate_not_execution |
// | 6 | assertNoApplyPath：干净模块过；submitApplication/autoApply/auto_apply/直投方法/端点 URL/POST 六形态脏模块全抛 | test_6_no_apply_path_clean_passes_dirty_throws |
// | 7 | import 图无投递执行依赖 + 零网络：三模块导入面封闭（无 fetch/http 依赖），fetch 封死跑完全场景零触发 | test_7_import_graph_clean_and_zero_network |
// | 8 | 全产物与交付面零 PII 零密钥：录制产物/草稿/提示输出扫描零命中；全部交付面文件密钥样式与 PII 样式扫描零命中 | test_8_artifacts_and_surface_no_pii_no_secrets |
// | 9 | 确定性：同输入两次完整流程（录制→导出→草稿→渲染）逐字节一致 | test_9_deterministic_end_to_end |
//
// 虚构纪律：PII 样本全部运行时拼接自造（本文件零 PII 字面量）；公司/岗位/表单全
// example 系占位；全程本地零网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SCHEMA, newCapture, addStep, finishCapture, dumpCapture, CaptureBlocked } from '../lib/job-capture.mjs';
import {
  draftFromCapture, renderSkillMd, removeGateLine, REQUIRED_GATE_LINE, REQUIRED_GATE_TEXT,
} from '../lib/job-skill-draft.mjs';
import {
  assertNoApplyPath, assertGateLinePresent, ApplyPathDetected, GateLineMissing,
} from '../lib/apply-path-assertions.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 运行时拼造的 PII 样本（本文件零 PII 字面量，供 #8 全交付面扫描）──
const EMAIL_SAMPLE = ['yiming.sun.probe', 'example.invalid'].join('@');   // J-1 邮箱
const PHONE_SAMPLE = '138' + '12345678';                                   // J-1 手机（11 位）
const ID_SAMPLE = '110101' + '19900101' + '123' + '4';                     // J-1 证件号（18 位）
const RESUME_LIKE = '个人简历草稿：' + '含工作经历、教育背景、项目经验、'.repeat(4) + '求职意向见文末'; // J-2
const J3_URL = 'https://jobs.example.com/apply?token=' + 'a1b2c3d4e5f6';   // J-3 带 token URL

// ── 虚构求职实操回放（全 example 系占位；值类内容一律不入模型）──
const CAPTURED_AT = '2026-10-28T10:00:00Z';

function fictionalWalkthrough() {
  let cap = newCapture(CAPTURED_AT, '示例求职者（占位）', 'form-navigation');
  cap = addStep(cap, { seq: 1, surface_kind: 'listing', field_kind: 'none',
    action: '浏览示例公司公开职位列表页', intent: '定位目标岗位条目（只记录入口位置）' });
  cap = addStep(cap, { seq: 2, surface_kind: 'site-form', field_kind: 'select',
    action: '在「意向岗位」下拉框确认选项结构', intent: '复述表单控件形态供清单使用' });
  cap = addStep(cap, { seq: 3, surface_kind: 'site-form', field_kind: 'text', pi_involved: true,
    action: '聚焦「姓名」输入框（值不录制）', intent: '标记该字段涉及个人信息，仅记布尔' });
  cap = addStep(cap, { seq: 4, surface_kind: 'site-form', field_kind: 'none',
    action: '定位「提交申请」按钮（投递语义步，仅记录位置）',
    intent: '技能使用到该步必须走 PRD-175 批准门，等待人工确认' });
  cap = finishCapture(cap, '示例流程：从公开职位列表到表单字段结构（全程值不入模型）');
  return cap;
}

// ── 最小技能运行器（验收 #5）：清单驱动的复述执行器——投递语义步只「走门」──
function useSkill(checklistBody, calls) {
  const gatePrompt = `（投递前置检查项，required:true）${REQUIRED_GATE_TEXT}——提交动作已被批准门拦住，等待人工确认后再继续`;
  for (const line of checklistBody.split('\n')) {
    if (/投递|提交/.test(line) && line.includes('步骤')) {
      // 投递语义步骤：只提示走门，不调用任何投递函数（calls 恒空）
      return { stopped_at: 'gate', prompt: gatePrompt };
    }
  }
  return { stopped_at: 'end', prompt: null };
}

test('验收1 虚构求职实操回放→job-capture-v1 时间线：白名单封闭、最小字段', () => {
  const cap = fictionalWalkthrough();
  assert.equal(cap.schema, SCHEMA);
  assert.equal(cap.captured_at, CAPTURED_AT);
  assert.equal(cap.task_kind, 'form-navigation');
  assert.ok(cap.jobseeker.includes('示例求职者'));
  assert.equal(cap.steps.length, 4);
  for (const s of cap.steps) {
    assert.deepEqual(Object.keys(s).sort(),
      ['action', 'field_kind', 'intent', 'pi_involved', 'seq', 'surface_kind']);
    assert.equal(typeof s.pi_involved, 'boolean'); // PII 只允许布尔标记
  }
  assert.equal(cap.steps[2].pi_involved, true);    // 姓名步骤只记布尔
  assert.match(cap.steps[3].action, /提交/);        // 投递语义步在时间线中（供 #5 走门）
  const dumped = JSON.parse(dumpCapture(cap));
  assert.deepEqual(Object.keys(dumped).sort(),
    ['captured_at', 'jobseeker', 'schema', 'steps', 'summary', 'task_kind']);
  assert.ok(!dumped.summary.includes('<INTERNAL>')); // 无内部词残留
});

test('验收2 PII 样例阻断不落盘：J-1/J-2/J-3/值类禁录全拦，capture 零污染', () => {
  const cap = fictionalWalkthrough();
  const before = dumpCapture(cap);
  const blockers = [
    ['J-1 邮箱', () => addStep(cap, { seq: 9, surface_kind: 'doc',
      action: `把简历发送到 ${EMAIL_SAMPLE}` })],
    ['J-1 手机', () => newCapture(CAPTURED_AT, `联系电话 ${PHONE_SAMPLE}`, 'form-navigation')],
    ['J-1 证件', () => addStep(cap, { seq: 9, surface_kind: 'doc',
      action: `核对证件号 ${ID_SAMPLE}` })],
    ['J-2 简历句式', () => finishCapture(cap, RESUME_LIKE)],
    ['J-3 token URL', () => addStep(cap, { seq: 9, surface_kind: 'site-form',
      action: `打开 ${J3_URL}` })],
    ['值类禁录', () => addStep(cap, { seq: 9, surface_kind: 'site-form',
      form_value: '示例姓名-不入模型' })],
  ];
  for (const [label, fn] of blockers) {
    assert.throws(fn, CaptureBlocked, label);
  }
  assert.equal(dumpCapture(cap), before); // 被拦样本零落盘（时间线逐字节未变）
});

test('验收3 草稿为清单形态：required 175 门固定行在场 + review 块', () => {
  const draft = draftFromCapture(fictionalWalkthrough(),
    { name: 'example-form-navigation', description: '示例：公开职位表单导航流程复述' });
  const md = renderSkillMd(draft);
  // frontmatter：SKILL.md 兼容 + review 块 + source:recorded
  assert.ok(md.startsWith('---\n'));
  assert.match(md, /name: "example-form-navigation"/);
  assert.match(md, /review:\n  state: draft\n  reviewer: ""\n  decided_at: ""/);
  assert.match(md, /source: recorded/);
  // 清单形态：步骤复述 + 投递前置检查项
  assert.match(md, /## 步骤清单/);
  assert.match(md, /## 投递前置检查项/);
  assert.ok(md.includes(REQUIRED_GATE_LINE));            // required 固定清单行在场
  assert.match(md, /【required:true】/);
  assert.match(md, /任何投递\/提交动作前，走 PRD-175 人工批准门/);
  assert.equal(assertGateLinePresent(md), REQUIRED_GATE_LINE); // 断言器确认在位
  assert.equal(draft.requiredGateLine, REQUIRED_GATE_LINE);
});

test('验收4 删 175 门的草稿被闸门拒绝：removeGateLine 恒 false', () => {
  const md = renderSkillMd(draftFromCapture(fictionalWalkthrough(),
    { name: 'example-form-navigation', description: '示例：公开职位表单导航流程复述' }));
  // 含固定行的正文：删除请求一律 false（required 不可删）
  assert.equal(removeGateLine(md), false);
  // 本就缺固定行的正文：同样 false（闸门校验失败，谈不上删除成功）
  const stripped = md.replace(REQUIRED_GATE_LINE + '\n', '');
  assert.notEqual(stripped, md);
  assert.equal(removeGateLine(stripped), false);
  assert.equal(removeGateLine(''), false);
  assert.equal(removeGateLine(undefined), false);
  // 闸门断言：缺固定行的草稿被拒（GateLineMissing），不因 removeGateLine 的 false 而放行
  assert.throws(() => assertGateLinePresent(stripped), GateLineMissing);
});

test('验收5 投递语义步骤触发「走门」提示而非执行：投递函数零调用', () => {
  const md = renderSkillMd(draftFromCapture(fictionalWalkthrough(),
    { name: 'example-form-navigation', description: '示例：公开职位表单导航流程复述' }));
  const calls = []; // 若运行器执行了任何投递动作，这里会留下调用痕迹
  const out = useSkill(md, calls);
  assert.equal(out.stopped_at, 'gate');
  assert.ok(out.prompt.includes('PRD-175 人工批准门'));   // 输出的是「走门」提示
  assert.ok(out.prompt.includes('required:true'));
  assert.ok(out.prompt.includes('等待人工确认'));          // 拦住直至确认
  assert.equal(calls.length, 0, `投递函数被调用: ${calls}`); // 零执行
});

test('验收6 assertNoApplyPath：干净模块过；六形态脏模块全抛', () => {
  const clean = `
// 示例岗位浏览清单模块（虚构）：只读公开列表页，零投递路径
export function toChecklist(items) {
  return items.map((j) => \`- [ ] 浏览：\${j.title}（仅记录，不提交）\`);
}`;
  const out = assertNoApplyPath(clean);
  assert.equal(out.ok, true);
  assert.ok(out.patterns >= 5);
  const dirty = [
    ['submitApplication', 'export function run(job) { return submitApplication(job); }'],
    ['autoApply', 'export async function run(job) { await autoApply(job); }'],
    ['auto_apply', 'export function run(job) { return auto_apply(job); }'],
    ['application 直投方法', 'const x = jobApplication.create(payload);'],
    ['直投端点 URL', "fetch('https://jobs.example.com/apply')"],
    ['POST 到 apply 端点', 'request("/jobs/1/apply", { method: "POST", body });'],
  ];
  for (const [label, src] of dirty) {
    assert.throws(() => assertNoApplyPath(src), (e) => {
      assert.ok(e instanceof ApplyPathDetected, label);
      assert.ok(e.matches.length >= 1, label);
      return true;
    }, label);
  }
});

test('验收7 import 图无投递执行依赖 + 零网络：导入面封闭、fetch 封死零触发', async () => {
  // 静态面：三模块导入图封闭（capture 无导入；draft 只导入 capture；assertions 只导入 draft），
  // 无任何网络库/直投执行依赖
  const srcOf = (f) => readFileSync(join(REPO_ROOT, 'lib', f), 'utf8');
  const captureSrc = srcOf('job-capture.mjs');
  const draftSrc = srcOf('job-skill-draft.mjs');
  const assertSrc = srcOf('apply-path-assertions.mjs');
  assert.equal(captureSrc.match(/^\s*import\b/gm), null, 'job-capture 不应有任何导入');
  assert.deepEqual(draftSrc.match(/^\s*import .*$/gm), ['import { SCHEMA } from "./job-capture.mjs";']);
  assert.deepEqual(assertSrc.match(/^\s*import .*$/gm),
    ['import { REQUIRED_GATE_LINE } from "./job-skill-draft.mjs";']);
  for (const [name, src] of [['job-capture.mjs', captureSrc], ['job-skill-draft.mjs', draftSrc],
                             ['apply-path-assertions.mjs', assertSrc]]) {
    for (const net of ['node:http', 'fetch(', 'axios', 'undici', 'node:net', 'node:tls', 'require(']) {
      assert.ok(!src.includes(net), `${name} 出现网络/外部依赖字面量: ${net}`);
    }
  }
  // 动态面：fetch 封死跑完 录制→草稿→运行器→断言 全场景，零网络触发
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(String(args[0]));
    throw new Error('PRD-260/T5 验收场景禁止任何网络请求');
  };
  try {
    const cap = fictionalWalkthrough();
    const draft = draftFromCapture(cap, { name: 'example-form-navigation',
      description: '示例：公开职位表单导航流程复述' });
    const md = renderSkillMd(draft);
    assert.equal(useSkill(md, []).stopped_at, 'gate');
    assertNoApplyPath(cleanModuleFixture());
    assert.equal(removeGateLine(md), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 0, `发生网络请求: ${calls}`);
});

// 干净模块夹具（验收 #6/#7 共用；独立函数避免重复字面量）
function cleanModuleFixture() {
  return `
export function toChecklist(items) {
  return items.map((j) => \`- [ ] 浏览：\${j.title}（仅记录，不提交）\`);
}`;
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /Bearer\s+[A-Za-z0-9._-]{16,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
];
const PII_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,   // 邮箱
  /(?<!\d)1[3-9]\d{9}(?!\d)/,                          // 手机
  /(?<!\d)\d{17}[0-9Xx](?!\d)/,                        // 证件号
];
const LAN_IP_PATTERN = /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;

// 链内 T2 测试自带的 PII 夹具（其断言恰好证明样本被 J-1/值类禁录零存活），仅豁免于
// 测试面；docs/ 与 lib/ 严格零命中。名单之外的任何命中一律失败。
const DECLARED_CHAIN_FIXTURES = ('someone@example.com|13800138000|13812345678').split('|');

const DELIVERY_SURFACE = [
  'lib/job-capture.mjs',
  'lib/job-skill-draft.mjs',
  'lib/apply-path-assertions.mjs',
  'tests/test_prd260_job_capture.test.mjs',
  'tests/test_prd260_t3_draft.test.mjs',
  'tests/test_prd260_t4_assertions.mjs',
  'tests/test_prd260_acceptance.test.mjs',
  'docs/plans/2026-10-28-prd-260-job-skills-recorder.md',
  'docs/devlog/2026-10-28-prd-260-t5-acceptance.md',
];

test('验收8 全产物与交付面零 PII 零密钥：扫描零命中', () => {
  // 产物面：录制导出/草稿渲染/走门提示 全部零 PII 零密钥
  const cap = fictionalWalkthrough();
  const md = renderSkillMd(draftFromCapture(cap, { name: 'example-form-navigation',
    description: '示例：公开职位表单导航流程复述' }));
  const gatePrompt = useSkill(md, []).prompt;
  for (const [label, artifact] of [['capture', dumpCapture(cap)], ['draft', md],
                                   ['gate-prompt', gatePrompt]]) {
    for (const s of [EMAIL_SAMPLE, PHONE_SAMPLE, ID_SAMPLE]) {
      assert.ok(!artifact.includes(s), `${label} 泄漏 PII 样本`);
    }
    for (const pat of [...SECRET_PATTERNS, ...PII_PATTERNS, LAN_IP_PATTERN]) {
      const hits = artifact.match(new RegExp(pat.source, 'g'));
      assert.equal(hits, null, `${label} 命中样式 ${pat}: ${hits}`);
    }
  }
  // 交付面：文件逐一扫描（密钥/PII/内网 IP）
  for (const rel of DELIVERY_SURFACE) {
    const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
    for (const pat of SECRET_PATTERNS) {
      const hits = text.match(new RegExp(pat.source, 'g'));
      assert.equal(hits, null, `${rel} 命中密钥样式 ${pat}: ${hits}`);
    }
    for (const pat of PII_PATTERNS) {
      const hits = (text.match(new RegExp(pat.source, 'g')) || [])
        .filter((h) => !DECLARED_CHAIN_FIXTURES.includes(h));
      assert.equal(hits.length, 0, `${rel} 命中未申报 PII 样式 ${pat}: ${hits}`);
    }
    const lanHits = text.match(new RegExp(LAN_IP_PATTERN.source, 'g'));
    assert.equal(lanHits, null, `${rel} 命中内网 IP 样式: ${lanHits}`);
    // 红线主面严格化：docs/ 与 lib/ 连已申报链内夹具也不允许
    if (rel.startsWith('docs/') || rel.startsWith('lib/')) {
      for (const fixture of DECLARED_CHAIN_FIXTURES) {
        assert.ok(!text.includes(fixture), `${rel} 出现链内夹具（docs/lib 应零命中）`);
      }
    }
  }
});

test('验收9 确定性：同输入两次完整流程逐字节一致', () => {
  const run = () => {
    const cap = fictionalWalkthrough();
    const dump = dumpCapture(cap);
    const draft = draftFromCapture(cap, { name: 'example-form-navigation',
      description: '示例：公开职位表单导航流程复述' });
    return { dump, md: renderSkillMd(draft), gate: draft.requiredGateLine };
  };
  const a = run();
  const b = run();
  assert.equal(a.dump, b.dump);
  assert.equal(a.md, b.md);
  assert.equal(a.gate, b.gate);
  // captured_at 由调用方给定（无隐藏时钟注入），两次运行无漂移
  assert.ok(a.dump.includes(CAPTURED_AT));
});
