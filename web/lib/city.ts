/**
 * 城市解析（纯函数，从 main.ts 抽出）
 *
 * 城市名 → 代表站码 + 该城市的全部车站码。
 */

import { CITY_STATIONS, ALL_CITIES } from '../data/stations.ts';

/** 解析后的城市 */
export interface ResolvedCity {
  /** 代表站码（用于 API 查询） */
  code: string;
  /** 该城市全部车站码（用于换乘枢纽排除） */
  stations: string[];
}

/**
 * 城市名 → {code, stations}
 *
 * 优先查主要城市表（含多站），回退到全量城市表（单站），
 * 都查不到返回 null（调用方提示「未识别的城市」）。
 */
export function resolveCity(name: string): ResolvedCity | null {
  const n = (name || '').trim();
  const major = (CITY_STATIONS as Record<string, { code: string; stations: string[] } | undefined>)[n];
  if (major) return { code: major.code, stations: major.stations };
  const code = (ALL_CITIES as Record<string, string | undefined>)[n];
  return code ? { code, stations: [code] } : null;
}

/** 全部可选城市名（供联想下拉使用，已去重） */
export function allCityNames(): string[] {
  return [...new Set([...Object.keys(CITY_STATIONS), ...Object.keys(ALL_CITIES)])];
}
