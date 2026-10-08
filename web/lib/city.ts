/**
 * 城市解析（纯函数，从 main.ts 抽出）
 *
 * 城市名 → 代表站码 + 该城市的全部车站码。
 */

import { CITY_STATIONS, ALL_CITIES, STATION_NAMES, STATION_CITIES } from '../data/stations.ts';

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

/**
 * 站名 → 站码（买短乘长用：经停响应只给站名，查票需站码）。
 *
 * ⚠️ 经停响应的站名**可能是城市名**（实测 G568 始发显示「广州」，实际是
 * 广州南 `IZQ`）。此处返回 `STATION_NAMES` 里的**同名站**（若存在），
 * 不做城市展开——买短乘长的候选站由**站序**定位，此处只负责最后的
 * 站名→码转换。查不到返回 null。
 */
export function codeOfStation(name: string): ResolvedCity | null {
  const n = (name || '').trim();
  if (!n) return null;
  // 主城市表里若有同名站（如「北京」→BJP），优先
  const major = (CITY_STATIONS as Record<string, { code: string } | undefined>)[n];
  if (major) return { code: major.code, stations: [major.code] };
  for (const [code, stationName] of Object.entries(STATION_NAMES as Record<string, string>)) {
    if (stationName === n) return { code, stations: [code] };
  }
  return null;
}

/**
 * 站码 → 城市名（同城判定，T37）。
 *
 * 实测坑（spike/station_name.js 城市字段）：天府机场 `TIE` → 成都、
 * 长沙 `CWQ` 实为长沙南。查不到时回退站码自身，保证自研跨城层不丢节点。
 */
export function cityOfStation(code: string): string {
  return (STATION_CITIES as Record<string, string | undefined>)[code] ?? code;
}

/** 全部可选城市名（供联想下拉使用，已去重） */
export function allCityNames(): string[] {
  return [...new Set([...Object.keys(CITY_STATIONS), ...Object.keys(ALL_CITIES)])];
}
