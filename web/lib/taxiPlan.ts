/**
 * 同城异站接驳：腾讯驾车响应解析（D76）
 *
 * 从 `connection.ts` 拆出（保持单文件 ≤500 行）。判定口径见 D69~D76 / T57~T62。
 *
 * ⚠️ **不本地估价**：实测 `taxi_fare` 只在长途返回（11 km 两次均无、401 km 有），
 * 而接驳限定 ≤50 km（D75），正落在「不返回」区间。上游没给就只展示时间与里程，
 * 不按计价表推算——宁可少一行，也不编一个看起来精确的数。
 */

// ── 腾讯驾车响应与打车方案（D76）──────────────────────────

/** 驾车方案（只标注用到的字段） */
export interface TencentDrivingRoute {
  /** 米 */
  distance: number;
  /** 分钟，已结合路况 */
  duration: number;
  /** 高速过路费（元） */
  toll?: number;
  /** 预估打车费（元）；**非必有**——实测只在长途返回 */
  taxi_fare?: { fare?: number };
}

/** 打车方案 */
export interface DrivingPlan {
  durationMinutes: number;
  distanceMeters: number;
  /** 车费（元）；null = 上游没给（本功能下是常态，不补估） */
  fare: number | null;
  /** 过路费（元），D76：> 0 时单独一行 */
  tollYuan: number;
}

/**
 * 解析驾车响应为打车方案（D76）。
 *
 * 只用上游给的车费；没给就 `fare: null`。
 */
export function parseDrivingRoute(route: TencentDrivingRoute | undefined): DrivingPlan | null {
  if (!route) return null;
  const quoted = route.taxi_fare?.fare;
  const fare = typeof quoted === 'number' && Number.isFinite(quoted) && quoted > 0 ? quoted : null;

  return {
    durationMinutes: route.duration ?? 0,
    distanceMeters: route.distance ?? 0,
    fare,
    tollYuan: route.toll ?? 0,
  };
}
