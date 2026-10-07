/**
 * 视图模型单测（T21：只测纯函数）
 * 运行：npm test
 */

import { test, expect } from 'vitest';

import { nameOf, viaTags, seatLabel, planFlags, waitSeverity, groupByHub, priceLabel, seatPrices, durationLabel } from './view.ts';
import { annotatePlans, mergePlans } from './plans.ts';
import type { PlanFlags, TransferPlan } from '../../shared/types.ts';

// ── nameOf ───────────────────────────────────────────────
test('nameOf：优先映射表，回退站码', () => {
  expect(nameOf('VNP', { VNP: '北京南' })).toBe('北京南');
  expect(nameOf('VNP')).toBe('VNP');
  expect(nameOf('VNP', {})).toBe('VNP');
});

// ── viaTags ──────────────────────────────────────────────
test('viaTags：始发/终到与上下车不同时，标注', () => {
  expect(viaTags('北京', '杭州东', '北京南', '上海虹桥')).toEqual(['始发 北京', '终到 杭州东']);
});

test('viaTags：始发/终到与上下车相同时，不标注', () => {
  expect(viaTags('北京南', '上海虹桥', '北京南', '上海虹桥')).toEqual([]);
});

// ── seatLabel ────────────────────────────────────────────
test('seatLabel：无票 / 数字 / 有 / 不适用', () => {
  expect(seatLabel('二等座', '无')).toEqual({ text: '二等座 无', state: 'off' });
  expect(seatLabel('二等座', '12')).toEqual({ text: '二等座 12 张', state: 'on' });
  expect(seatLabel('二等座', '有')).toEqual({ text: '二等座 有', state: 'on' });
  expect(seatLabel('二等座', '--')).toBeNull();
  expect(seatLabel('二等座', '')).toBeNull();
});

test('seatLabel：高亮席别状态为 hl', () => {
  expect(seatLabel('二等座', '有', true)).toEqual({ text: '二等座 有', state: 'hl' });
  expect(seatLabel('二等座', '有', false)).toEqual({ text: '二等座 有', state: 'on' });
});

// ── planFlags ────────────────────────────────────────────
function flags(over: Partial<PlanFlags> = {}): PlanFlags {
  return { belowMin: false, risky: false, longWait: false, sameTrain: false, ...over };
}

test('planFlags：按固定顺序产出标记', () => {
  expect(planFlags(flags({ belowMin: true, sameTrain: true }))).toEqual([
    { label: '低于换乘下限', kind: 'bad' },
    { label: '同车接续', kind: 'ok' },
  ]);
  expect(planFlags(flags({ risky: true, longWait: true }))).toEqual([
    { label: '换乘紧张', kind: 'risky' },
    { label: '超长等待', kind: 'long' },
  ]);
  expect(planFlags(flags())).toEqual([]);
});

// ── waitSeverity ─────────────────────────────────────────
test('waitSeverity：紧张/低于下限 → warn，超长 → dim，否则空', () => {
  expect(waitSeverity(flags({ belowMin: true }))).toBe('warn');
  expect(waitSeverity(flags({ risky: true }))).toBe('warn');
  expect(waitSeverity(flags({ longWait: true }))).toBe('dim');
  expect(waitSeverity(flags())).toBe('');
});

// ── groupByHub ───────────────────────────────────────────
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

test('groupByHub：按换乘枢纽分组', () => {
  const groups = mergePlans(annotatePlans([plan()]));
  const byHub = groupByHub(groups);
  expect(byHub).toHaveLength(1);
  expect(byHub[0]![0]).toBe('南京南');
  expect(byHub[0]![1]).toHaveLength(1);
});

test('groupByHub：空输入 → 空数组', () => {
  expect(groupByHub([])).toEqual([]);
});

// ── priceLabel ───────────────────────────────────────────
test('priceLabel：整数不带小数，非整数保留一位', () => {
  expect(priceLabel(626)).toBe('¥626');
  expect(priceLabel(177.5)).toBe('¥177.5');
});

test('priceLabel：未查到 → 空串', () => {
  expect(priceLabel(null)).toBe('');
  expect(priceLabel(undefined)).toBe('');
  expect(priceLabel(NaN)).toBe('');
});

test('seatPrices：按价格表顺序，名字用官方表映射', () => {
  // 高铁码
  expect(seatPrices({ O: 626, M: 1033 })).toEqual([
    { code: 'O', name: '二等座', label: '¥626' },
    { code: 'M', name: '一等座', label: '¥1033' },
  ]);
  // 普速数字码
  expect(seatPrices({ '1': 180.5, '3': 310.5 })).toEqual([
    { code: '1', name: '硬座', label: '¥180.5' },
    { code: '3', name: '硬卧', label: '¥310.5' },
  ]);
  // 未知码回退码本身，不丢数据
  expect(seatPrices({ X: 99 })).toEqual([{ code: 'X', name: 'X', label: '¥99' }]);
  expect(seatPrices(undefined)).toEqual([]);
  expect(seatPrices({})).toEqual([]);
});

// ── durationLabel ────────────────────────────────────────
test('durationLabel：时分 / 整时 / 不足 1 小时', () => {
  expect(durationLabel(258)).toBe('4时18分');
  expect(durationLabel(120)).toBe('2时');
  expect(durationLabel(2)).toBe('2分');
  expect(durationLabel(59)).toBe('59分');
  expect(durationLabel(0)).toBe('0分');
});

test('durationLabel：非法输入 → 空串', () => {
  expect(durationLabel(null)).toBe('');
  expect(durationLabel(undefined)).toBe('');
  expect(durationLabel(NaN)).toBe('');
  expect(durationLabel(-5)).toBe('');
});
