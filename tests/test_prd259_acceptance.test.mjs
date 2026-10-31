// PRD-259/T5 验收试运行（trend issue #1299）：模拟限流与切换——不绕登录墙、无密钥。
//
// 验收对象是 T1–T4 已交付链路（本文件纯加验收测试，不改 T2–T4 行为）：
//   T1 #1295（PR #76）设计 → T2 #1296（PR #78，opportunity-sources.mjs 7 例）
//   → T3 #1297（PR #80，failover 7 例）→ T4 #1298（PR #82，boundary 5 例）。
//
// issue #1299 验收标准：「不绕登录墙；无密钥」；T1 §6 T5 口径：故障/限流注入后
// doctor 四态一一对应；failed 自动切备 + 审计事件；恢复切回留痕；违规条目拒载。
// 每条验收项 1:1 对应一个编号测试：
//
// | # | 验收项 | 测试 |
// |---|---|---|
// | 1 | 模拟主源故障→failed→切换：source_failover 事件字段齐全（source_id/from/to/reason/at），standbyInUse 更新，健康判定不被切换动作扰动 | test_1_primary_failed_failover_event |
// | 2 | 429 throttled 分列：限流≠故障（不进 failed、不触发切换），doctor summary.throttled 独立计数 | test_2_429_throttled_listed_separately |
// | 3 | 恢复切回留痕：source_restore 事件（备源→主源），事件序列 [failover, restore] 有序，restore 后新一轮切换可用 | test_3_restore_after_recovery |
// | 4 | 违规条目拒载：auth≠none / 缺 tos_url / data_class≠public 逐条 SourceRejected；混入坏条目的注册表整表拒载 | test_4_invalid_entries_rejected |
// | 5 | doctor JSON 四态一一对应：healthy/degraded/failed/throttled 四源四态，per_source 与 summary 全等 | test_5_doctor_json_four_states |
// | 6 | 不绕登录墙：结构断言（auth 只收 "none"，cookie/bearer/basic 全拒）+ 交付模块代码路径字面量扫描零命中 | test_6_no_login_wall_bypass |
// | 7 | 零网络：fetch 封死跑完故障/限流/切换/恢复/doctor 全场景零触发；模块无网络库导入 | test_7_zero_network |
// | 8 | 交付面无密钥：PRD-259 全部交付面（源码/测试/设计稿/验收记录）密钥样式与内网 IP 样式扫描零命中 | test_8_delivery_surface_no_secrets |
//
// 虚构纪律：来源 fixture 全 example.com 占位；零网络；零密钥。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  OpportunityLayer, SourceRejected, validateSource, exampleRegistry, STATES,
} from '../lib/opportunity-sources.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FAILURES_TO_FAILED = 5; // 连续≥5 失败 → failed（T1 §3.2）

function failedLayer(sid = 'jobs-rss-example') {
  const layer = new OpportunityLayer(exampleRegistry());
  for (let i = 0; i < FAILURES_TO_FAILED; i++) layer.recordResult(sid, 'error');
  return layer;
}

// 四源四态注册表（全 example.com 占位，供 #5 doctor 四态一一对应）
function fourStateRegistry() {
  const mk = (id, standbys = []) => ({
    schema: 'opportunity-source-v1', source_id: id, kind: 'rss',
    primary: { url: `https://${id}.example.com/rss`, tos_url: `https://${id}.example.com/tos`,
               rate_limit: { requests_per_min: 6, burst: 3 } },
    standbys, auth: 'none', data_class: 'public', enabled: true,
  });
  return [
    mk('src-healthy'),
    mk('src-degraded'),
    mk('src-failed', [{ url: 'https://src-failed-mirror.example.com/rss',
                        tos_url: 'https://src-failed-mirror.example.com/tos',
                        rate_limit: { requests_per_min: 6, burst: 3 } }]),
    mk('src-throttled'),
  ];
}

function fourStateLayer() {
  const layer = new OpportunityLayer(fourStateRegistry());
  layer.recordResult('src-degraded', 'error');
  layer.recordResult('src-degraded', 'error');            // 连续 2 → degraded
  for (let i = 0; i < FAILURES_TO_FAILED; i++) layer.recordResult('src-failed', 'error');
  layer.recordResult('src-throttled', '429');             // 429 → throttled（限流≠故障）
  return layer;
}

