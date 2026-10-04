/**
 * 编排层单测（T21）
 * 运行：node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chunkHubs, buildHubList, runQuery } from './orchestrate.js';

// ── chunkHubs ────────────────────────────────────────────
test('chunkHubs：按 6 切分', () => {
  const chunks = chunkHubs(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 6);
  assert.deepEqual(chunks, [['a', 'b', 'c', 'd', 'e', 'f'], ['g', 'h']]);
});

test('chunkHubs：空数组 → 空', () => {
  assert.deepEqual(chunkHubs([], 6), []);
});

// ── buildHubList（D10）───────────────────────────────────
test('buildHubList：官方种子 + 兜底合并去重', () => {
  const hubs = buildHubList(['NKH', 'UUH'], [], ['NKH', 'WHN']);
  assert.deepEqual(hubs, ['NKH', 'UUH', 'WHN']);
});

test('buildHubList：剔除出发/到达站', () => {
  const hubs = buildHubList(['VNP', 'NKH'], ['VNP', 'AOH'], ['AOH', 'WHN']);
  assert.deepEqual(hubs, ['NKH', 'WHN']);
});

// ── runQuery ─────────────────────────────────────────────
/** 造一个可控的 api mock */
function mockApi({ baselineHubs = [], failSegments = [] } = {}) {
  const calls = { leftTicket: [], transfer: [] };
  return {
    calls,
    async leftTicket(p) {
      calls.leftTicket.push(p);
      return { ok: true, data: { data: { result: [] } } };
    },
    async transfer(p) {
      calls.transfer.push(p);
      const isBaseline = p.hubs.length === 1 && p.hubs[0] === '';
      if (isBaseline) {
        return { items: [{ key: '', ok: true, data: { data: { middleStationList: baselineHubs } } }] };
      }
      const items = p.hubs.map((h) =>
        failSegments.includes(h)
          ? { key: h, ok: false, error: '被拦截：302 → error.html' }
          : { key: h, ok: true, data: { data: { middleList: [] } } },
      );
      return { items };
    },
  };
}

test('runQuery：先查直达，再查基线', async () => {
  const api = mockApi({ baselineHubs: ['BME#白马北'] });
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {});
  assert.equal(api.calls.leftTicket.length, 1);
  assert.equal(api.calls.transfer[0].hubs[0], ''); // 基线第一
});

test('runQuery：回调顺序 —— onDirect → onBaseline → onSegment', async () => {
  const api = mockApi({ baselineHubs: ['NKH#南京南'] });
  const order = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onDirect: () => order.push('direct'),
    onBaseline: () => order.push('baseline'),
    onSegment: () => order.push('segment'),
    onDone: () => order.push('done'),
  });
  assert.equal(order[0], 'direct');
  assert.equal(order[1], 'baseline');
  assert.equal(order.at(-1), 'done');
  assert.ok(order.includes('segment'));
});

test('runQuery：枢纽分多段，逐段回调', async () => {
  const api = mockApi({ baselineHubs: [] });
  const segments = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onSegment: (s) => segments.push(s),
  });
  // 内置兜底 20 个枢纽，排除 VNP/AOH 后按 6 分段
  assert.ok(segments.length >= 3);
  assert.equal(segments[0].index, 0);
  assert.equal(segments[0].hubs.length, 6);
  assert.equal(segments.at(-1).total, segments.length);
});

test('runQuery：某段真错误 → 该段 error，其余段照常（T13）', async () => {
  const api = mockApi({ baselineHubs: [], failSegments: ['UUH'] });
  const segments = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onSegment: (s) => segments.push(s),
  });
  const bad = segments.find((s) => s.hubs.includes('UUH'));
  assert.match(bad.items.find((x) => x.key === 'UUH').error, /error\.html/);
  // 其余段正常
  assert.ok(segments.some((s) => s.hubs.some((h) => h !== 'UUH' && s.items.find((x) => x.key === h)?.ok)));
});

test('runQuery：基线失败不阻断后续枚举', async () => {
  const api = {
    calls: [],
    async leftTicket() {
      return { ok: true, data: null };
    },
    async transfer(p) {
      if (p.hubs[0] === '') throw new Error('baseline down');
      return { items: p.hubs.map((h) => ({ key: h, ok: true, data: {} })) };
    },
  };
  const segments = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onBaseline: (b) => assert.equal(b.ok, false),
    onSegment: (s) => segments.push(s),
  });
  assert.ok(segments.length >= 3); // 兜底枢纽仍然枚举了
});
