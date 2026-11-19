// PRD-554/T2 测试（trend #2689 的 T2 环节）：brain-27-career-radar 机会采集技能准入检查 最小实现。
//
// 运行：node --test tests/admission-pack.test.mjs（仓库根执行）
//
// 覆盖（T1 §2 五层 + 红线）：L1 静态完整性五项/L2 安全扫描/L3 重叠检测
// （差异化文本防假阳性）/L4 合成评测带钉值/L5 待补测诚实口径/留痕 JSONL
// 四件缺一拒绝/CLI/源码零网络。零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMISSION_SCHEMA, AdmissionError, AdmissionLedger, ENTRY_REQUIRED,
  LAYERS, STATIC_KEYS, VERDICTS, frontmatter, jaccard, main,
  overlapCheck, runAdmission, scalar, securityScan, staticChecks,
  synthEval,
} from '../lib/admission-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD_SRC = readFileSync(join(HERE, '../lib/admission-pack.mjs'), 'utf8');

const goodSkill = () => ({
  name: 'brain-demo（占位）',
  text: [
    '---',
    'name: brain-demo（占位）',
    'description: 演示用技能，把输入整理成结论卡（占位）。',
    '触发：当用户要求演示整理时使用。',
    '约束：不写真实数据，只处理占位样例。',
    '来源：本仓 docs/plans（占位出处）。',
    '---',
    '正文（占位）：按步骤输出结论卡。',
  ].join('\n'),
  source_path: 'skills/brain-demo/SKILL.md',
});

test('L1 质量门：五项齐全全过', () => {
  const s = staticChecks(goodSkill());
  for (const k of STATIC_KEYS) assert.equal(s[k], true, k);
});

test('L1 质量门：缺 description 记不过', () => {
  const skill = goodSkill();
  skill.text = skill.text.replace(/description: .*\n/, '');
  const s = staticChecks(skill);
  assert.equal(s.description, false);
});

test('L2 安全扫描：命中拦截', () => {
  const skill = goodSkill();
  skill.text += '\n调试示例：DROP TABLE（占位）';
  const d = securityScan(skill);
  assert.equal(d.verdict, '不过');
  assert.ok(d.hits.includes('DROP TABLE'));
});

test('L2 安全扫描：干净文本放行', () => {
  assert.equal(securityScan(goodSkill()).verdict, '过');
});

test('L3 重叠检测：差异化文本不误报', () => {
  const other = { id: 'other（占位）',
                  text: '红烧排骨做法：焯水去腥，冰糖炒糖色，加生抽老抽' 
                    + '与热水炖四十分钟，大火收汁即可装盘上桌。' };
  const d = overlapCheck(goodSkill(), [other]);
  assert.equal(d.verdict, '过');
});

test('L3 重叠检测：高度相似记疑似', () => {
  const twin = { id: 'twin（占位）', text: goodSkill().text };
  const d = overlapCheck(goodSkill(), [twin]);
  assert.equal(d.verdict, '疑似');
  assert.equal(d.suspects[0].against, 'twin（占位）');
});

test('L4 合成评测：带钉值', () => {
  const d = synthEval(goodSkill());
  assert.equal(d.verdict, '过');
  assert.equal(d.questions[0].pin, 'SKILL.md description 原文');
});

test('L5 实测评估：无对照判待补测（不编造）', () => {
  assert.equal(runAdmission(goodSkill(), []).live.verdict, '待补测');
});

test('runAdmission：安全命中 → 不进（整改）', () => {
  const skill = goodSkill();
  skill.text += '\nAPI_KEY=（占位）';
  const r = runAdmission(skill, []);
  assert.equal(r.admission, '不进（整改）');
});

test('runAdmission：仅重叠疑似 → 待复核', () => {
  const twin = { id: 'twin（占位）', text: goodSkill().text };
  const r = runAdmission(goodSkill(), [twin]);
  assert.equal(r.admission, '待复核');
});

test('runAdmission：干净 → 待补测（L5 无对照）+ 层词表封闭', () => {
  const r = runAdmission(goodSkill(), []);
  assert.equal(r.admission, '待补测');
  assert.deepEqual(r.layers.map((l) => l.layer), [...LAYERS]);
  assert.ok(VERDICTS.includes('待补测'));
  assert.equal(r.schema, ADMISSION_SCHEMA);
});

test('Ledger：四件缺一拒绝入账', () => {
  const led = new AdmissionLedger(null);
  for (const key of ENTRY_REQUIRED) {
    const bad = { layer: 'L1_quality', verdict: '过',
                  evidence: '占位', checked_at: '2026-11-20T00:00:00Z' };
    delete bad[key];
    assert.throws(() => led.record(bad), /ENTRY_INCOMPLETE/,
                  '缺 ' + key + ' 未拦下');
  }
});

test('Ledger：append-only 深拷贝隔离', () => {
  const led = new AdmissionLedger(null);
  const rec = led.record({ layer: 'L1_quality', verdict: '过',
                           evidence: '占位', checked_at: '2026-11-20T00:00:00Z' });
  rec.verdict = '改（占位）';
  assert.equal(led.entries()[0].verdict, '过');
});

test('Ledger：JSONL 落盘 append-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adm-brain-'));
  const path = join(dir, 'ledger.jsonl');
  const led = new AdmissionLedger(path);
  led.record({ layer: 'L2_security', verdict: '过', evidence: '占位',
               checked_at: '2026-11-20T00:00:00Z' });
  led.record({ layer: 'L3_overlap', verdict: '过', evidence: '占位',
               checked_at: '2026-11-20T00:00:00Z' });
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('"layer":"L2_security"'));
});

test('frontmatter/scalar 工具函数', () => {
  const fm = frontmatter(goodSkill().text);
  assert.equal(scalar(fm, 'name'), 'brain-demo（占位）');
  assert.equal(jaccard(new Set(['ab']), new Set(['ab'])), 1);
});

test('main CLI：报告落盘', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adm-cli-brain-'));
  const skillPath = join(dir, 'SKILL.md');
  const reportPath = join(dir, 'out', 'report.json');
  writeFileSync(skillPath, goodSkill().text, 'utf8');
  const out = main(['--skill', skillPath, '--report', reportPath]);
  assert.ok(['可进收件箱', '不进（整改）', '待复核', '待补测']
    .includes(out.admission));
  assert.ok(readFileSync(reportPath, 'utf8').includes('admission'));
});

test('main CLI：缺参数显形拒绝', () => {
  assert.throws(() => main([]), AdmissionError);
});

test('源码零网络零子进程', () => {
  for (const banned of ['node:child_process', 'node:http', 'node:https',
                        'node:net', 'fetch(']) {
    assert.ok(!MOD_SRC.includes(banned), '模块出现 ' + banned);
  }
});
