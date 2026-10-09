/**
 * 自研中转列表组件测试（jsdom）
 *
 * 覆盖：按换乘次数分组标题、车次与换乘站展示、疑似绕远标记、空结果。
 */

import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import SelfBuiltList from './SelfBuiltList.tsx';
import type { ScoredJourney } from '../lib/selfbuilt.ts';
import type { Train } from '../../shared/types.ts';

function leg(code: string, from: string, to: string, start: string, arrive: string, dur: string): Train {
  return {
    trainNo: code, trainCode: code, fromStation: from, toStation: to,
    startStation: from, endStation: to, startTime: start, arriveTime: arrive,
    duration: dur, trainDate: '20261008', fromStationNo: '01', toStationNo: '02',
    secretStr: '', seats: [], seatTypes: '9MOO',
  };
}

function journey(over: Partial<ScoredJourney> = {}): ScoredJourney {
  return {
    legs: [
      leg('G1101', 'GZQ', 'WHN', '08:00', '11:00', '03:00'),
      leg('G2202', 'WHN', 'SNN', '11:20', '13:30', '02:10'),
    ],
    transfers: [{ station: 'WHN', waitMinutes: 20, sameStation: true }],
    transfersCount: 1,
    totalMinutes: 310,
    detour: false,
    longWait: false,
    risky: false,
    ...over,
  };
}

const noop = vi.fn();

test('SelfBuiltList：渲染换乘分组标题与车次', () => {
  render(
    <SelfBuiltList
      journeys={[journey()]}
      date="2026-10-08"
      stationNames={{ GZQ: '广州南', WHN: '武汉', SNN: '十堰' }}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.getByText('一次换乘')).toBeTruthy();
  expect(screen.getAllByText(/G1101/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/G2202/).length).toBeGreaterThan(0);
});

test('SelfBuiltList：两次换乘分行展示', () => {
  const three = journey({
    transfersCount: 2,
    transfers: [
      { station: 'WHN', waitMinutes: 20, sameStation: true },
      { station: 'ZAF', waitMinutes: 25, sameStation: true },
    ],
    legs: [
      leg('G1101', 'GZQ', 'WHN', '08:00', '11:00', '03:00'),
      leg('G2202', 'WHN', 'ZAF', '11:20', '13:00', '01:40'),
      leg('G3303', 'ZAF', 'SNN', '13:25', '15:30', '02:05'),
    ],
  });
  render(
    <SelfBuiltList
      journeys={[three]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.getByText('两次换乘')).toBeTruthy();
});

test('SelfBuiltList：疑似绕远显示标记', () => {
  render(
    <SelfBuiltList
      journeys={[journey({ detour: true })]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.getByText('疑似绕远')).toBeTruthy();
});

test('SelfBuiltList：空结果给出提示', () => {
  render(
    <SelfBuiltList
      journeys={[]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.getByText('没有自研中转方案')).toBeTruthy();
});

// ── 每程查价：方案1 对齐小表 ──────────────────────────────
test('SelfBuiltList：每程价格按固定席别序排成多行表格（方案1）', () => {
  const { container } = render(
    <SelfBuiltList
      journeys={[journey()]}
      date="2026-10-08"
      stationNames={{}}
      prices={{ 'G1101|01|02': { O: 300, M: 450, '9': 900 }, 'G2202|01|02': { O: 280 } }}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  const lists = container.querySelectorAll('.price-list');
  expect(lists).toHaveLength(2);
  expect([...lists[0]!.querySelectorAll('.price-name')].map((n) => n.textContent))
    .toEqual(['商务座', '一等座', '二等座']);
  expect([...lists[1]!.querySelectorAll('.price-name')].map((n) => n.textContent)).toEqual(['二等座']);
});

test('SelfBuiltList：两程都查到二等座时显示参考价与分解', () => {
  render(
    <SelfBuiltList
      journeys={[journey()]}
      date="2026-10-08"
      stationNames={{}}
      prices={{ 'G1101|01|02': { O: 300 }, 'G2202|01|02': { O: 280 } }}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.getByText('二等座参考价 ¥580')).toBeTruthy();
  expect(screen.getByText('¥300 + ¥280')).toBeTruthy();
});

test('SelfBuiltList：二等座价格行高亮（方案B）', () => {
  const { container } = render(
    <SelfBuiltList
      journeys={[journey()]}
      date="2026-10-08"
      stationNames={{}}
      prices={{ 'G1101|01|02': { O: 300, M: 450 } }}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  const refRow = container.querySelector('.price-row--ref');
  expect(refRow?.querySelector('.price-name')?.textContent).toBe('二等座');
});
