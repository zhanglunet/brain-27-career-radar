// PRD-577/T2 测试（trend #2896 的 T2 环节）：brain-27-career-radar 产物红队巡检。
//
// 运行：node --test tests/hunting-pack.test.mjs（仓库根执行）
//
// 覆盖：疑点词表封闭/复现器二值返回/runHunt 报告结论封闭/FINDING 留痕
// 四件缺一拒绝+repro 词表拒绝/CLI 落账/源码零网络。零网络；全合成占位。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FINDING_REQUIRED, FindingLedger, HuntError, HUNT_CONCLUSIONS,
  REPRO_VERDICTS, SUSPECTS, main, reproduce, runHunt,
} from '../lib/hunting-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD_SRC = readFileSync(join(HERE, '../lib/hunting-pack.mjs'), 'utf8');

const tail = (s) => s.split('_', 2)[1] || s;
const artifact = (poisoned = false) => ({
  name: '合成产物（占位）',
  text: poisoned
    ? '正文（占位）：' + SUSPECTS.map(tail).join('；') + '。'
    : '正文（占位）：这是一个干净的合成产物样例。',
  source_path: 'samples/artifact.md（占位）',
});

test('疑点词表封闭', () => {
  assert.equal(SUSPECTS.length, 4);
  for (const s of SUSPECTS) assert.ok(s.startsWith('S'), s);
});

test('复现器：干净产物全不复现', () => {
  for (const s of SUSPECTS) {
    assert.equal(reproduce(s, artifact()).verdict, '不复现', s);
  }
});

test('复现器：注入产物全复现', () => {
  for (const s of SUSPECTS) {
    const d = reproduce(s, artifact(true));
    assert.equal(d.verdict, '复现', s);
    assert.ok(d.evidence.includes('命中'), s);
  }
});

test('runHunt：干净 → 无可复现发现', () => {
  const r = runHunt(artifact());
  assert.equal(r.hunt, '无可复现发现');
  assert.deepEqual(r.findings, []);
  assert.ok(HUNT_CONCLUSIONS.includes(r.hunt));
});

test('runHunt：注入 → 有发现 + FINDING 四件齐', () => {
  const r = runHunt(artifact(true));
  assert.equal(r.hunt, '有发现');
  assert.equal(r.findings.length, SUSPECTS.length);
  for (const f of r.findings) {
    for (const k of FINDING_REQUIRED) {
      assert.ok(String(f[k] || '').trim(), k);
    }
  }
});

test('Ledger：四件缺一拒绝入账', () => {
  const led = new FindingLedger(null);
  for (const key of FINDING_REQUIRED) {
    const bad = { finding: '占位', repro: '复现', evidence: '占位',
                  found_at: '2026-11-20T09:00:00Z' };
    delete bad[key];
    assert.throws(() => led.record(bad), /FINDING_INCOMPLETE/,
                  '缺 ' + key + ' 未拦下');
  }
});

test('Ledger：repro 词表外拒绝（无复现证据不入账）', () => {
  const led = new FindingLedger(null);
  const bad = { finding: '占位', repro: '未复现', evidence: '占位',
                found_at: '2026-11-20T09:00:00Z' };
  assert.throws(() => led.record(bad), /REPRO_INVALID/);
});

test('Ledger：append-only 深拷贝隔离', () => {
  const led = new FindingLedger(null);
  led.record({ finding: '占位', repro: '复现', evidence: '占位',
               found_at: '2026-11-20T09:00:00Z' });
  const snapshot = led.entries();
  snapshot[0].finding = '改（占位）';
  assert.notEqual(led.entries()[0].finding, '改（占位）');
});

test('Ledger：JSONL 落盘', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunt-brain-'));
  const path = join(dir, 'findings.jsonl');
  const led = new FindingLedger(path);
  led.record({ finding: '占位', repro: '复现', evidence: '占位',
               found_at: '2026-11-20T09:00:00Z' });
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('"repro":"复现"'));
});

test('main CLI：报告落盘', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunt-cli-brain-'));
  const ap = join(dir, 'artifact.md');
  const rp = join(dir, 'out', 'report.json');
  writeFileSync(ap, artifact(true).text, 'utf8');
  const out = main(['--artifact', ap, '--report', rp]);
  assert.equal(out.hunt, '有发现');
  assert.ok(readFileSync(rp, 'utf8').includes('hunt'));
});

test('main CLI：缺参数显形拒绝', () => {
  assert.throws(() => main([]), HuntError);
});

test('源码零网络零子进程', () => {
  for (const banned of ['node:child_process', 'node:http', 'node:https',
                        'node:net', 'fetch(']) {
    assert.ok(!MOD_SRC.includes(banned), '模块出现 ' + banned);
  }
});
