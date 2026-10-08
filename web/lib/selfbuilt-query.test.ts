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
    async stopsOf(train) {
      return [train.fromStation, train.toStation];
    },
  };
}

test('编排：枢纽池经可达图预筛后仅查保留的枢纽', async () => {
  const calls: string[] = [];
  const r = await runSelfBuiltQuery(
    {
      from: 'O', to: 'D', date: '2026-10-08', maxTransfers: 1,
      hubs: ['H', 'K'],
      graph: { O: ['H'], H: ['D'], K: ['X'] }, // K 到不了 D
    },
    deps({ 'O>H': [t('G1', 'O', 'H', '08:00', '09:00', '01:00')], 'H>D': [t('G2', 'H', 'D', '09:30', '11:00', '01:30')] }, calls),
  );
  expect(r.journeys).toHaveLength(1);
  expect(calls).not.toContain('O>K');
});

test('编排：无可用枢纽 → 空结果，不发请求', async () => {
  const calls: string[] = [];
  const r = await runSelfBuiltQuery(
    { from: 'O', to: 'D', date: '2026-10-08', maxTransfers: 1, hubs: ['K'], graph: { O: ['H'], H: ['D'] } },
    deps({}, calls),
  );
  expect(r.journeys).toHaveLength(0);
  expect(calls).toHaveLength(0);
});

test('编排：经停查询只对最终候选行程做（T43）', async () => {
  const calls: string[] = [];
  let stopQueries = 0;
  const d: SelfBuiltQueryDeps = {
    async directTrains(from, to) {
      calls.push(`${from}>${to}`);
      const routes: Record<string, Train[]> = {
        'O>H': [t('G1', 'O', 'H', '08:00', '09:00', '01:00')],
        'H>D': [t('G2', 'H', 'D', '09:30', '11:00', '01:30')],
      };
      return routes[`${from}>${to}`] ?? [];
    },
    async stopsOf(train) { stopQueries++; return [train.fromStation, train.toStation]; },
  };
  await runSelfBuiltQuery({ from: 'O', to: 'D', date: '2026-10-08', maxTransfers: 1, hubs: ['H'], graph: { O: ['H'], H: ['D'] } }, d);
  expect(stopQueries).toBe(2); // 仅一条候选行程的两程
});
