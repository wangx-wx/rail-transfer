/**
 * 自研行程的展示层：去重 / 标记 / 加权排序 / 上限截断（D63 / T45）
 *
 * 纯函数。输入为 journey.planJourneys 产出的 Journey。
 */

import { test, expect } from 'vitest';

import { journeyFlags, dedupeJourneys, weightedScore, sortJourneys, capJourneys } from '../lib/journeys.ts';
import type { Journey } from '../lib/journey.ts';
import type { Train } from '../../shared/types.ts';

function t(code: string, from: string, to: string, start: string, arrive: string, dur: string): Train {
  return {
    trainNo: code, trainCode: code, fromStation: from, toStation: to,
    startStation: from, endStation: to, startTime: start, arriveTime: arrive,
    duration: dur, trainDate: '20261008', fromStationNo: '01', toStationNo: '02',
    secretStr: '', seats: [], seatTypes: '',
  };
}

const j2 = (a = 'G1', b = 'G2', wait = 30): Journey => ({
  legs: [t(a, 'O', 'H', '08:00', '09:00', '01:00'), t(b, 'H', 'D', '09:30', '11:00', '01:30')],
  transfers: [{ station: 'H', toStation: 'H', waitMinutes: wait, sameStation: true }],
});

test('总耗时 = 各程时长 + 换乘等待之和', () => {
  // 60 + 30(等待) + 90 = 180
  expect(journeyFlags(j2()).totalMinutes).toBe(180);
});

test('换乘下限 15 分内 → risky 标记', () => {
  expect(journeyFlags(j2('G1', 'G2', 16)).risky).toBe(true);
});

test('低于 15 分 → belowMin', () => {
  expect(journeyFlags(j2('G1', 'G2', 10)).belowMin).toBe(true);
});

test('超长等待 > 120 分 → longWait', () => {
  expect(journeyFlags(j2('G1', 'G2', 130)).longWait).toBe(true);
});

test('去重：相同车次序列只保留一条', () => {
  expect(dedupeJourneys([j2(), j2()])).toHaveLength(1);
});

test('去重：车次序列不同则保留', () => {
  expect(dedupeJourneys([j2('G1', 'G2'), j2('G1', 'G3')])).toHaveLength(2);
});

test('加权排序：换乘次数少者优先（相同总耗时）', () => {
  const two = j2();
  const three: Journey = {
    legs: [
      t('G1', 'O', 'H', '08:00', '09:00', '01:00'),
      t('G3', 'H', 'K', '09:10', '09:40', '00:30'),
      t('G4', 'K', 'D', '10:00', '10:30', '00:30'),
    ],
    transfers: [
      { station: 'H', toStation: 'H', waitMinutes: 10, sameStation: true },
      { station: 'K', toStation: 'K', waitMinutes: 20, sameStation: true },
    ],
  };
  // two 总耗时 180；three 总耗时 60+10+30+20+30=150 → 更短但换乘更多
  const sorted = sortJourneys([three, two]);
  expect(sorted[0]!.legs[0]!.trainCode).toBe('G1');
  // 加权分：three 罚 2 次换乘，应落在 two（1 次）之后
  const scores = [weightedScore(three), weightedScore(two)];
  expect(scores[0]).toBeGreaterThan(scores[1]!);
});

test('上限截断：超过 M 条按加权排序保留前 M 条（T45）', () => {
  const many: Journey[] = Array.from({ length: 25 }, (_, i) => j2(`G${i}`, `H${i}`, 20 + i));
  expect(capJourneys(many, 10)).toHaveLength(10);
});

// ── 绕行惩罚 + 排序模式（D63 兑现）────────────────────────
import { DETOUR_PENALTY_MINUTES } from '../../shared/constants.ts';

test('加权分：疑似绕远（detour）多罚 DETOUR_PENALTY_MINUTES', () => {
  const j = j2();
  expect(weightedScore(j, true) - weightedScore(j, false)).toBe(DETOUR_PENALTY_MINUTES);
});

test('加权排序：把疑似绕远压到同耗时但不绕的方案之后', () => {
  const fast = j2('F1', 'F2');
  const slow = { ...j2('S1', 'S2'), detour: true } as Journey & { detour: boolean };
  const scored = sortJourneys([slow, fast], { detourOf: (x) => (x as { detour?: boolean }).detour === true });
  expect(scored[0]!.legs[0]!.trainNo).toBe('F1');
});

test('按总耗时排序：忽略换乘惩罚，纯按 totalMinutes', () => {
  const two = j2(); // 180 分钟
  const three: Journey = {
    legs: [
      t('G1', 'O', 'H', '08:00', '09:00', '01:00'),
      t('G3', 'H', 'K', '09:10', '09:40', '00:30'),
      t('G4', 'K', 'D', '10:00', '10:30', '00:30'),
    ],
    transfers: [
      { station: 'H', toStation: 'H', waitMinutes: 10, sameStation: true },
      { station: 'K', toStation: 'K', waitMinutes: 20, sameStation: true },
    ],
  }; // 150 分钟，更短但换乘多
  const byTime = sortJourneys([two, three], { mode: 'time' });
  expect(byTime[0]).toBe(three);
  const byWeight = sortJourneys([two, three], { mode: 'weighted' });
  expect(byWeight[0]).toBe(two);
});

// ── 分组截断（T45 修订 2026-10-14）────────────────────────
test('capJourneys：按换乘次数分组各自取前 M 条（二次换乘不被一次挤掉）', () => {
  // 造 30 条一次换乘（耗时更短）+ 5 条二次换乘（耗时更长）
  const one: Journey[] = Array.from({ length: 30 }, (_, i) => j2(`G${i}`, `H${i}`, 20 + i));
  const two: Journey = {
    legs: [
      t('G1', 'O', 'H', '08:00', '09:00', '01:00'),
      t('G3', 'H', 'K', '09:10', '09:40', '00:30'),
      t('G4', 'K', 'D', '10:00', '11:00', '01:00'),
    ],
    transfers: [
      { station: 'H', toStation: 'H', waitMinutes: 10, sameStation: true },
      { station: 'K', toStation: 'K', waitMinutes: 20, sameStation: true },
    ],
  };
  const capped = capJourneys([...one, two], 10);
  expect(capped.filter((j) => j.transfers.length === 1)).toHaveLength(10);
  expect(capped.filter((j) => j.transfers.length === 2)).toHaveLength(1); // 二次换乘保留
});
