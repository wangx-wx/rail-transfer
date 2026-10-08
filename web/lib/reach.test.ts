/**
 * 离线可达图：枢纽预筛单测（T39/T40）
 *
 * 图是 build-time 产物（城市→城市邻接），runtime 只做内存查询，零网络。
 */

import { test, expect } from 'vitest';

import { canReach, filterHubs, parseReachability } from './reach.ts';

/** 邻接表：城市 → 可直达城市 */
const graph = {
  O: ['H', 'K'],
  H: ['K', 'D'],
  K: ['D'],
  X: ['Y'],
};

test('canReach：直达一跳', () => {
  expect(canReach(graph, 'O', 'H')).toBe(true);
});

test('canReach：不连通返回 false', () => {
  expect(canReach(graph, 'O', 'X')).toBe(false);
  expect(canReach(graph, 'H', 'O')).toBe(false); // 单向
});

test('canReach：自身视为可达', () => {
  expect(canReach(graph, 'O', 'O')).toBe(true);
});

test('filterHubs：只保留 出发→枢纽 与 枢纽→目的 均可达的枢纽', () => {
  const hubs = ['H', 'K', 'X'];
  expect(filterHubs(graph, 'O', 'D', hubs)).toEqual(['H', 'K']);
});

test('filterHubs：剔除出发城市自身与目的城市', () => {
  const hubs = ['O', 'D', 'H'];
  expect(filterHubs(graph, 'O', 'D', hubs)).toEqual(['H']);
});

test('parseReachability：把 {from,to} 边列表聚成邻接表', () => {
  const edges = [
    { from: 'O', to: 'H' },
    { from: 'O', to: 'K' },
    { from: 'H', to: 'K' },
  ];
  expect(parseReachability(edges)).toEqual({ O: ['H', 'K'], H: ['K'] });
});
