/**
 * 枢纽池单测（T40）
 *
 * 枢纽池以 CITY_STATIONS 的 40 城为骨干，剔除出发/到达城市自身。
 */

import { test, expect } from 'vitest';

import { buildHubPool, HUB_CITIES } from './hubs.ts';

test('HUB_CITIES：至少 20 个骨干城市，且含北上广等主线枢纽', () => {
  expect(HUB_CITIES.length).toBeGreaterThanOrEqual(20);
  for (const c of ['北京', '上海', '广州', '武汉', '郑州', '西安', '长沙']) {
    expect(HUB_CITIES).toContain(c);
  }
});

test('buildHubPool：返回城市代表站码，剔除出发/到达城市', () => {
  const hubs = buildHubPool('武汉', '长沙');
  expect(hubs).not.toContain('WHN'); // 出发城市
  expect(hubs).not.toContain('CSQ'); // 到达城市
  expect(hubs).toContain('ZZF');     // 郑州
  expect(hubs.length).toBe(HUB_CITIES.length - 2);
});

test('buildHubPool：去重', () => {
  const hubs = buildHubPool('武汉', '长沙');
  expect(new Set(hubs).size).toBe(hubs.length);
});
