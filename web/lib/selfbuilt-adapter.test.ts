/**
 * 自研取数适配层单测：把 api.ts + parse.ts 包成 SelfBuiltDeps
 *
 * 注入 fetchImpl（不访问网络）。走相对路径 /api/*。
 */

import { test, expect } from 'vitest';

import { createSelfBuiltDeps } from './selfbuilt-adapter.ts';
import type { SelfBuiltParams } from './selfbuilt.ts';

/** 造一行 leftTicket 记录 */
function row({ trainNo, code, from, to, start, arrive, dur }: { trainNo: string; code: string; from: string; to: string; start: string; arrive: string; dur: string }): string {
  const c = new Array<string>(58).fill('');
  c[2] = trainNo; c[3] = code; c[6] = from; c[7] = to;
  c[8] = start; c[9] = arrive; c[10] = dur;
  return c.join('|');
}

/** 造一次 /api/left-ticket 响应（Worker 包一层 {ok,data} 外壳） */
function leftBody(rows: string[]): string {
  return JSON.stringify({ ok: true, data: { data: { result: rows, map: {} } } });
}

/** 造一次 /api/stopover 响应（Worker 包一层 {ok,data} 外壳） */
function stopBody(rows: Array<{ station_name: string; station_no: string }>): string {
  return JSON.stringify({ ok: true, data: { data: { data: rows } } });
}

function fakeFetch(routes: Record<string, string>): typeof globalThis.fetch {
  return (async (url: string | URL) => {
    const u = new URL(String(url));
    const key = u.pathname + u.search;
    for (const [pat, body] of Object.entries(routes)) {
      if (key.includes(pat)) return new Response(body, { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

const PARAMS: SelfBuiltParams = { from: 'O', to: 'D', date: '2026-10-08', hubs: ['H'], maxTransfers: 1 };

test('directTrains：解析 left-ticket 响应为车次列表', async () => {
  const deps = createSelfBuiltDeps(PARAMS, {
    fetchImpl: fakeFetch({
      '/api/left-ticket': leftBody([row({ trainNo: '1', code: 'G1', from: 'O', to: 'H', start: '08:00', arrive: '09:00', dur: '01:00' })]),
    }),
  });
  const trains = await deps.directTrains('O', 'H');
  expect(trains).toHaveLength(1);
  expect(trains[0]!.trainCode).toBe('G1');
});

test('directTrains：非 OK 响应 → 空数组（不抛错）', async () => {
  const deps = createSelfBuiltDeps(PARAMS, {
    fetchImpl: fakeFetch({ '/api/left-ticket': JSON.stringify({ ok: false, error: 'x' }) }),
  });
  expect(await deps.directTrains('O', 'H')).toEqual([]);
});

test('stopsOf：解析经停站名为序列', async () => {
  const deps = createSelfBuiltDeps(PARAMS, {
    fetchImpl: fakeFetch({
      '/api/stopover': stopBody([
        { station_name: 'O', station_no: '01' },
        { station_name: 'X', station_no: '02' },
        { station_name: 'H', station_no: '03' },
      ]),
    }),
  });
  const train = { trainNo: '1', fromStation: 'O', toStation: 'H', fromStationNo: '01', toStationNo: '03' } as never;
  expect(await deps.stopsOf(train)).toEqual(['O', 'X', 'H']);
});

test('stopsOf：经停查询失败 → 回退为起讫两站', async () => {
  const deps = createSelfBuiltDeps(PARAMS, {
    fetchImpl: fakeFetch({ '/api/stopover': JSON.stringify({ ok: false, error: 'x' }) }),
  });
  const train = { trainNo: '1', fromStation: 'O', toStation: 'H', fromStationNo: '01', toStationNo: '03' } as never;
  expect(await deps.stopsOf(train)).toEqual(['O', 'H']);
});
