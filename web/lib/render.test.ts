/**
 * 渲染层单测（T21：只测纯函数）
 * 运行：npm test
 */

import { test, expect } from 'vitest';

import { esc, seatTag, renderTrains, renderTransfers } from './render.ts';
import { annotatePlans, mergePlans } from './plans.ts';
import type { Train, TransferPlan } from '../../shared/types.ts';

test('esc：转义 HTML 特殊字符', () => {
  expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
});

// ── seatTag ──────────────────────────────────────────────
test('seatTag：无票 / 数字 / 有 / 不适用', () => {
  expect(seatTag('二等座', '无')).toMatch(/off/);
  expect(seatTag('二等座', '12')).toMatch(/12 张/);
  expect(seatTag('二等座', '有')).toMatch(/有/);
  expect(seatTag('二等座', '--')).toBe('');
  expect(seatTag('二等座', '')).toBe('');
});

test('seatTag：高亮席别加 hl 类', () => {
  expect(seatTag('二等座', '有', true)).toMatch(/hl/);
  expect(seatTag('二等座', '有', false)).not.toMatch(/hl/);
});

// ── renderTrains ─────────────────────────────────────────
function train(over: Partial<Train> = {}): Train {
  return {
    trainCode: 'G1',
    trainNo: '1',
    startTime: '06:00',
    arriveTime: '12:00',
    duration: '06:00',
    trainDate: '20261007',
    fromStation: 'VNP',
    toStation: 'AOH',
    startStation: 'VNP',
    endStation: 'AOH',
    fromStationNo: '01',
    toStationNo: '02',
    secretStr: '',
    seats: [{ code: 'ZE', name: '二等座', available: true, count: null, raw: '有' }],
    ...over,
  };
}

test('renderTrains：无车次提示', () => {
  expect(renderTrains([], {})).toMatch(/没有直达车次/);
});

test('renderTrains：展示车次、上/下车站、时刻', () => {
  const html = renderTrains([train()], { VNP: '北京南', AOH: '上海虹桥' }, 'ZE');
  expect(html).toMatch(/G1/);
  expect(html).toMatch(/北京南/);
  expect(html).toMatch(/上海虹桥/);
  expect(html).toMatch(/06:00/);
});

test('renderTrains：始发/终到与上下车不同时，标注「始发/终到」', () => {
  const html = renderTrains(
    [train({ fromStation: 'VNP', toStation: 'AOH', startStation: 'BJP', endStation: 'HGH' })],
    { VNP: '北京南', AOH: '上海虹桥', BJP: '北京', HGH: '杭州东' },
    'ZE',
  );
  expect(html).toMatch(/始发 北京/);
  expect(html).toMatch(/终到 杭州东/);
});

test('renderTrains：始发/终到与上下车相同时，不标注', () => {
  const html = renderTrains([train()], { VNP: '北京南', AOH: '上海虹桥' }, 'ZE');
  expect(html).not.toMatch(/始发/);
  expect(html).not.toMatch(/终到/);
});

// ── renderTransfers ──────────────────────────────────────
function plan(over: Partial<TransferPlan> = {}): TransferPlan {
  return {
    fromStation: '北京南',
    middleStation: '南京南',
    endStation: '上海虹桥',
    firstTrainCode: 'G1',
    secondTrainCode: 'G2',
    firstTrainNo: '1',
    secondTrainNo: '2',
    startTime: '06:00',
    arriveTime: '12:00',
    waitMinutes: 30,
    totalMinutes: 360,
    sameStation: true,
    sameTrain: false,
    score: 0,
    legs: [
      { trainCode: 'G1', trainNo: '1', startStation: '北京南', endStation: '南京南', fromStation: '北京南', toStation: '南京南', startTime: '06:00', arriveTime: '09:00', duration: '03:00', seats: { ZE: '有' } },
      { trainCode: 'G2', trainNo: '2', startStation: '南京南', endStation: '上海虹桥', fromStation: '南京南', toStation: '上海虹桥', startTime: '09:30', arriveTime: '12:00', duration: '02:30', seats: { ZE: '无' } },
    ],
    ...over,
  };
}

test('renderTransfers：空提示', () => {
  expect(renderTransfers([])).toMatch(/没有中转方案/);
});

test('renderTransfers：按换乘枢纽分组，展示起终点与总耗时', () => {
  const html = renderTransfers(mergePlans(annotatePlans([plan()])));
  expect(html).toMatch(/南京南/);
  expect(html).toMatch(/北京南 → 上海虹桥/);
  expect(html).toMatch(/总耗时 360 分/);
});

test('renderTransfers：展示每一程的车次与上下车站', () => {
  const html = renderTransfers(mergePlans(annotatePlans([plan()])));
  expect(html).toMatch(/G1/);
  expect(html).toMatch(/G2/);
  expect(html).toMatch(/06:00/);
  expect(html).toMatch(/09:30/);
  expect(html).toMatch(/换乘 <b>南京南<\/b>/);
});

test('renderTransfers：同站/同城异站标签', () => {
  const same = renderTransfers(mergePlans(annotatePlans([plan({ sameStation: true })])));
  expect(same).toMatch(/>同站</);
  const cross = renderTransfers(mergePlans(annotatePlans([plan({ sameStation: false })])));
  expect(cross).toMatch(/>同城异站</);
});

test('renderTransfers：低于下限 / 超长等待标记', () => {
  const bad = renderTransfers(mergePlans(annotatePlans([plan({ waitMinutes: 5, sameStation: true })])));
  expect(bad).toMatch(/低于换乘下限/);
  const long = renderTransfers(mergePlans(annotatePlans([plan({ waitMinutes: 200 })])));
  expect(long).toMatch(/超长等待/);
});
