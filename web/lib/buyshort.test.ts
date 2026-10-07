/**
 * 买短乘长编排单测（D22 / D45~D53）
 *
 * 纯函数 + 注入式 API mock，不访问真实 12306。
 * 站名→站码反查走真实数据（city.codeOfStation），故用例用真实站名。
 */

import { test, expect, vi } from 'vitest';

import { baseSeat, isSoldOut, findShortTicket } from './buyshort.ts';
import type { BuyShortApi } from './buyshort.ts';
import type {
  FetchResult,
  LeftTicketData,
  PriceData,
  RawStopoverStation,
  Train,
  UpstreamEnvelope,
} from '../../shared/types.ts';

/** 造一列 G568 车次（高铁，二等座 raw 可控） */
function train(over: Partial<Train> = {}): Train {
  return {
    trainNo: '630000G56800',
    trainCode: 'G568',
    fromStation: 'GZQ',
    toStation: 'WHN',
    startStation: 'GZQ',
    endStation: 'ZAF',
    startTime: '06:05',
    arriveTime: '11:01',
    duration: '04:56',
    trainDate: '20261008',
    fromStationNo: '01',
    toStationNo: '09',
    secretStr: '',
    seatTypes: '9MOO',
    seats: [
      { code: 'WZ', name: '无座', available: false, count: null, raw: '无' },
      { code: 'YZ', name: '硬座', available: false, count: null, raw: '' },
      { code: 'SWZ', name: '商务座', available: true, count: 5, raw: '5' },
      { code: 'ZY', name: '一等座', available: true, count: null, raw: '有' },
      { code: 'ZE', name: '二等座', available: false, count: null, raw: '无' },
    ],
    ...over,
  };
}

/** 造一行 leftTicket 记录（58 列） */
function row({ trainNo = '630000G56800', from = 'GZQ', ze = '', yz = '', seatTypes = '9MOO' } = {}): string {
  const c = new Array<string>(58).fill('');
  c[2] = trainNo;
  c[3] = 'G568';
  c[6] = from; // 上车站码
  c[7] = 'XXX';
  c[16] = '01';
  c[17] = '05';
  c[29] = yz; // 硬座
  c[30] = ze; // 二等座
  c[35] = seatTypes;
  return c.join('|');
}

/** 造经停站数组 */
function stops(list: Array<[string, string]>): RawStopoverStation[] {
  return list.map(([no, name]) => ({ station_no: no, station_name: name }));
}

/**
 * 可编程的 API mock。
 * `tickets`: 站码 → 该区间二等座余票值（如 { ICQ: '有' }）。
 */
function mockApi(opts: {
  stops?: RawStopoverStation[];
  stopError?: string;
  stopsThrow?: boolean;
  tickets?: Record<string, string | null>; // null = 该区间整体查询失败
  priceYuan?: number | null;
}): BuyShortApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async stopover() {
      calls.push('stopover');
      if (opts.stopsThrow) throw new Error('网络炸了');
      if (opts.stopError) return { ok: false, error: opts.stopError };
      return { ok: true, data: { data: { data: opts.stops ?? [] } } as UpstreamEnvelope<{ data?: RawStopoverStation[] }> };
    },
    async leftTicket(p) {
      calls.push(`leftTicket:${p.to}`);
      if (p.to in (opts.tickets ?? {})) {
        const v = opts.tickets![p.to];
        if (v === null) return { ok: false, error: 'HTTP 500' };
        return { ok: true, data: { data: { result: [row({ ze: v })], map: {} } } as UpstreamEnvelope<LeftTicketData> };
      }
      // 未预设 → 该车次不在结果里（空）
      return { ok: true, data: { data: { result: [], map: {} } } as UpstreamEnvelope<LeftTicketData> };
    },
    async price() {
      calls.push('price');
      if (opts.priceYuan == null) return { ok: false, error: 'no price' };
      return { ok: true, data: { data: { O: `¥${opts.priceYuan}.0` } } as UpstreamEnvelope<PriceData> };
    },
  } as BuyShortApi & { calls: string[] };
}

