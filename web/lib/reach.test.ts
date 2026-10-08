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

// ── 大屏响应 → 可达边（T39 build-time）────────────────────
import { bigscreenToEdges } from './reach.ts';

test('bigscreenToEdges：由车次起终站推出城市邻接边', () => {
  const rows = [
    { start_station_telecode: 'VNP', end_station_telecode: 'AOH' },
    { start_station_telecode: 'VNP', end_station_telecode: 'AOH' }, // 重复
    { start_station_telecode: 'AOH', end_station_telecode: 'IZQ' },
  ];
  const cityOf = (code: string): string => ({ VNP: '北京', AOH: '上海', IZQ: '广州' }[code] ?? code);
  expect(bigscreenToEdges(rows, cityOf)).toEqual([
    { from: '北京', to: '上海' },
    { from: '上海', to: '广州' },
  ]);
});

test('bigscreenToEdges：忽略缺码或同城边', () => {
  const rows = [
    { start_station_telecode: '', end_station_telecode: 'AOH' },
    { start_station_telecode: 'BJP', end_station_telecode: 'VNP' }, // 同为北京
  ];
  const cityOf = (code: string): string => ({ BJP: '北京', VNP: '北京', AOH: '上海' }[code] ?? code);
  expect(bigscreenToEdges(rows, cityOf)).toEqual([]);
});

// ── 真实产物：离线可达图 ──────────────────────────────────
import { REACHABILITY_EDGES } from '../data/reachability.ts';
import { prefilterHubs } from './reach.ts';

test('产物：可达图非空、边数上千、双向成对居多', () => {
  expect(REACHABILITY_EDGES.length).toBeGreaterThan(1000);
  const g = parseReachability(REACHABILITY_EDGES);
  expect(canReach(g, '北京', '上海')).toBe(true);
  expect(canReach(g, '武汉', '广州')).toBe(true);
});

test('prefilterHubs：双方都已知 → 剔除无法到达的枢纽', () => {
  const g = parseReachability([
    { from: '武汉', to: '郑州' },
    { from: '郑州', to: '北京' },
    { from: '武汉', to: '长沙' },
  ]);
  // known = {武汉,郑州,北京,长沙}；长沙无 →北京 边 → 剔除
  expect(prefilterHubs(g, '武汉', '北京', ['郑州', '长沙'])).toEqual(['郑州']);
});

test('prefilterHubs：目的地未知 → 不因缺 inbound 边而误杀枢纽', () => {
  const g = parseReachability([{ from: '武汉', to: '郑州' }]);
  // 十堰不在图中 → 目的地侧跳过，只按已知的出发侧过滤
  expect(prefilterHubs(g, '武汉', '十堰', ['郑州'])).toEqual(['郑州']);
});

test('prefilterHubs：出发城市未知 → 出发侧跳过', () => {
  const g = parseReachability([{ from: '武汉', to: '郑州' }]);
  // 十堰不在图中 → 出发侧跳过；北京也不在图 → 目的地侧跳过 → 全集保留
  expect(prefilterHubs(g, '十堰', '北京', ['郑州', '长沙'])).toEqual(['郑州', '长沙']);
});
