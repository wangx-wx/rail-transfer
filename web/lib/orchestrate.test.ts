/**
 * 编排层单测（T21）
 * 运行：npm test
 */

import { test, expect } from 'vitest';

import { chunkHubs, buildHubList, runQuery } from './orchestrate.ts';
import type { QueryApi, SegmentResult } from './orchestrate.ts';
import type { LeftTicketData, TransferData, UpstreamEnvelope } from '../../shared/types.ts';

// ── chunkHubs ────────────────────────────────────────────
test('chunkHubs：按 6 切分', () => {
  const chunks = chunkHubs(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 6);
  expect(chunks).toEqual([['a', 'b', 'c', 'd', 'e', 'f'], ['g', 'h']]);
});

test('chunkHubs：空数组 → 空', () => {
  expect(chunkHubs([])).toEqual([]);
});

// ── buildHubList（D10）───────────────────────────────────
test('buildHubList：官方种子 + 兜底合并去重', () => {
  const hubs = buildHubList(['NKH', 'UUH'], [], ['NKH', 'WHN']);
  expect(hubs).toEqual(['NKH', 'UUH', 'WHN']);
});

test('buildHubList：剔除出发/到达站', () => {
  const hubs = buildHubList(['VNP', 'NKH'], ['VNP', 'AOH'], ['AOH', 'WHN']);
  expect(hubs).toEqual(['NKH', 'WHN']);
});

// ── runQuery ─────────────────────────────────────────────
/** 造一个可控的 api mock */
function mockApi({ baselineHubs = [], failSegments = [] }: { baselineHubs?: string[]; failSegments?: string[] } = {}): QueryApi & {
  calls: { leftTicket: Array<{ from: string; to: string; date: string }>; transfer: Array<{ hubs: string[] }> };
} {
  const calls = {
    leftTicket: [] as Array<{ from: string; to: string; date: string }>,
    transfer: [] as Array<{ hubs: string[] }>,
  };
  return {
    calls,
    async leftTicket(p) {
      calls.leftTicket.push(p);
      return { ok: true, data: { data: { result: [] } } as UpstreamEnvelope<LeftTicketData> };
    },
    async transfer(p) {
      calls.transfer.push({ hubs: p.hubs });
      const isBaseline = p.hubs.length === 0;
      if (isBaseline) {
        return {
          ok: true,
          items: [
            { key: '', ok: true, data: { data: { middleStationList: baselineHubs } } as UpstreamEnvelope<TransferData> },
          ],
        };
      }
      const items = p.hubs.map((h) =>
        failSegments.includes(h)
          ? { key: h, ok: false, error: '被拦截：302 → error.html' }
          : { key: h, ok: true, data: { data: { middleList: [] } } as UpstreamEnvelope<TransferData> },
      );
      return { ok: true, items };
    },
  };
}

test('runQuery：先查直达，再查基线', async () => {
  const api = mockApi({ baselineHubs: ['BME#白马北'] });
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {});
  expect(api.calls.leftTicket).toHaveLength(1);
  expect(api.calls.transfer[0]!.hubs).toEqual([]); // 基线第一
});

test('runQuery：回调顺序 —— onDirect → onBaseline → onSegment', async () => {
  const api = mockApi({ baselineHubs: ['NKH#南京南'] });
  const order: string[] = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onDirect: () => order.push('direct'),
    onBaseline: () => order.push('baseline'),
    onSegment: () => order.push('segment'),
    onDone: () => order.push('done'),
  });
  expect(order[0]).toBe('direct');
  expect(order[1]).toBe('baseline');
  expect(order.at(-1)).toBe('done');
  expect(order).toContain('segment');
});

test('runQuery：枢纽分多段，逐段回调', async () => {
  const api = mockApi({ baselineHubs: [] });
  const segments: SegmentResult[] = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onSegment: (s) => segments.push(s),
  });
  // 内置兜底 20 个枢纽，排除 VNP/AOH 后按 6 分段
  expect(segments.length).toBeGreaterThanOrEqual(3);
  expect(segments[0]!.index).toBe(0);
  expect(segments[0]!.hubs).toHaveLength(6);
  expect(segments.at(-1)!.total).toBe(segments.length);
});

test('runQuery：某段真错误 → 该段 error，其余段照常（T13）', async () => {
  const api = mockApi({ baselineHubs: [], failSegments: ['UUH'] });
  const segments: SegmentResult[] = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onSegment: (s) => segments.push(s),
  });
  const bad = segments.find((s) => s.hubs.includes('UUH'))!;
  expect(bad.items.find((x) => x.key === 'UUH')!.error).toMatch(/error\.html/);
  expect(bad.error).toMatch(/UUH.*error\.html/);
  // 其余段正常
  expect(
    segments.some((s) => s.hubs.some((h) => h !== 'UUH' && s.items.find((x) => x.key === h)?.ok)),
  ).toBe(true);
});

test('runQuery：API 返回 ok:false 时基线和各段均保留失败原因', async () => {
  const api = mockApi();
  api.transfer = async () => ({ ok: false, error: '口令错误' });
  const segments: SegmentResult[] = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onBaseline: (b) => {
      expect(b.ok).toBe(false);
      expect(b.error).toBe('口令错误');
    },
    onSegment: (s) => segments.push(s),
  });
  expect(segments.length).toBeGreaterThan(0);
  expect(segments.every((s) => s.error === '口令错误')).toBe(true);
});

test('runQuery：基线单项失败不伪装为成功，后续成功空结果不算失败', async () => {
  const api = mockApi();
  const original = api.transfer;
  api.transfer = async (p) => p.hubs.length === 0 || p.hubs[0] === ''
    ? { ok: true, items: [{ key: '', ok: false, error: 'HTTP 503' }] }
    : original(p);
  const result = await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onBaseline: (b) => {
      expect(b.ok).toBe(false);
      expect(b.error).toContain('HTTP 503');
    },
  });
  expect(result.segments.every((s) => s.error === null)).toBe(true);
});

test('runQuery：整段请求抛错保留 error，并继续后续段', async () => {
  const api = mockApi();
  const original = api.transfer;
  let failed = false;
  api.transfer = async (p) => {
    if (p.hubs.length > 1 && !failed) {
      failed = true;
      throw new Error('网络连接失败');
    }
    return original(p);
  };
  const result = await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api);
  expect(result.segments[0]!.error).toContain('网络连接失败');
  expect(result.segments.slice(1).every((s) => s.error === null)).toBe(true);
});

test('runQuery：基线失败不阻断后续枚举', async () => {
  const api: QueryApi = {
    async leftTicket() {
      return { ok: true, data: { data: { result: [] } } };
    },
    async transfer(p) {
      if (p.hubs.length === 0) throw new Error('baseline down');
      return { ok: true, items: p.hubs.map((h) => ({ key: h, ok: true, data: { data: {} } })) };
    },
  };
  const segments: SegmentResult[] = [];
  await runQuery({ from: 'VNP', to: 'AOH', date: '2026-10-07' }, api, {
    onBaseline: (b) => expect(b.ok).toBe(false),
    onSegment: (s) => segments.push(s),
  });
  expect(segments.length).toBeGreaterThanOrEqual(3); // 兜底枢纽仍然枚举了
});
