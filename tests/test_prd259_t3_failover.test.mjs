// PRD-259/T3 测试：主备切换与审计事件（trend issue #1297）。
// 验收：「切换有测试」。假源 fixture 零网络；示例全虚构（example.com 占位）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OpportunityLayer, exampleRegistry, STATES,
} from '../lib/opportunity-sources.mjs';

const FAILURES_TO_FAILED = 5; // 连续≥5 失败 → failed

function failedLayer(sid = 'jobs-rss-example') {
  const layer = new OpportunityLayer(exampleRegistry());
  for (let i = 0; i < FAILURES_TO_FAILED; i++) layer.recordResult(sid, 'error');
  return layer;
}

test('主源 failed 触发切换：source_failover 事件字段齐全，standbyInUse 更新为第一个备源', () => {
  const layer = failedLayer();
  const at = '2026-10-28T11:00:00Z';
  const ev = layer.failover('jobs-rss-example', at);
  assert.ok(ev, '应产生切换事件');
  assert.equal(ev.type, 'source_failover');
  assert.equal(ev.source_id, 'jobs-rss-example');
  assert.equal(ev.from, 'https://jobs.example.com/rss');
  assert.equal(ev.to, 'https://mirror.example.com/jobs-rss');
  assert.ok(ev.reason.startsWith('primary_failed:'), ev.reason);
  assert.equal(ev.at, at);
  assert.equal(layer.state('jobs-rss-example'), STATES.FAILED); // 切换不改变健康判定
  const doc = layer.doctorJson();
  assert.equal(doc.per_source[0].standby_in_use, 'https://mirror.example.com/jobs-rss');
});

test('非 failed（healthy/degraded/throttled）不切换、不产事件', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  const sid = 'jobs-rss-example';
  // healthy
  assert.equal(layer.failover(sid, '2026-10-28T10:00:00Z'), null);
  // degraded（连续 2 失败，未达 failed）
  layer.recordResult(sid, 'error');
  layer.recordResult(sid, 'error');
  assert.equal(layer.state(sid), STATES.DEGRADED);
  assert.equal(layer.failover(sid, '2026-10-28T10:01:00Z'), null);
  // throttled（429 限流≠故障，不触发切换）
  layer.recordResult(sid, 'ok');
  layer.recordResult(sid, '429');
  assert.equal(layer.state(sid), STATES.THROTTLED);
  assert.equal(layer.failover(sid, '2026-10-28T10:02:00Z'), null);
  assert.deepEqual(layer.exportEvents(), []);
  assert.equal(layer.consecutiveFailures(sid), 0); // 失败计数也未被切换动作扰动
});

test('无备源：failed 后 failover 不产事件、standbyInUse 保持空', () => {
  const layer = failedLayer('listing-page-example'); // 该源 standbys: []
  assert.equal(layer.failover('listing-page-example', '2026-10-28T11:00:00Z'), null);
  assert.deepEqual(layer.exportEvents(), []);
  assert.equal(layer.doctorJson().per_source[1].standby_in_use, null);
});

test('恢复切回留痕：主源探测成功后 restore 产 source_restore 事件并切回主源', () => {
  const layer = failedLayer();
  layer.failover('jobs-rss-example', '2026-10-28T11:00:00Z');
  layer.recordResult('jobs-rss-example', 'ok'); // 主源恢复探测成功
  const ev = layer.restore('jobs-rss-example', '2026-10-28T12:00:00Z');
  assert.ok(ev, '应产生切回事件');
  assert.equal(ev.type, 'source_restore');
  assert.equal(ev.source_id, 'jobs-rss-example');
  assert.equal(ev.from, 'https://mirror.example.com/jobs-rss');
  assert.equal(ev.to, 'https://jobs.example.com/rss');
  assert.equal(ev.at, '2026-10-28T12:00:00Z');
  assert.equal(layer.doctorJson().per_source[0].standby_in_use, null);
  // 不在备源上时 restore 无切回可留痕：不产事件
  assert.equal(layer.restore('jobs-rss-example', '2026-10-28T12:01:00Z'), null);
  assert.equal(layer.exportEvents().length, 2);
});

test('切换不清零连续失败计数（failover 与 restore 均为路由动作）', () => {
  const layer = failedLayer();
  const before = layer.consecutiveFailures('jobs-rss-example');
  assert.equal(before, FAILURES_TO_FAILED);
  layer.failover('jobs-rss-example', '2026-10-28T11:00:00Z');
  assert.equal(layer.consecutiveFailures('jobs-rss-example'), before); // 切换不清零
  layer.recordResult('jobs-rss-example', 'ok'); // 只有成功探测才复位
  layer.restore('jobs-rss-example', '2026-10-28T12:00:00Z');
  assert.equal(layer.consecutiveFailures('jobs-rss-example'), 0);
});

test('审计事件可序列化：exportEvents 深拷贝，JSON 往返逐字段一致', () => {
  const layer = failedLayer();
  layer.failover('jobs-rss-example', '2026-10-28T11:00:00Z');
  layer.recordResult('jobs-rss-example', 'ok');
  layer.restore('jobs-rss-example', '2026-10-28T12:00:00Z');
  const events = layer.exportEvents();
  const roundTrip = JSON.parse(JSON.stringify(events));
  assert.deepEqual(roundTrip, events);
  // 深拷贝：改导出值不影响内部
  events[0].type = 'tampered';
  assert.equal(layer.exportEvents()[0].type, 'source_failover');
});

test('在用备源也失败：再次 failover 切下一个备源；备源耗尽不产事件', () => {
  const entry = { ...exampleRegistry()[0],
    standbys: [
      { url: 'https://mirror.example.com/jobs-rss', tos_url: 'https://mirror.example.com/tos', rate_limit: { requests_per_min: 6, burst: 3 } },
      { url: 'https://mirror2.example.com/jobs-rss', tos_url: 'https://mirror2.example.com/tos', rate_limit: { requests_per_min: 6, burst: 3 } },
    ] };
  const layer = new OpportunityLayer([entry]);
  const sid = 'jobs-rss-example';
  for (let i = 0; i < FAILURES_TO_FAILED; i++) layer.recordResult(sid, 'error');
  assert.equal(layer.failover(sid, '2026-10-28T11:00:00Z').to, 'https://mirror.example.com/jobs-rss');
  layer.recordResult(sid, 'error'); // 在用备源也失败（计数 6，仍 failed）
  const ev2 = layer.failover(sid, '2026-10-28T11:05:00Z');
  assert.equal(ev2.from, 'https://mirror.example.com/jobs-rss');
  assert.equal(ev2.to, 'https://mirror2.example.com/jobs-rss');
  assert.equal(layer.consecutiveFailures(sid), 6); // 二次切换同样不清零
  layer.recordResult(sid, 'error'); // 第二备源也失败
  assert.equal(layer.failover(sid, '2026-10-28T11:10:00Z'), null); // 无更多备源：不产事件
  assert.equal(layer.exportEvents().length, 2); // 只有两次成功切换留痕
});
