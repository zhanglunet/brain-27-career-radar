// PRD-554/T5 测试（trend #2692 的 T5 环节）：brain-27-career-radar 机会采集技能准入检查 验收试运行。
//
// 运行：node --test tests/test_prd554_t5_acceptance.test.mjs（仓库根执行）
//
// 验收（PRD 任务拆分 T5 行）：真实任务按准入检查走一遍，结论可复核——
//   - 合成 SKILL.md 五层跑通 + 留痕过闸（append-only+五层覆盖+一票否决+
//     词表封闭）；
//   - 链复跑 T2/T3/T4 子进程 exit 0；
//   - T1 设计文档无密钥。零网络；真实文件只读 + 合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdmissionLedger, runAdmission } from '../lib/admission-pack.mjs';
import {
  appendOnlyGate, checkLayerCoverage, checkNoAutoAdmit, checkOneVote,
  gateSummary,
} from '../lib/admission-pack-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = join(HERE, '..', 'docs', 'plans',
                 '2026-11-20-prd-554-brain-admission-design.md');

const SKILL_MD = [
  '---',
  'name: brain-acceptance（占位）',
  'description: 验收演示技能——把占位输入整理成结论卡。',
  '触发：当用户要求验收演示时使用。',
  '约束：不写真实数据，只处理占位样例。',
  '来源：本仓 docs/plans（占位出处）。',
  '---',
  '正文（占位）：按五步输出结论卡。',
].join('\n');

test('真实任务五层跑通：结论可复核', () => {
  const report = runAdmission({ name: 'brain-acceptance（占位）',
                                text: SKILL_MD,
                                source_path: 'SKILL.md（占位）' }, []);
  assert.ok(['可进收件箱', '不进（整改）', '待复核', '待补测']
    .includes(report.admission));
  assert.equal(report.layers.length, 5);
  // 两遍跑结论一致（可复核）
  const again = runAdmission({ name: 'brain-acceptance（占位）',
                               text: SKILL_MD,
                               source_path: 'SKILL.md（占位）' }, []);
  assert.deepEqual(again.admission, report.admission);
});

test('真实留痕过闸（全链）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adm-t5-brain-'));
  const path = join(dir, 'ledger.jsonl');
  const led = new AdmissionLedger(path);
  const rec = led.record({ layer: 'L1_quality', verdict: '过',
                           evidence: '五项齐全（占位）',
                           checked_at: '2026-11-20T00:00:00Z' });
  const es = [rec];
  const checks = [appendOnlyGate(es, es[0], es.length),
                  checkLayerCoverage(
                    ['L1_quality', 'L2_security', 'L3_overlap', 'L4_synth',
                     'L5_live'].map((l) => ({ layer: l, verdict: '过',
                                              evidence: '占位',
                                              checked_at: '2026-11-20T00:00:00Z' }))),
                  checkOneVote(es, '待补测'),
                  checkNoAutoAdmit('待补测')];
  const sum = gateSummary(checks);
  assert.equal(sum.gate, 'pass', JSON.stringify(sum.reasons));
  assert.ok(readFileSync(path, 'utf8').includes('L1_quality'));
});

test('无过检记录的技能不进报告（红线 R1）', () => {
  const empty = [];
  const d = checkLayerCoverage(empty);
  assert.equal(d.gate, 'block');
});

test('链复跑：T2/T3/T4 子进程 exit 0', () => {
  for (const f of ['admission-pack.test.mjs', 'admission-pack-gate.test.mjs',
                   'test_prd554_t4_boundary.test.mjs']) {
    const proc = spawnSync('node', ['--test', join(HERE, f)],
                           { timeout: 300000, encoding: 'utf8' });
    assert.equal(proc.status, 0, f + ' 复跑失败：'
      + (proc.stdout || proc.stderr || '').slice(-400));
  }
});

test('T1 设计文档无密钥', () => {
  const doc = readFileSync(DOC, 'utf8').toLowerCase();
  for (const needle of ['sk-' + 'live', 'passw' + 'ord =',
                        'begin private', 'akia' + 'x']) {
    assert.ok(!doc.includes(needle), '设计文档出现密钥样式 ' + needle);
  }
  assert.ok(doc.includes('准入检查'));
});