test('验收1 模拟主源故障→failed→切换：source_failover 事件字段齐全', () => {
  const layer = failedLayer();
  assert.equal(layer.state('jobs-rss-example'), STATES.FAILED);
  const at = '2026-10-28T11:00:00Z';
  const ev = layer.failover('jobs-rss-example', at);
  assert.ok(ev, 'failed 后应产生切换事件');
  assert.equal(ev.type, 'source_failover');
  assert.equal(ev.source_id, 'jobs-rss-example');
  assert.equal(ev.from, 'https://jobs.example.com/rss');
  assert.equal(ev.to, 'https://mirror.example.com/jobs-rss'); // 第一个可用备源
  assert.ok(ev.reason.startsWith('primary_failed:'), ev.reason);
  assert.equal(ev.at, at);
  // 切换是路由动作：健康判定与失败计数不被扰动（复位只由成功驱动）
  assert.equal(layer.state('jobs-rss-example'), STATES.FAILED);
  assert.equal(layer.consecutiveFailures('jobs-rss-example'), FAILURES_TO_FAILED);
  assert.equal(layer.doctorJson().per_source[0].standby_in_use, 'https://mirror.example.com/jobs-rss');
  // 审计导出可序列化且与事件一致（机读存档面）
  assert.deepEqual(layer.exportEvents(), [ev]);
});

test('验收2 429 throttled 分列：不进 failed、不触发切换、doctor 独立计数', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  const sid = 'jobs-rss-example';
  layer.recordResult(sid, '429');
  layer.recordResult(sid, '429');
  assert.equal(layer.state(sid), STATES.THROTTLED);
  assert.equal(layer.failover(sid, '2026-10-28T10:00:00Z'), null); // 限流≠故障，不切换
  assert.deepEqual(layer.exportEvents(), []);                      // 不产事件
  const doc = layer.doctorJson();
  assert.equal(doc.summary.throttled, 1);
  assert.equal(doc.summary.failed, 0);
  assert.equal(doc.per_source[0].throttled, true);
  assert.equal(doc.per_source[0].state, 'throttled');
});

test('验收3 恢复切回留痕：source_restore 事件 + 序列有序 + restore 后可再切换', () => {
  const layer = failedLayer();
  layer.failover('jobs-rss-example', '2026-10-28T11:00:00Z');
  layer.recordResult('jobs-rss-example', 'ok'); // 主源恢复探测成功
  const ev = layer.restore('jobs-rss-example', '2026-10-28T11:05:00Z');
  assert.ok(ev, '备源在用时恢复应有切回事件');
  assert.equal(ev.type, 'source_restore');
  assert.equal(ev.source_id, 'jobs-rss-example');
  assert.equal(ev.from, 'https://mirror.example.com/jobs-rss');
  assert.equal(ev.to, 'https://jobs.example.com/rss');
  assert.equal(layer.doctorJson().per_source[0].standby_in_use, null);
  // 事件序列 [failover, restore] 有序可追溯（导出深拷贝，外部改动不影响内部）
  const events = layer.exportEvents();
  assert.deepEqual(events.map((e) => e.type), ['source_failover', 'source_restore']);
  events.length = 0; // 篡改导出副本
  assert.equal(layer.exportEvents().length, 2);
  // restore 后新一轮故障可再次切换（deadStandbys 已清空）
  for (let i = 0; i < FAILURES_TO_FAILED; i++) layer.recordResult('jobs-rss-example', 'error');
  const again = layer.failover('jobs-rss-example', '2026-10-28T11:10:00Z');
  assert.ok(again, 'restore 后新一轮 failed 应能再切到备源');
  assert.equal(again.to, 'https://mirror.example.com/jobs-rss');
});

test('验收4 违规条目拒载：auth≠none / 缺 tos / data_class≠public 逐条拒绝+整表拒载', () => {
  const base = exampleRegistry()[0];
  const violations = [
    ['auth≠none(cookie)', (e) => ({ ...e, auth: 'cookie' })],
    ['auth≠none(bearer)', (e) => ({ ...e, auth: 'bearer' })],
    ['缺 tos_url', (e) => ({ ...e, primary: { ...e.primary, tos_url: '' } })],
    ['data_class≠public', (e) => ({ ...e, data_class: 'private' })],
  ];
  for (const [label, mutate] of violations) {
    assert.throws(() => validateSource(mutate(base)), SourceRejected, label);
  }
  // 混入坏条目的注册表整表拒载：构造函数在坏条目处抛出，坏源不进注册表
  assert.throws(() => new OpportunityLayer([exampleRegistry()[1], { ...base, auth: 'cookie' }]),
                SourceRejected);
});

