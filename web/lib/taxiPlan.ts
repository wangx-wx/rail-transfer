/**
 * 同城异站接驳：腾讯驾车响应解析与打车费（D76）
 *
 * 从 `connection.ts` 拆出（保持单文件 ≤500 行）。判定口径见 D69~D76 / T57~T62。
 */

import { TAXI_TARIFF, estimateTaxiFare, isNightDeparture } from './taxiTariff.ts';

// ── 腾讯驾车响应与打车方案（D76）──────────────────────────

/** 驾车方案（只标注用到的字段） */
export interface TencentDrivingRoute {
  /** 米 */
  distance: number;
  /** 分钟，已结合路况 */
  duration: number;
  /** 高速过路费（元） */
  toll?: number;
  /** 预估打车费（元）；**非必有**，文档未说明触发条件 */
  taxi_fare?: { fare?: number };
}

/** 打车价格来源（D76：两者在 UI 上必须可区分） */
export type TaxiFareSource = 'traffic' | 'tariff';

/** 打车方案 */
export interface DrivingPlan {
  durationMinutes: number;
  distanceMeters: number;
  /** 车费；null = 既无路况估算、城市也不在计价表内 */
  fare: { yuan: number; source: TaxiFareSource } | null;
  /** 过路费（元），D76：> 0 时单独一行 */
  tollYuan: number;
}

/** 解析驾车方案的额外输入 */
export interface DrivingParseOptions {
  /** 城市名（计价表兜底用；取 `STATION_CITIES` 口径） */
  city?: string;
  /** 出发时刻 `HH:MM`（夜间加价按它判断，D76） */
  departureTime?: string;
}

/**
 * 解析驾车响应为打车方案（D76）。
 *
 * 价格优先级：腾讯 `taxi_fare`（标「路况估算」）→ 城市计价表推算（标「估算」）。
 * 两者都没有就不给价——宁可少一行，也不编一个数。
 */
export function parseDrivingRoute(
  route: TencentDrivingRoute | undefined,
  opts: DrivingParseOptions = {},
): DrivingPlan | null {
  if (!route) return null;
  const rideMinutes = route.duration ?? 0;
  const meters = route.distance ?? 0;
  const tollYuan = route.toll ?? 0;

  const quoted = route.taxi_fare?.fare;
  let fare: DrivingPlan['fare'] = null;
  if (typeof quoted === 'number' && Number.isFinite(quoted) && quoted > 0) {
    // 上游已是含夜间加价的最终价，此处不再叠加
    fare = { yuan: quoted, source: 'traffic' };
  } else {
    const tariff = opts.city ? TAXI_TARIFF[opts.city] : undefined;
    if (tariff) {
      fare = {
        yuan: estimateTaxiFare(tariff, meters, isNightDeparture(opts.departureTime)),
        source: 'tariff',
      };
    }
  }

  return { durationMinutes: rideMinutes, distanceMeters: meters, fare, tollYuan };
}