const DATE = '2026-10-08';

// ── baseSeat / isSoldOut ─────────────────────────────────
test('baseSeat：高铁取二等座', () => {
  expect(baseSeat(train())?.code).toBe('ZE');
});

test('baseSeat：普速取硬座（二等座不适用）', () => {
  const t = train({ seatTypes: '1341' , seats: [
    { code: 'ZE', name: '二等座', available: false, count: null, raw: '' },
    { code: 'YZ', name: '硬座', available: false, count: null, raw: '无' },
  ] });
  expect(baseSeat(t)?.code).toBe('YZ');
});

test('baseSeat：无基准席别 → null', () => {
  // 普速码串（不含 O），且结果里没有硬座行
  const t = train({ seatTypes: '134' , seats: [
    { code: 'ZE', name: '二等座', available: false, count: null, raw: '' },
  ] });
  expect(baseSeat(t)).toBeNull();
});

test('isSoldOut：二等座「无」→ true；「有」→ false', () => {
  expect(isSoldOut(train())).toBe(true);
  const t = train({ seats: [
    { code: 'ZE', name: '二等座', available: true, count: null, raw: '有' },
  ] });
  expect(isSoldOut(t)).toBe(false);
});

// ── findShortTicket ──────────────────────────────────────
test('从离 B 最近的站往回查，命中即止并返回价格', async () => {
  const api = mockApi({
    // 01 广州(起点) 02 郴州西 03 衡阳东 05 … 09 武汉(终点) 10 孝感北
    stops: stops([['01', '广州'], ['02', '郴州西'], ['03', '衡阳东'], ['04', '株洲西'], ['09', '武汉'], ['10', '孝感北']]),
    // 离武汉最近的 04 株洲西、03 衡阳东 无票，02 郴州西 有票
    tickets: { ZAQ: '无', HVQ: '无', ICQ: '有' },
    priceYuan: 156,
  });
  const onProgress = vi.fn();
  const r = await findShortTicket(train(), DATE, api, { onProgress });

  expect(r).toEqual({ kind: 'found', stationName: '郴州西', seatName: '二等座', price: 156 });
  // 查询顺序：株洲西 → 衡阳东 → 郴州西（由近到远）
  expect(api.calls.filter((c) => c.startsWith('leftTicket'))).toEqual([
    'leftTicket:ZAQ',
    'leftTicket:HVQ',
    'leftTicket:ICQ',
  ]);
  // 两站无票后才命中，故进度回调整两次
  expect(onProgress).toHaveBeenCalledTimes(2);
  expect(onProgress).toHaveBeenLastCalledWith(2);
});

test('离 B 最近的第一站就有票 → 只查一次', async () => {
  const api = mockApi({
    stops: stops([['01', '广州'], ['02', '郴州西'], ['09', '武汉']]),
    tickets: { ICQ: '有' },
    priceYuan: 156,
  });
  const r = await findShortTicket(train(), DATE, api);
  expect(r).toEqual({ kind: 'found', stationName: '郴州西', seatName: '二等座', price: 156 });
  expect(api.calls.filter((c) => c.startsWith('leftTicket'))).toEqual(['leftTicket:ICQ']);
});

test('沿途各站均无票 → none', async () => {
  const api = mockApi({
    stops: stops([['01', '广州'], ['02', '郴州西'], ['03', '衡阳东'], ['09', '武汉']]),
    tickets: { HVQ: '无', ICQ: '无' },
  });
  const r = await findShortTicket(train(), DATE, api);
  expect(r).toEqual({ kind: 'none' });
});

test('A、B 之间无中途站 → noCandidate（不查票）', async () => {
  const api = mockApi({ stops: stops([['01', '广州'], ['09', '武汉'], ['10', '孝感北']]) });
  const r = await findShortTicket(train(), DATE, api);
  expect(r).toEqual({ kind: 'noCandidate' });
  expect(api.calls).toEqual(['stopover']);
});

