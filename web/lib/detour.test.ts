/**
 * 绕行判定单测（D60 官方「回头路线」规则 + 耗时阈值兜底；D61 处理策略）
 *
 * 纯函数，不访问网络。经停序列由调用方补齐（T43）。
 */

import { test, expect } from 'vitest';

import { detectBacktrack, isDetour } from './detour.ts';

/** 造一段经停（站名列表，按顺序） */
const stops = (...names: string[]): string[] => names;

const leg = (from: string, to: string) => ({ fromStation: from, toStation: to, trainNo: 'x' });

test('回头路线：第二程重走第一程已过站 → 判定为回头', () => {
  // 广州南 → 北京西 经停：广州南 长沙南 武汉 郑州东 石家庄 北京西
  // 北京西 → 十堰  经停：北京西 郑州东 襄阳东 十堰    ← 重走郑州东
  const legs = [leg('GZQ', 'BXP'), leg('BXP', 'SNN')];
  const stopsByLeg = [
    stops('广州南', '长沙南', '武汉', '郑州东', '石家庄', '北京西'),
    stops('北京西', '郑州东', '襄阳东', '十堰'),
  ];
  expect(detectBacktrack(legs, stopsByLeg)).toBe(true);
});

test('正常折向：第二程不重走已过站 → 不算回头', () => {
  // 广州南 → 武汉（经停 长沙南 武汉），武汉 → 十堰（经停 襄阳东 十堰）
  const legs = [leg('GZQ', 'WHN'), leg('WHN', 'SNN')];
  const stopsByLeg = [
    stops('广州南', '长沙南', '武汉'),
    stops('武汉', '襄阳东', '十堰'),
  ];
  expect(detectBacktrack(legs, stopsByLeg)).toBe(false);
});

test('换乘站本身不算回头（第二程起点 = 第一程终点）', () => {
  const legs = [leg('A', 'B'), leg('B', 'C')];
  const stopsByLeg = [stops('A', 'B'), stops('B', 'C')];
  expect(detectBacktrack(legs, stopsByLeg)).toBe(false);
});

test('三次换乘：任一后续程重走任一前序程已过站 → 回头', () => {
  const legs = [leg('A', 'B'), leg('B', 'C'), leg('C', 'D')];
  const stopsByLeg = [
    stops('A', 'B'),
    stops('B', 'C'),
    stops('C', 'B', 'D'), // 第三程又经过 B
  ];
  expect(detectBacktrack(legs, stopsByLeg)).toBe(true);
});

test('耗时阈值兜底：超过最优 2.0 倍 → 疑似绕远', () => {
  expect(isDetour(300, 200)).toBe(false); // 1.5 倍
  expect(isDetour(420, 200)).toBe(true);  // 2.1 倍
  expect(isDetour(200, 0)).toBe(false);   // 无基准不判
});
