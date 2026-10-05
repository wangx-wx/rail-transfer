/**
 * 城市解析单测
 * 运行：npm test
 */

import { test, expect } from 'vitest';

import { resolveCity, allCityNames } from './city.ts';

test('resolveCity：主要城市返回多站', () => {
  const bj = resolveCity('北京');
  expect(bj?.code).toBe('BJP');
  expect(bj?.stations).toContain('VNP'); // 北京南
});

test('resolveCity：首尾空格容错', () => {
  expect(resolveCity('  北京  ')?.code).toBe('BJP');
});

test('resolveCity：未识别城市 → null', () => {
  expect(resolveCity('不存在的城市')).toBeNull();
  expect(resolveCity('')).toBeNull();
});

test('allCityNames：含主要城市且去重', () => {
  const names = allCityNames();
  expect(names).toContain('北京');
  expect(names).toContain('上海');
  expect(new Set(names).size).toBe(names.length);
});
