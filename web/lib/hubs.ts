/**
 * 枢纽池（T40）——自研中转换乘的候选枢纽来源
 *
 * 以 `CITY_STATIONS` 的 40 城为骨干（用城市代表站码调用余票接口，
 * 服务端自动展开全城，T35/D19），查询时剔除出发/到达城市自身。
 *
 * 可达性预筛（T39）是可选优化，作用于本模块产出的池子之上（见 reach.ts）。
 * 纯函数，便于单测。
 */

import { CITY_STATIONS } from '../data/stations.ts';

/** 骨干枢纽城市清单（T40：40 城，剔除出发/到达后落到约 15~25 个） */
export const HUB_CITIES: string[] = [
  '北京', '上海', '广州', '深圳', '天津', '重庆', '成都', '杭州',
  '南京', '武汉', '西安', '长沙', '郑州', '济南', '青岛', '沈阳',
  '大连', '哈尔滨', '长春', '石家庄', '太原', '合肥', '福州', '厦门',
  '南昌', '昆明', '贵阳', '南宁', '兰州', '西宁', '银川', '乌鲁木齐',
  '呼和浩特', '苏州', '无锡', '常州', '宁波', '温州',
].filter((c) => c in (CITY_STATIONS as Record<string, unknown>));

/**
 * 构造候选枢纽站码池（T40）。
 *
 * @param fromCity 出发城市名
 * @param toCity   到达城市名
 */
export function buildHubPool(fromCity: string, toCity: string): string[] {
  const table = CITY_STATIONS as Record<string, { code: string } | undefined>;
  const exclude = new Set([fromCity, toCity]);
  const codes: string[] = [];
  for (const city of HUB_CITIES) {
    if (exclude.has(city)) continue;
    const c = table[city]?.code;
    if (c) codes.push(c);
  }
  return [...new Set(codes)];
}
