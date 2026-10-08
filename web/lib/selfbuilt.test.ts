/**
 * 自研中转编排单测：算法 + 绕行过滤 + 上限（T37/T43/T45/D60/D61）
 *
 * 注入取数接口，不访问网络。
 */

import { test, expect } from 'vitest';

import { runSelfBuiltTransfer } from './selfbuilt.ts';
import type { SelfBuiltDeps } from './selfbuilt.ts';
import type { Train } from '../../shared/types.ts';

function t(code: string, from: string, to: string, start: string, arrive: string, dur: string, trainNo = code): Train {
  return {
    trainNo, trainCode: code, fromStation: from, toStation: to,
    startStation: from, endStation: to, startTime: start, arriveTime: arrive,
    duration: dur, trainDate: '20261008', fromStationNo: '01', toStationNo: '02',
    secretStr: '', seats: [], seatTypes: '',
  };
}

/** 经停：站名按顺序（用站码充当站名，简化） */
function deps(routes: Record<string, Train[]>, stops: Record<string, string[]>): SelfBuiltDeps {
  return {
    async directTrains(from, to) {
      return routes[`${from}>${to}`] ?? [];
    },
    async stopsOf(train) {
      return stops[train.trainNo] ?? [train.fromStation, train.toStation];
    },
  };
}

const DATE = '2026-10-08';

test('正常接续 → 产出行程', async () => {
  const d = deps(
    {
      'O>H': [t('G1', 'O', 'H', '08:00', '09:00', '01:00')],
      'H>D': [t('G2', 'H', 'D', '09:30', '11:00', '01:30')],
    },
    {},
  );
  const r = await runSelfBuiltTransfer({ from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1 }, d);
  expect(r.journeys).toHaveLength(1);
  expect(r.removed).toBe(0);
  expect(r.edges).toBeGreaterThan(0);
});

test('回头路线（第二程重走第一程经停站）→ 删除并计数', async () => {
  // 第一程 O→H 经停 X；第二程 H→D 又经过 X
  const d = deps(
    {
      'O>H': [t('G1', 'O', 'H', '08:00', '09:00', '01:00')],
      'H>D': [t('G2', 'H', 'D', '09:30', '11:00', '01:30')],
    },
    {
      G1: ['O', 'X', 'H'],
      G2: ['H', 'X', 'D'],
    },
  );
  const r = await runSelfBuiltTransfer({ from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1 }, d);
  expect(r.journeys).toHaveLength(0);
  expect(r.removed).toBe(1);
});

test('疑似绕远（耗时超最优 2 倍）→ 保留并打标记', async () => {
  const fast = [t('G1', 'O', 'H', '08:00', '09:00', '01:00')];
  const slowFirst = [t('S1', 'O', 'K', '08:00', '13:00', '05:00')];
  const d = deps(
    {
      'O>H': fast,
      'H>D': [t('G2', 'H', 'D', '09:30', '10:00', '00:30')],
      'O>K': slowFirst,
      'K>D': [t('S2', 'K', 'D', '14:00', '14:30', '00:30')],
    },
    {},
  );
  const r = await runSelfBuiltTransfer({ from: 'O', to: 'D', date: DATE, hubs: ['H', 'K'], maxTransfers: 1 }, d);
  const slow = r.journeys.find((j) => j.legs[0]!.trainCode === 'S1')!;
  expect(slow).toBeDefined();
  expect(slow.detour).toBe(true);
  expect(r.journeys.find((j) => j.legs[0]!.trainCode === 'G1')!.detour).toBe(false);
});

test('上限截断：输出不超过 M 条（T45）', async () => {
  const routes: Record<string, Train[]> = {};
  for (let i = 0; i < 8; i++) {
    routes[`O>H${i}`] = [t(`G${i}`, 'O', `H${i}`, '08:00', '09:00', '01:00')];
    routes[`H${i}>D`] = [t(`G${i}b`, `H${i}`, 'D', '09:30', '11:00', '01:30')];
  }
  const hubs = Array.from({ length: 8 }, (_, i) => `H${i}`);
  const r = await runSelfBuiltTransfer({ from: 'O', to: 'D', date: DATE, hubs, maxTransfers: 1, maxResults: 5 }, deps(routes, {}));
  expect(r.journeys.length).toBeLessThanOrEqual(5);
});
