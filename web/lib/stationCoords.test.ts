/**
 * 站点坐标读取封装测试（T59 第三接缝）
 *
 * 用注入的假坐标表，不依赖真实产物内容——产物结构由生成脚本保证，
 * 这里只测「读取与降级」这一层的可见行为。
 */

import { test, expect, vi } from 'vitest';

import { createCoordSource, toLatLng } from './stationCoords.ts';

const TABLE = { VNP: [39.86526, 116.378525] as [number, number], BXP: [39.894986, 116.321198] as [number, number] };

test('of：已有站返回坐标（纬度在前，与产物一致）', async () => {
  const src = createCoordSource(async () => TABLE);
  expect(await src.of('VNP')).toEqual({ lat: 39.86526, lng: 116.378525 });
});

test('of：缺失站返回 undefined（不猜、不回落城市坐标）', async () => {
  const src = createCoordSource(async () => TABLE);
  expect(await src.of('ZZZZ')).toBeUndefined();
});

test('of：空站码返回 undefined 且不触发加载', async () => {
  const load = vi.fn(async () => TABLE);
  const src = createCoordSource(load);
  expect(await src.of('')).toBeUndefined();
  expect(load).not.toHaveBeenCalled();
});

test('of：坐标表只加载一次（多次查询复用）', async () => {
  const load = vi.fn(async () => TABLE);
  const src = createCoordSource(load);
  await src.of('VNP');
  await src.of('BXP');
  await src.of('ZZZZ');
  expect(load).toHaveBeenCalledTimes(1);
});

test('of：并发调用也只加载一次', async () => {
  const load = vi.fn(async () => TABLE);
  const src = createCoordSource(load);
  await Promise.all([src.of('VNP'), src.of('BXP'), src.of('VNP')]);
  expect(load).toHaveBeenCalledTimes(1);
});

test('of：加载失败 → 全部视为缺坐标，不抛错', async () => {
  const src = createCoordSource(async () => {
    throw new Error('产物 404');
  });
  expect(await src.of('VNP')).toBeUndefined();
});

test('toLatLng：数组 [纬度, 经度] 映射为对象', () => {
  expect(toLatLng([39.8, 116.3])).toEqual({ lat: 39.8, lng: 116.3 });
});
