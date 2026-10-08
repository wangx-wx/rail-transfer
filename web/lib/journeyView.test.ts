/**
 * 自研行程视图模型单测（D63：按换乘次数分组）
 */

import { test, expect } from 'vitest';

import { groupByTransfers, journeyTitle } from './journeyView.ts';
import type { ScoredJourney } from './selfbuilt.ts';
import type { Train } from '../../shared/types.ts';

function leg(code: string, from: string, to: string, start: string, arrive: string, dur: string): Train {
  return {
    trainNo: code, trainCode: code, fromStation: from, toStation: to,
    startStation: from, endStation: to, startTime: start, arriveTime: arrive,
    duration: dur, trainDate: '20261008', fromStationNo: '01', toStationNo: '02',
    secretStr: '', seats: [], seatTypes: '',
  };
}

function j(transfers: number): ScoredJourney {
  return {
    legs: [leg('G1', 'A', 'B', '08:00', '09:00', '01:00'), leg('G2', 'B', 'C', '09:30', '10:30', '01:00')],
    transfers: Array.from({ length: transfers }, (_, i) => ({ station: `S${i}`, waitMinutes: 30, sameStation: true })),
    transfersCount: transfers,
    totalMinutes: 150,
    detour: false,
    longWait: false,
    risky: false,
  };
}

test('groupByTransfers：按换乘次数分组并升序', () => {
  const groups = groupByTransfers([j(2), j(1), j(2)]);
  expect(groups.map((g) => g.transfers)).toEqual([1, 2]);
  expect(groups[0]!.journeys).toHaveLength(1);
  expect(groups[1]!.journeys).toHaveLength(2);
});

test('journeyTitle：换乘次数 → 中文标题', () => {
  expect(journeyTitle(1)).toBe('一次换乘');
  expect(journeyTitle(2)).toBe('两次换乘');
  expect(journeyTitle(3)).toBe('3 次换乘');
});
