/**
 * 接驳前端胶水测试（T60）
 *
 * 覆盖：站码 → 坐标、坐标缺失不出网、可重试失败不留在缓存里。
 * 编排本身在 connection.test.ts 覆盖，这里只测胶水层的接缝行为。
 */

import { test, expect, vi } from 'vitest';

import { createConnectionApi, isRetriableFailure, latLngParam, loadConnectionByCode, stationCodeOf } from '../lib/connectionAdapter.ts';
import type { ConnectionApi, ConnectionCache } from '../lib/connection.ts';
import type { CoordSource } from '../lib/stationCoords.ts';

const COORDS: CoordSource = {
  async of(code) {
    if (code === 'VNP') return { lat: 39.865022, lng: 116.378999 };
    if (code === 'BXP') return { lat: 39.894712, lng: 116.321193 };
    return undefined;
  },
};

function api(over: Partial<ConnectionApi> = {}): ConnectionApi {
  return {
    async transit() {
      return { status: 0, result: { routes: [{ distance: 8056, duration: 30, price: 400, steps: [] }] } };
    },
    async driving() {
      return { status: 0, result: { routes: [{ distance: 11057, duration: 16 }] } };
    },
    ...over,
  };
}

const REQ = { fromCode: 'VNP', toCode: 'BXP', waitMinutes: 90, departureTime: '14:00' };

test('latLngParam：腾讯要求纬度在前（T57）', () => {
  expect(latLngParam({ lat: 39.8, lng: 116.3 })).toBe('39.8,116.3');
});

test('loadConnectionByCode：站码 → 坐标 → 方案', async () => {
  const r = await loadConnectionByCode(REQ, { coords: COORDS, api: api(), cache: new Map() });
  expect(r.kind).toBe('ok');
  if (r.kind !== 'ok') return;
  expect(r.km).toBeCloseTo(5.9, 1);
  expect(r.transit.kind).toBe('plan');
  expect(r.driving.kind).toBe('plan');
});

test('loadConnectionByCode：缺坐标不发任何请求（D74 禁用分支）', async () => {
  const transit = vi.fn();
  const driving = vi.fn();
  const r = await loadConnectionByCode(
    { ...REQ, toCode: 'ZZZZ' },
    { coords: COORDS, api: { transit, driving } as unknown as ConnectionApi, cache: new Map() },
  );
  expect(r).toEqual({ kind: 'noCoord' });
  expect(transit).not.toHaveBeenCalled();
  expect(driving).not.toHaveBeenCalled();
});

test('loadConnectionByCode：可重试的失败不进缓存，重试能真正重发', async () => {
  let attempt = 0;
  const transit = vi.fn(async () => {
    attempt++;
    // 第一次配额超限，第二次正常
    if (attempt === 1) return { status: 121, result: undefined };
    return { status: 0, result: { routes: [{ distance: 8056, duration: 30, price: 400, steps: [] }] } };
  });
  const cache: ConnectionCache = new Map();
  const deps = { coords: COORDS, api: api({ transit }), cache };

  const first = await loadConnectionByCode(REQ, deps);
  expect(first.kind === 'ok' && first.transit.kind).toBe('error');
  expect(isRetriableFailure(first)).toBe(true);

  const second = await loadConnectionByCode(REQ, deps);
  expect(second.kind === 'ok' && second.transit.kind).toBe('plan');
  expect(transit).toHaveBeenCalledTimes(2);
});

test('loadConnectionByCode：成功的失败类结果（无路线）留在缓存里，不重复打上游', async () => {
  const transit = vi.fn(async () => ({ status: 347, result: undefined }));
  const cache: ConnectionCache = new Map();
  const deps = { coords: COORDS, api: api({ transit }), cache };
  await loadConnectionByCode(REQ, deps);
  await loadConnectionByCode(REQ, deps);
  expect(transit).toHaveBeenCalledTimes(1);
});

test('stationCodeOf：真实站名可反查，未知站名返回 null（T62）', () => {
  expect(stationCodeOf('北京南')).toBe('VNP');
  expect(stationCodeOf('不存在的站')).toBeNull();
});

test('createConnectionApi：走 Worker 端点并带口令', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect((init?.headers as Record<string, string>)['X-Access-Token']).toBe('tok');
    return new Response(JSON.stringify({ ok: false, error: '接驳服务未配置' }), { status: 502 });
  }) as unknown as typeof globalThis.fetch;

  const a = createConnectionApi({ token: 'tok', base: 'https://proxy.example', fetchImpl });
  await expect(a.transit({ lat: 39.8, lng: 116.3 }, { lat: 39.9, lng: 116.4 })).rejects.toThrow(/未配置/);
  expect(calls[0]).toContain('/api/transit');
  expect(calls[0]).toContain('from=39.8%2C116.3');
});

// ── Worker 层失败的口径（D74）────────────────────────────
test('createConnectionApi：Worker 报「未配置」→ 不可重试，界面给原因而非重试按钮', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ ok: false, error: '接驳服务未配置（缺少 TENCENT_KEY）' }), {
      status: 502,
    })) as unknown as typeof globalThis.fetch;
  const a = createConnectionApi({ base: 'https://proxy.example', fetchImpl });
  const r = await loadConnectionByCode(REQ, { coords: COORDS, api: a, cache: new Map() });
  expect(r.kind).toBe('ok');
  if (r.kind !== 'ok') return;
  expect(r.transit).toEqual({ kind: 'error', message: '接驳服务未配置（缺少 TENCENT_KEY）', retriable: false });
});

test('createConnectionApi：网络异常仍是可重试', async () => {
  const fetchImpl = (async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof globalThis.fetch;
  const a = createConnectionApi({ base: 'https://proxy.example', fetchImpl });
  const r = await loadConnectionByCode(REQ, { coords: COORDS, api: a, cache: new Map() });
  expect(r.kind === 'ok' && r.transit.kind === 'error' && r.transit.retriable).toBe(true);
});
