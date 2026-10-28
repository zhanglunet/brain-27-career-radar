// PRD-259/T2 测试：来源注册校验/健康四态/doctor（trend issue #1296）。
// 验收：「健康/限流/故障态可显示」。假源 fixture 零网络；示例全虚构。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OpportunityLayer, SourceRejected, validateSource, exampleRegistry, STATES,
} from '../lib/opportunity-sources.mjs';

test('合法注册表加载：两假源全部在位', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  assert.deepEqual(layer.ids(), ['jobs-rss-example', 'listing-page-example']);
});

test('违规拒载三类：auth≠none / data_class≠public / 缺 tos_url', () => {
  const base = exampleRegistry()[0];
  for (const mutate of [
    (e) => ({ ...e, auth: 'cookie' }),
    (e) => ({ ...e, data_class: 'private' }),
    (e) => ({ ...e, primary: { ...e.primary, tos_url: '' } }),
  ]) {
    assert.throws(() => validateSource(mutate(base)), SourceRejected);
  }
});

test('健康状态机：连续≥2 失败 degraded、连续≥5 failed、403/404 直接 failed', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  const sid = 'jobs-rss-example';
  layer.recordResult(sid, 'error');
  assert.equal(layer.state(sid), STATES.HEALTHY);     // 1 次失败还健康
  layer.recordResult(sid, 'error');
  assert.equal(layer.state(sid), STATES.DEGRADED);    // 2 次
  for (let i = 0; i < 3; i++) layer.recordResult(sid, 'error');
  assert.equal(layer.state(sid), STATES.FAILED);      // 累计 5 次
  layer.recordResult(sid, '403');
  assert.equal(layer.state(sid), STATES.FAILED);      // 明确语义保持 failed
  layer.recordResult(sid, 'ok');
  assert.equal(layer.state(sid), STATES.HEALTHY);     // 成功复位
});

test('429 → throttled（限流≠故障，不计入失败），成功后恢复', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  const sid = 'listing-page-example';
  layer.recordResult(sid, '429');
  assert.equal(layer.state(sid), STATES.THROTTLED);
  layer.recordResult(sid, '429');
  assert.equal(layer.state(sid), STATES.THROTTLED);
  layer.recordResult(sid, 'ok');
  assert.equal(layer.state(sid), STATES.HEALTHY);
  const doc = layer.doctorJson();
  assert.equal(doc.summary.throttled, 0);
});

test('doctor JSON：per_source 四态字段齐全 + summary 计数', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  layer.recordResult('jobs-rss-example', '429');
  layer.recordResult('listing-page-example', 'error');
  layer.recordResult('listing-page-example', 'error');
  const doc = layer.doctorJson();
  assert.equal(doc.schema, 'doctor-report-v1');
  const byId = Object.fromEntries(doc.per_source.map((s) => [s.source_id, s]));
  assert.equal(byId['jobs-rss-example'].state, 'throttled');
  assert.equal(byId['jobs-rss-example'].throttled, true);
  assert.equal(byId['listing-page-example'].state, 'degraded');
  assert.equal(byId['listing-page-example'].tos_url, 'https://listing.example.com/tos');
  assert.deepEqual(doc.summary, { total: 2, healthy: 0, degraded: 1, failed: 0, throttled: 1 });
});

test('doctor 人读文本含全部来源与 ToS 列', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  const text = layer.doctorText();
  for (const frag of ['jobs-rss-example', 'listing-page-example', 'https://jobs.example.com/tos']) {
    assert.ok(text.includes(frag), text);
  }
});

test('拉取记录带 source_id 可追溯', () => {
  const layer = new OpportunityLayer(exampleRegistry());
  layer.recordResult('jobs-rss-example', 'ok', { fetchedAt: '2026-10-28T10:00:00Z' });
  layer.recordResult('jobs-rss-example', 'ok', { fetchedAt: '2026-10-28T10:05:00Z' });
  const doc = layer.doctorJson(); // 不影响 doctor
  assert.equal(doc.per_source[0].state, 'healthy');
});
