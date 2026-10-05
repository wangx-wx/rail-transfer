/**
 * 日期工具单测（注入 now，避免随当前时间漂移）
 * 运行：npm test
 */

import { test, expect } from 'vitest';

import { defaultDate, checkDate } from './date.ts';
import { PRESALE_DAYS } from '../../shared/constants.ts';

/** 固定基准：2026-10-05 12:00 北京时间（= 04:00 UTC） */
const NOW = Date.UTC(2026, 9, 5, 4, 0, 0);

test('defaultDate：明天', () => {
  expect(defaultDate(NOW)).toBe('2026-10-06');
});

test('checkDate：今天与预售期末日均可查', () => {
  expect(checkDate('2026-10-05', NOW)).toBeNull();
  const last = new Date(NOW + 8 * 3600e3 + PRESALE_DAYS * 86400e3).toISOString().slice(0, 10);
  expect(checkDate(last, NOW)).toBeNull();
});

test('checkDate：早于今天 → 报错', () => {
  expect(checkDate('2026-10-04', NOW)).toMatch(/早于今天/);
});

test('checkDate：超出预售期 → 报「尚未开售」', () => {
  expect(checkDate('2026-11-01', NOW)).toMatch(/尚未开售/);
});
