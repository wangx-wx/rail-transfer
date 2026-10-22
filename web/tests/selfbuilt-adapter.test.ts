/**
 * 自研取数适配层单测：把 api.ts + parse.ts 包成 SelfBuiltDeps
 *
 * 注入 fetchImpl（不访问网络）。走相对路径 /api/*。
 */

import { test, expect } from 'vitest';

import { createSelfBuiltDeps } from '../lib/selfbuilt-adapter.ts';
import type { SelfBuiltParams } from '../lib/selfbuilt.ts';

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

// ── D77：自研卡片要显示余票，解析层必须真的带上席别 ──────
test('directTrains：返回的车次带余票（D77）', async () => {
  // 第 30 列 = 二等座余票；此前 lite 解析把 seats 恒置为 []
  const r = row({ trainNo: '1', code: 'G1', from: 'O', to: 'H', start: '08:00', arrive: '09:00', dur: '01:00' });
  const cols = r.split('|');
  cols[30] = '12';   // 二等座 12 张
  cols[31] = '有';   // 一等座 有

  const deps = createSelfBuiltDeps(PARAMS, {
    fetchImpl: fakeFetch({ '/api/left-ticket': leftBody([cols.join('|')]) }),
  });
  const [t] = await deps.directTrains('O', 'H');

  expect(t!.seats.length).toBeGreaterThan(0);
  expect(t!.seats.find((s) => s.code === 'ZE')?.raw).toBe('12');
  expect(t!.seats.find((s) => s.code === 'ZY')?.raw).toBe('有');
});

test('适配层只有 directTrains（T56：stopsOf 已移除，只打一个接口）', async () => {
  const paths: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    paths.push(new URL(String(url)).pathname);
    return new Response(leftBody([row({ trainNo: '1', code: 'G1', from: 'O', to: 'H', start: '08:00', arrive: '09:00', dur: '01:00' })]), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const deps = createSelfBuiltDeps(PARAMS, { fetchImpl });
  await deps.directTrains('O', 'H');
  expect(Object.keys(deps)).toEqual(['directTrains']);
  expect(paths).toEqual(['/api/left-ticket']); // 无 stopover 请求
});