test('已过 B 的站不查（不买长乘短）', async () => {
  const api = mockApi({
    stops: stops([['01', '广州'], ['09', '武汉'], ['10', '孝感北'], ['11', '信阳东']]),
    tickets: { XRN: '有' },
    priceYuan: 100,
  });
  const r = await findShortTicket(train(), DATE, api);
  expect(r).toEqual({ kind: 'noCandidate' });
  expect(api.calls).toEqual(['stopover']);
});

test('经停接口失败 → error', async () => {
  const api = mockApi({ stopError: '被拦截：302 → error.html' });
  const r = await findShortTicket(train(), DATE, api);
  expect(r).toEqual({ kind: 'error', error: '被拦截：302 → error.html' });
});

test('经停接口抛异常 → error（不冒泡）', async () => {
  const api = mockApi({ stopsThrow: true });
  const r = await findShortTicket(train(), DATE, api);
  expect(r.kind).toBe('error');
});

test('单个区间查询失败 → 跳过继续，不中断', async () => {
  const api = mockApi({
    stops: stops([['01', '广州'], ['02', '郴州西'], ['03', '衡阳东'], ['09', '武汉']]),
    tickets: { HVQ: '无', ICQ: null }, // 郴州西查询失败
  });
  const r = await findShortTicket(train(), DATE, api);
  expect(r).toEqual({ kind: 'none' });
});

test('命中但查价失败 → found 且 price 为 null', async () => {
  const api = mockApi({
    stops: stops([['01', '广州'], ['02', '郴州西'], ['09', '武汉']]),
    tickets: { ICQ: '有' },
    priceYuan: null,
  });
  const r = await findShortTicket(train(), DATE, api);
  expect(r).toEqual({ kind: 'found', stationName: '郴州西', seatName: '二等座', price: null });
});

test('普速车按硬座判定并查价', async () => {
  const t = train({
    trainNo: '670000K7670A',
    trainCode: 'K767',
    seatTypes: '1341',
    seats: [
      { code: 'ZE', name: '二等座', available: false, count: null, raw: '' },
      { code: 'YZ', name: '硬座', available: false, count: null, raw: '无' },
    ],
  });
  const calls: string[] = [];
  const api: BuyShortApi = {
    async stopover() {
      return { ok: true, data: { data: { data: stops([['01', '广州'], ['02', '郴州西'], ['09', '武汉']]) } } } as never;
    },
    async leftTicket() {
      // 硬座有票（YZ 列，index 29）
      return { ok: true, data: { data: { result: [row({ trainNo: '670000K7670A', yz: '有' })], map: {} } } } as never;
    },
    async price(p) {
      calls.push(JSON.stringify(p));
      // 普速硬座价格码为 '1'
      return { ok: true, data: { data: { '1': '¥224.0' } } } as never;
    },
  };
  const r = await findShortTicket(t, DATE, api);
  expect(r).toEqual({ kind: 'found', stationName: '郴州西', seatName: '硬座', price: 224 });
});

test('查价传两位补零的站序（07 而非 7）', async () => {
  const calls: string[] = [];
  const api: BuyShortApi = {
    async stopover() {
      return { ok: true, data: { data: { data: stops([['01', '广州'], ['07', '赤壁北'], ['09', '武汉']]) } } } as never;
    },
    async leftTicket() {
      return { ok: true, data: { data: { result: [row({ ze: '有' })], map: {} } } } as never;
    },
    async price(p) {
      calls.push(p.toStationNo);
      return { ok: true, data: { data: { O: '¥371.0' } } } as never;
    },
  };
  const r = await findShortTicket(train(), DATE, api);
  expect(r.kind).toBe('found');
  expect(calls).toEqual(['07']); // 不是 '7'
});

test('缺少站序 → error', async () => {
  const api = mockApi({});
  const r = await findShortTicket(train({ fromStationNo: '' }), DATE, api);
  expect(r.kind).toBe('error');
});