test('验收5 doctor JSON 四态一一对应：per_source 与 summary 全等', () => {
  const layer = fourStateLayer();
  const doc = layer.doctorJson();
  assert.equal(doc.schema, 'doctor-report-v1');
  const byId = Object.fromEntries(doc.per_source.map((s) => [s.source_id, s]));
  assert.equal(byId['src-healthy'].state, 'healthy');
  assert.equal(byId['src-degraded'].state, 'degraded');
  assert.equal(byId['src-failed'].state, 'failed');
  assert.equal(byId['src-throttled'].state, 'throttled');
  assert.deepEqual(doc.summary, { total: 4, healthy: 1, degraded: 1, failed: 1, throttled: 1 });
  // ToS 列在位（来源声明可追溯）
  assert.equal(byId['src-healthy'].tos_url, 'https://src-healthy.example.com/tos');
});

test('验收6 不绕登录墙：auth 只收 none（结构断言）+ 代码路径字面量零命中', () => {
  // 结构断言：需要登录态/令牌的来源在注册口即被拒（不绕、也不收）
  const base = exampleRegistry()[0];
  for (const auth of ['cookie', 'bearer', 'basic', 'session']) {
    assert.throws(() => validateSource({ ...base, auth }), SourceRejected, `auth=${auth}`);
  }
  // 代码路径扫描：交付模块无任何登录墙绕过语义的字面量
  const src = readFileSync(join(REPO_ROOT, 'lib', 'opportunity-sources.mjs'), 'utf8');
  const bypassPatterns = [
    /cookie/i, /csrf/i, /session[_-]?id/i, /authorization/i, /bearer\s/i,
    /x-api-key/i, /password/i, /sign ?in/i, /localstorage/i, /puppeteer/i,
    /playwright/i, /stealth/i, /user-?agent/i,
  ];
  for (const pat of bypassPatterns) {
    const hits = src.match(new RegExp(pat.source, 'gi'));
    assert.equal(hits, null, `交付模块命中登录墙绕过样式 ${pat}: ${hits}`);
  }
});

test('验收7 零网络：fetch 封死跑完全场景零触发 + 无网络库导入', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(String(args[0]));
    throw new Error('PRD-259/T5 验收场景禁止任何网络请求');
  };
  try {
    const layer = fourStateLayer();                       // 故障/限流注入
    layer.failover('src-failed', '2026-10-28T12:00:00Z'); // 切换
    layer.recordResult('src-failed', 'ok');
    layer.restore('src-failed', '2026-10-28T12:05:00Z');  // 恢复
    const doc = layer.doctorJson();                       // doctor
    assert.equal(doc.summary.total, 4);
    const text = layer.doctorText();
    assert.ok(text.includes('src-failed'));
    assert.deepEqual(layer.exportEvents().map((e) => e.type),
                     ['source_failover', 'source_restore']);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 0, `发生网络请求: ${calls}`);
  // 静态面：交付模块零网络库导入（模块自身完全不触网）
  const src = readFileSync(join(REPO_ROOT, 'lib', 'opportunity-sources.mjs'), 'utf8');
  assert.equal(src.match(/^\s*(?:import\b|const\s+\w+\s*=\s*require\b)/gm), null,
               '交付模块不应有任何模块导入（含网络库）');
  for (const net of ['node:http', 'node:https', 'node:net', 'node:tls', 'node:fetch', 'undici', 'axios', 'got(']) {
    assert.ok(!src.includes(net), `交付模块出现网络库字面量: ${net}`);
  }
});

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /Bearer\s+[A-Za-z0-9._-]{16,}/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
];
const LAN_IP_PATTERN = /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;

const DELIVERY_SURFACE = [
  'lib/opportunity-sources.mjs',
  'tests/test_prd259_source_layer.test.mjs',
  'tests/test_prd259_t3_failover.test.mjs',
  'tests/test_prd259_t4_boundary.py',
  'tests/test_prd259_acceptance.test.mjs',
  'docs/plans/2026-10-28-prd-259-opportunity-source-layer.md',
  'docs/plans/2026-10-28-prd-259-boundary-117-203.md',
  'docs/devlog/2026-10-28-prd-259-t5-acceptance.md',
];

test('验收8 交付面无密钥：PRD-259 全部交付面密钥/内网 IP 样式零命中', () => {
  for (const rel of DELIVERY_SURFACE) {
    const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
    for (const pat of SECRET_PATTERNS) {
      const hits = text.match(new RegExp(pat.source, 'g'));
      assert.equal(hits, null, `${rel} 命中密钥样式 ${pat}: ${hits}`);
    }
    const lanHits = text.match(new RegExp(LAN_IP_PATTERN.source, 'g'));
    assert.equal(lanHits, null, `${rel} 命中内网 IP 样式: ${lanHits}`);
    assert.ok(!/https:\/\/10\./.test(text), `${rel} 出现内网 http 端点`);
  }
});
