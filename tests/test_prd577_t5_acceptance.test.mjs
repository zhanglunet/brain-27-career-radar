// PRD-577/T5 测试（trend #2899 的 T5 环节）：验收试运行。
//
// 运行：node --test tests/test_prd577_t5_acceptance.test.mjs（仓库根执行）
//
// 验收：合成产物全疑点跑通 + FINDING 留痕过闸 + 两遍一致 + 链复跑
// T2/T3/T4 子进程 exit 0 + T1 设计文档无密钥。零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FINDING_REQUIRED, FindingLedger, SUSPECTS, main, runHunt }
  from '../lib/hunting-pack.mjs';
import {
  appendOnlyGate, checkFpVeto, checkHuntVocab, checkReproEvidence,
  gateSummary,
} from '../lib/hunting-pack-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = join(HERE, '..', 'docs', 'plans',
                 '2026-11-20-prd-577-brain-hunting-design.md');
const tail = (s) => s.split('_', 2)[1] || s;
const poisoned = () => '正文（占位）：' + SUSPECTS.map(tail).join('；') + '。';

test('真实产物巡检：两遍一致可复核', () => {
  const a = runHunt({ name: '合成产物（占位）', text: poisoned(),
                      source_path: 'samples（占位）' });
  const b = runHunt({ name: '合成产物（占位）', text: poisoned(),
                      source_path: 'samples（占位）' });
  assert.equal(a.hunt, b.hunt);
  assert.equal(a.hunt, '有发现');
  assert.equal(a.findings.length, SUSPECTS.length);
});

test('CLI 真实跑一遍', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunt-t5-brain-'));
  const ap = join(dir, 'artifact.md');
  const rp = join(dir, 'report.json');
  writeFileSync(ap, poisoned(), 'utf8');
  const out = main(['--artifact', ap, '--report', rp]);
  assert.equal(out.hunt, '有发现');
});

test('FINDING 留痕过全闸', () => {
  const r = runHunt({ name: '合成产物（占位）', text: poisoned(),
                      source_path: 'samples（占位）' });
  const dir = mkdtempSync(join(tmpdir(), 'hunt-gates-brain-'));
  const led = new FindingLedger(join(dir, 'findings.jsonl'));
  const entries = r.findings.map((f) => led.record(f));
  for (const f of entries) {
    for (const k of FINDING_REQUIRED) {
      assert.ok(String(f[k] || '').trim(), k);
    }
  }
  const checks = [appendOnlyGate(entries, entries[0], entries.length),
                  checkReproEvidence(entries), checkFpVeto(entries),
                  checkHuntVocab(r.hunt)];
  const sum = gateSummary(checks);
  assert.equal(sum.gate, 'pass', JSON.stringify(sum.reasons));
});

test('无复现证据的 finding 不入账（红线 R1）', () => {
  const d = checkReproEvidence([{ finding: '占位', repro: '未复现',
                                  evidence: '', found_at: '占位' }]);
  assert.equal(d.gate, 'block');
});

test('链复跑：T2/T3/T4 子进程 exit 0', () => {
  for (const f of ['hunting-pack.test.mjs', 'hunting-pack-gate.test.mjs',
                   'test_prd577_t4_boundary.test.mjs']) {
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
  assert.ok(doc.includes('巡检'));
});
