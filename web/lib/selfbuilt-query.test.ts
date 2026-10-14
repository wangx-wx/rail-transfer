/**
 * 自研查询编排单测：枢纽池 → 可达预筛 → 限流 → 算法（T39~T42）
 *
 * 注入取数与可注入时钟，不访问网络。
 */

import { test, expect } from 'vitest';

import { runSelfBuiltQuery } from './selfbuilt-query.ts';
import type { SelfBuiltQueryDeps } from './selfbuilt-query.ts';
import type { Train } from '../../shared/types.ts';

function t(code: string, from: string, to: string, start: string, arrive: string, dur: string): Train {
  return {
    trainNo: code, trainCode: code, fromStation: from, toStation: to,
    startStation: from, endStation: to, startTime: start, arriveTime: arrive,
    duration: dur, trainDate: '20261008', fromStationNo: '01', toStationNo: '02',
    secretStr: '', seats: [], seatTypes: '',
  };
}

function deps(routes: Record<string, Train[]>, calls: string[]): SelfBuiltQueryDeps {
  return {
    async directTrains(from, to) {
      calls.push(`${from}>${to}`);
      return routes[`${from}>${to}`] ?? [];
    },
  };
}

test('编排：可达性只影响**排序**，不删除枢纽（稀疏图不能当硬筛）', async () => {
  const calls: string[] = [];
  const r = await runSelfBuiltQuery(
    {
      from: 'O', to: 'D', date: '2026-10-08', maxTransfers: 1,
      hubs: ['K', 'H'], // K 不可证可达，H 可证
      graph: { O: ['H'], H: ['D'], K: ['X'] },
    },
    deps({ 'O>H': [t('G1', 'O', 'H', '08:00', '09:00', '01:00')], 'H>D': [t('G2', 'H', 'D', '09:30', '11:00', '01:30')] }, calls),
  );
  // 可证可达的 H 排前；K 仍保留（图稀疏，不能排除）
  expect(r.hubs[0]).toBe('H');
  expect(r.hubs).toContain('K');
  expect(r.journeys).toHaveLength(1);
});

test('编排：枢纽全被方向过滤剔除 → 空结果，不发请求', async () => {
  const calls: string[] = [];
  const r = await runSelfBuiltQuery(
    {
      from: 'O', to: 'D', date: '2026-10-08', maxTransfers: 1, hubs: ['K'],
      coords: { O: [0, 0], D: [10, 10], K: [-10, -10] }, // K 在反方向
    },
    deps({}, calls),
  );
  expect(r.journeys).toHaveLength(0);
  expect(calls).toHaveLength(0);
});

test('编排：只发枚举请求，无经停补查（T56）', async () => {
  const calls: string[] = [];
  const d: SelfBuiltQueryDeps = {
    async directTrains(from, to) {
      calls.push(`${from}>${to}`);
      const routes: Record<string, Train[]> = {
        'O>H': [t('G1', 'O', 'H', '08:00', '09:00', '01:00')],
        'H>D': [t('G2', 'H', 'D', '09:30', '11:00', '01:30')],
      };
      return routes[`${from}>${to}`] ?? [];
    },
  };
  await runSelfBuiltQuery({ from: 'O', to: 'D', date: '2026-10-08', maxTransfers: 1, hubs: ['H'], graph: { O: ['H'], H: ['D'] } }, d);
  expect(calls).toEqual(['O>H', 'H>D']); // 仅两条枚举边
});

// ── 城市名/站码转换 + 方向过滤（T39/T40）───────────────────
test('编排：可达图节点是城市名，可证可达的枢纽排在前面', async () => {
  const calls: string[] = [];
  const r = await runSelfBuiltQuery(
    {
      from: 'GZQ', to: 'SNN', date: '2026-10-08', maxTransfers: 1,
      hubs: ['IOQ', 'WHN'],
      graph: { 广州: ['武汉'], 武汉: ['十堰'], 深圳: ['X'] },
      cityOf: (c) => ({ GZQ: '广州', SNN: '十堰', WHN: '武汉', IOQ: '深圳' }[c] ?? c),
    },
    deps({ 'GZQ>WHN': [t('G1', 'GZQ', 'WHN', '08:00', '11:00', '03:00')], 'WHN>SNN': [t('G2', 'WHN', 'SNN', '11:30', '14:00', '02:30')] }, calls),
  );
  expect(r.hubs[0]).toBe('WHN');
  expect(r.hubs).toContain('IOQ');
});

