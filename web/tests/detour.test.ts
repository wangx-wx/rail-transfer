/**
 * 绕行判定单测（D60 耗时阈值兜底；D61 只标记不删除）
 *
 * 纯函数，不访问网络、零请求。
 *
 * ⚠️ 「回头路线」判定（`detectBacktrack`）已于 2026-10-15（T56）随经停补查移除。
 */

import { test, expect } from 'vitest';

import { isDetour } from '../lib/detour.ts';

test('耗时阈值兜底：超过最优 2.0 倍 → 疑似绕远', () => {
  expect(isDetour(300, 200)).toBe(false); // 1.5 倍
  expect(isDetour(420, 200)).toBe(true);  // 2.1 倍
  expect(isDetour(200, 0)).toBe(false);   // 无基准不判
});

test('耗时阈值：1.5 倍起标记（2026-10-13 由 2.0 收紧）', () => {
  expect(isDetour(280, 200)).toBe(false); // 1.4 倍
  expect(isDetour(320, 200)).toBe(true);  // 1.6 倍
});
