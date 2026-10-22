/**
 * 自研中转列表组件测试（jsdom）
 *
 * 覆盖：按换乘次数分组标题、车次与换乘站展示、疑似绕远标记、空结果。
 */

import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import SelfBuiltList from '../components/SelfBuiltList.tsx';
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
    transfers: [{ station: 'WHN', toStation: 'WHN', waitMinutes: 20, sameStation: true }],
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

// ── D79：N 程各成一行，N−1 个换乘断点在中间 ────────────────
test('SelfBuiltList：三程各占一行，两个换乘断点在中间（D79）', () => {
  const three = journey({
    transfersCount: 2,
    transfers: [
      { station: 'WHN', toStation: 'WHN', waitMinutes: 20, sameStation: true },
      { station: 'ZAF', toStation: 'ZAF', waitMinutes: 25, sameStation: true },
    ],
    legs: [
      leg('G1101', 'GZQ', 'WHN', '08:00', '11:00', '03:00'),
      leg('G2202', 'WHN', 'ZAF', '11:20', '13:00', '01:40'),
      leg('G3303', 'ZAF', 'SNN', '13:25', '15:30', '02:05'),
    ],
  });
  const { container } = render(
    <SelfBuiltList
      journeys={[three]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  const body = container.querySelector('.plan')!;
  expect(body.querySelectorAll(':scope > .leg')).toHaveLength(3);
  expect(body.querySelectorAll(':scope > .node')).toHaveLength(2);
});

test('SelfBuiltList：换乘断点标出等待时长与站对（D79）', () => {
  const cross = journey({
    transfers: [{ station: 'WHN', toStation: 'WCN', waitMinutes: 70, sameStation: false }],
  });
  const { container } = render(
    <SelfBuiltList
      journeys={[cross]}
      date="2026-10-08"
      stationNames={{ WHN: '武汉', WCN: '武昌' }}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  const node = container.querySelector('.node')!;
  expect(node.textContent).toContain('换乘 1时10分');
  expect(node.textContent).toContain('武汉 → 武昌');
  expect(node.textContent).toContain('同城异站');
});

test('SelfBuiltList：所有行程在同一块结果面内（D79）', () => {
  const { container } = render(
    <SelfBuiltList
      journeys={manyJourneys(2)}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(container.querySelectorAll('.sheet').length).toBeGreaterThan(0);
  expect(container.querySelectorAll('.ticket-card')).toHaveLength(0);
  // 行程必须是面的直接子级，否则 `.plan:first-child` 失效、行间细线全丢
  const plans = [...container.querySelectorAll('.plan')];
  expect(plans.length).toBeGreaterThanOrEqual(2);
  for (const p of plans) expect(p.parentElement?.className).toBe('sheet');
});

test('SelfBuiltList：两次换乘分行展示', () => {
  const three = journey({
    transfersCount: 2,
    transfers: [
      { station: 'WHN', toStation: 'WHN', waitMinutes: 20, sameStation: true },
      { station: 'ZAF', toStation: 'ZAF', waitMinutes: 25, sameStation: true },
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

// ── D77：自研卡片也要有余票 ──────────────────────────────
test('SelfBuiltList：每程余票都要显示（D77）', () => {
  const j = journey();
  j.legs[0] = { ...j.legs[0]!, seats: [
    { code: 'ZE', name: '二等座', available: true, count: 12, raw: '12' },
    { code: 'ZY', name: '一等座', available: true, count: null, raw: '有' },
    { code: 'SWZ', name: '商务座', available: false, count: null, raw: '无' },
  ] };
  j.legs[1] = { ...j.legs[1]!, seats: [
    { code: 'ZE', name: '二等座', available: false, count: null, raw: '无' },
    { code: 'YW', name: '硬卧', available: true, count: 14, raw: '14' },
  ] };
  const { container } = render(
    <SelfBuiltList
      journeys={[j]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  // D79：第 N 程是行首标签，席别在该行内——断言整行文本。
  // D77：卡片层用短名（二等 / 一等 / 商务 / 硬卧），展开详情才用全名。
  const rows = [...container.querySelectorAll('.seatrow')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
  expect(rows[0]).toContain('第1程');
  for (const s of ['二等 12 张', '一等 有', '商务 无']) expect(rows[0]).toContain(s);
  expect(rows[1]).toContain('第2程');
  for (const s of ['二等 无', '硬卧 14 张']) expect(rows[1]).toContain(s);
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

// ── 分组 Top-5 + 展开更多 + 排序切换（C1/C2）────────────────
import { fireEvent } from '@testing-library/react';

/** 造一组同换乘次数、可区分的方案（车次号递增，耗时递增） */
function manyJourneys(n: number): ScoredJourney[] {
  return Array.from({ length: n }, (_, i) =>
    journey({
      totalMinutes: 200 + i * 10,
      legs: [
        leg(`G${1000 + i}`, 'GZQ', 'WHN', '08:00', '11:00', '03:00'),
        leg(`H${1000 + i}`, 'WHN', 'SNN', '11:20', '13:30', '02:10'),
      ],
    }),
  );
}

test('SelfBuiltList：每组默认只展开 Top-5，其余折叠为「展开更多」', () => {
  render(
    <SelfBuiltList
      journeys={manyJourneys(8)}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  // 前 5 条车次可见（车次号在行程/查价两处渲染，故用 getAllByText）
  expect(screen.getAllByText('G1000').length).toBeGreaterThan(0);
  expect(screen.getAllByText('G1004').length).toBeGreaterThan(0);
  // 第 6 条不可见
  expect(screen.queryAllByText('G1005')).toHaveLength(0);
  // 有「展开更多」按钮，且标明剩余条数
  expect(screen.getByText(/展开更多/).textContent).toContain('3');
});

test('SelfBuiltList：点「展开更多」显示全部（零请求）', () => {
  render(
    <SelfBuiltList
      journeys={manyJourneys(8)}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  fireEvent.click(screen.getByText(/展开更多/));
  expect(screen.getAllByText('G1007').length).toBeGreaterThan(0);
});

test('SelfBuiltList：排序切换「按总耗时」可改变同组内顺序', () => {
  // 同组（均一次换乘）：A 耗时短但疑似绕远（加权被罚），B 耗时长但不绕
  const a = journey({ totalMinutes: 250, detour: true, legs: [leg('A1', 'GZQ', 'WHN', '08:00', '11:00', '03:00'), leg('A2', 'WHN', 'SNN', '11:20', '13:30', '02:10')] });
  const b = journey({ totalMinutes: 300, detour: false, legs: [leg('B1', 'GZQ', 'WHN', '08:00', '11:00', '03:00'), leg('B2', 'WHN', 'SNN', '11:20', '13:30', '02:10')] });
  const { container } = render(
    <SelfBuiltList
      journeys={[a, b]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  const firstCode = (): string | null | undefined => container.querySelector('.leg-heading strong')?.textContent;
  // 默认加权：B（350）< A（250+45+60=355）→ B 在前
  expect(firstCode()).toBe('B1');
  // 切「按总耗时」：A（250）在前
  fireEvent.click(screen.getByText('按总耗时'));
  expect(firstCode()).toBe('A1');
});

// ── 接驳入口（D69：自研通路也提供，且共用同一组件）────────
test('SelfBuiltList：同城异站换乘给出「查接驳」按钮与「到达站 → 出发站」', () => {
  const cross = journey({
    transfers: [{ station: 'WHN', toStation: 'WCN', waitMinutes: 70, sameStation: false }],
  });
  render(
    <SelfBuiltList
      journeys={[cross]}
      date="2026-10-08"
      stationNames={{ GZQ: '广州南', WHN: '武汉', WCN: '武昌', SNN: '十堰' }}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.getByRole('button', { name: /查接驳/ })).toBeTruthy();
  // D79：换乘断点与接驳面板都会出现这对站名，故用 getAllByText
  expect(screen.getAllByText(/武汉\s*→\s*武昌/).length).toBeGreaterThan(0);
});

test('SelfBuiltList：同站换乘仍不显示接驳区', () => {
  render(
    <SelfBuiltList
      journeys={[journey()]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.queryByRole('button', { name: /查接驳/ })).toBeNull();
});

test('SelfBuiltList：换乘行仍标明同站 / 同城异站', () => {
  const cross = journey({
    transfers: [{ station: 'WHN', toStation: 'WCN', waitMinutes: 70, sameStation: false }],
  });
  render(
    <SelfBuiltList
      journeys={[cross]}
      date="2026-10-08"
      stationNames={{}}
      prices={{}}
      loadingPrice={new Set()}
      onQueryPrice={noop}
    />,
  );
  expect(screen.getByText('同城异站')).toBeTruthy();
});

test('SelfBuiltList：接驳价格不并入二等座参考价（D72）', () => {
  const cross = journey({
    transfers: [{ station: 'WHN', toStation: 'WCN', waitMinutes: 70, sameStation: false }],
  });
  render(
    <SelfBuiltList
      journeys={[cross]}
      date="2026-10-08"
      stationNames={{ WHN: '武汉', WCN: '武昌' }}
      prices={{ 'G1101|01|02': { O: 300 }, 'G2202|01|02': { O: 280 } }}
      loadingPrice={new Set()}
      onQueryPrice={noop}
      connections={{
        'WHN>WCN': {
          kind: 'ok',
          km: 12,
          transit: { kind: 'empty' },
          driving: { kind: 'plan', plan: { durationMinutes: 20, distanceMeters: 12000, fare: 40, tollYuan: 0 } },
          flags: [],
        },
      }}
    />,
  );
  // 参考价仍是 300 + 280，接驳的 ¥40 不进总价
  expect(screen.getByText('二等座参考价 ¥580')).toBeTruthy();
});