test('编排：方向过滤剔除反方向枢纽（广州→十堰 剔除深圳）', async () => {
  const calls: string[] = [];
  const r = await runSelfBuiltQuery(
    {
      from: 'GZQ', to: 'SNN', date: '2026-10-08', maxTransfers: 1,
      hubs: ['WHN', 'IOQ'],
      coords: { 广州: [113.26, 23.15], 十堰: [110.78, 32.6], 武汉: [114.42, 30.61], 深圳: [114.03, 22.61] },
      cityOf: (c) => ({ GZQ: '广州', SNN: '十堰', WHN: '武汉', IOQ: '深圳' }[c] ?? c),
    },
    deps({ 'GZQ>WHN': [t('G1', 'GZQ', 'WHN', '08:00', '11:00', '03:00')], 'WHN>SNN': [t('G2', 'WHN', 'SNN', '11:30', '14:00', '02:30')] }, calls),
  );
  expect(r.hubs).toEqual(['WHN']);
  expect(calls).not.toContain('GZQ>IOQ');
});

// ── 几何硬砍 + 请求量预估（T40/T50）────────────────────────
import { estimateSelfBuiltRequests, selectHubCodes } from './selfbuilt-query.ts';

const COORDS = { O: [0, 0], D: [10, 0], NEAR: [5, 0], FAR: [5, 8] } satisfies Record<string, [number, number]>;

test('selectHubCodes：几何硬砍剔除绕行枢纽（缺坐标不砍）', () => {
  const p = {
    from: 'O', to: 'D', date: 'x', maxTransfers: 1 as const,
    hubs: ['NEAR', 'FAR'],
    coords: COORDS,
    maxHubRatio: 1.2,
  };
  // NEAR 在直线上（ratio≈1），FAR 明显绕（ratio>1.2）
  expect(selectHubCodes(p)).toEqual(['NEAR']);
});

test('estimateSelfBuiltRequests：一次换乘 = 2N（T56 起不含经停补查）', () => {
  const p = { from: 'O', to: 'D', date: 'x', maxTransfers: 1 as const, hubs: ['NEAR'], coords: COORDS };
  const est = estimateSelfBuiltRequests(p, { intervalMs: 300 });
  // 1 枢纽：枚举 2×1=2；2×300ms = 0.6s → 1
  expect(est.hubs).toBe(1);
  expect(est.requests).toBe(2);
  expect(est.seconds).toBe(1);
});

test('estimateSelfBuiltRequests：二次换乘 = N²+2N（T56 起不含经停补查）', () => {
  const coords = { O: [0, 0], D: [10, 0], NEAR: [5, 0], NEAR2: [5, 1] } satisfies Record<string, [number, number]>;
  const p = { from: 'O', to: 'D', date: 'x', maxTransfers: 2 as const, hubs: ['NEAR', 'NEAR2'], coords };
  const est = estimateSelfBuiltRequests(p, { intervalMs: 300 });
  // 2²+2×2 = 8
  expect(est.requests).toBe(8);
});

test('selectHubCodes：minHubs 保底——短途 OD 不因几何硬砍归零', () => {
  // 造一个所有枢纽都偏离直线的短途 OD
  const coords = { O: [0, 0], D: [1, 0], H1: [0.5, 1], H2: [0.5, -1], H3: [0.5, 2] } satisfies Record<string, [number, number]>;
  const p = { from: 'O', to: 'D', date: 'x', maxTransfers: 1 as const, hubs: ['H1', 'H2', 'H3'], coords, maxHubRatio: 1.2 };
  expect(selectHubCodes(p)).toHaveLength(0); // 无保底 → 砍光
  expect(selectHubCodes({ ...p, minHubs: 2 })).toHaveLength(2); // 有保底 → 补回 2 个
});

// ── 候选枢纽（D68 交互式选择）────────────────────────────
import { selectHubCandidates } from './selfbuilt-query.ts';
import { CITY_STATIONS } from '../data/stations.ts';
import { CITY_COORDS } from '../data/coords.ts';
import { buildHubPool } from './hubs.ts';
import { cityOfStation } from './city.ts';
import { REACHABILITY_EDGES } from '../data/reachability.ts';
import { parseReachability } from './reach.ts';
import { MAX_HUB_DETOUR_RATIO, MAX_HUBS, MIN_HUBS } from '../../shared/constants.ts';

test('selectHubCandidates：北京→上海候选 = 12 个，比值升序且 ≤ 1.6（固化实测）', () => {
  const p = {
    from: CITY_STATIONS['北京'].code, to: CITY_STATIONS['上海'].code, date: 'x',
    maxTransfers: 1 as const, hubs: buildHubPool('北京', '上海'),
    graph: parseReachability(REACHABILITY_EDGES), coords: CITY_COORDS, cityOf: cityOfStation,
    maxHubRatio: MAX_HUB_DETOUR_RATIO, maxHubs: MAX_HUBS, minHubs: MIN_HUBS,
  };
  const cs = selectHubCandidates(p);
  expect(cs).toHaveLength(12);
  expect(cs.every((c) => c.ratio != null && c.ratio <= MAX_HUB_DETOUR_RATIO)).toBe(true);
  // 比值升序
  for (let i = 1; i < cs.length; i++) expect(cs[i]!.ratio!).toBeGreaterThanOrEqual(cs[i - 1]!.ratio!);
  // 第一个是天津
  expect(cs[0]!.city).toBe('天津');
});

test('selectHubCandidates：hubsLocked 原序返回、不被 maxHubRatio/方向过滤剔除（D68 关键回归）', () => {
  // 故意选「绕行比值 > 1.6 会被硬砍」的枢纽；不传 minHubs 以免保底又把它们补回
  const p = {
    from: CITY_STATIONS['北京'].code, to: CITY_STATIONS['上海'].code, date: 'x',
    maxTransfers: 1 as const,
    hubs: [CITY_STATIONS['昆明'].code, CITY_STATIONS['哈尔滨'].code], // 昆明极绕(3.99)、哈尔滨反方向
    coords: CITY_COORDS, cityOf: cityOfStation,
    maxHubRatio: MAX_HUB_DETOUR_RATIO, maxHubs: MAX_HUBS,
  };
  // 未锁定：全被剔除（昆明超 1.6、哈尔滨反方向）
  expect(selectHubCandidates(p)).toHaveLength(0);
  // 锁定：原序原样返回，两个都在、顺序不变
  const locked = selectHubCandidates({ ...p, hubsLocked: true });
  expect(locked.map((c) => c.city)).toEqual(['昆明', '哈尔滨']);
  expect(locked[0]!.ratio).toBeGreaterThan(1.6); // 昆明比值确实超线，但仍被保留
});

test('selectHubCodes：是 selectHubCandidates 的取码版', () => {
  const p = {
    from: CITY_STATIONS['北京'].code, to: CITY_STATIONS['上海'].code, date: 'x',
    maxTransfers: 1 as const, hubs: buildHubPool('北京', '上海'),
    graph: parseReachability(REACHABILITY_EDGES), coords: CITY_COORDS, cityOf: cityOfStation,
    maxHubRatio: MAX_HUB_DETOUR_RATIO, maxHubs: MAX_HUBS, minHubs: MIN_HUBS,
  };
  expect(selectHubCodes(p)).toEqual(selectHubCandidates(p).map((c) => c.code));
});
