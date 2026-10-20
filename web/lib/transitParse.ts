/**
 * 同城异站接驳：腾讯公交响应解析（T57）
 *
 * 从 `connection.ts` 拆出（保持单文件 ≤500 行）。判定口径见 D69~D76 / T57~T62。
 */

// ── 腾讯公交响应（只标注用到的字段，T57）──────────────────

/** 公交方案里的一段步行 */
export interface TencentTransitWalking {
  mode: 'WALKING';
  /** 米 */
  distance: number;
  /** 分钟 */
  duration: number;
}

/** 公交方案里的一条线路（地铁/公交/火车） */
export interface TencentTransitLine {
  vehicle: 'BUS' | 'SUBWAY' | 'RAIL';
  title: string;
  /** 经停站数 */
  station_count?: number;
  /** 300 正常 / 301 可能错过末班 / 302 首班未发 / 303 停运 */
  running_status?: number;
  /** 票价（分）；-1 = 无票价信息。显式传 price_unit=1 后统一为分 */
  price?: number;
  distance?: number;
  duration?: number;
  geton?: { title?: string };
  getoff?: { title?: string };
}

/** 公交方案里的一段乘车 */
export interface TencentTransitTransit {
  mode: 'TRANSIT';
  lines?: TencentTransitLine[];
}

export type TencentTransitStep = TencentTransitWalking | TencentTransitTransit;

/** 一个公交方案 */
export interface TencentTransitRoute {
  /** 米 */
  distance: number;
  /** 分钟 */
  duration: number;
  /** 方案总价（分，price_unit=1）；-1 = 无 */
  price?: number;
  steps?: TencentTransitStep[];
}

/** 公交响应的 result（腾讯 HTTP 恒 200，业务码在顶层 status） */
export interface TencentTransitResult {
  routes?: TencentTransitRoute[];
}

/** 一条线路的展示信息 */
export interface TransitLine {
  vehicle: TencentTransitLine['vehicle'];
  /** 线路名（如「地铁4号线大兴线」） */
  title: string;
  geton: string;
  getoff: string;
  /** 经停站数；上游未给时为 null */
  stationCount: number | null;
  /** 末班/首班/停运状态码；300 正常 */
  runningStatus: number | null;
}

/** 解析后的公交方案（取最快那条；T57：步行与换乘次数需自算） */
export interface TransitPlan {
  /** 总耗时（分钟） */
  durationMinutes: number;
  /** 总里程（米，含步行） */
  distanceMeters: number;
  /** 步行距离合计（米）——上游无汇总字段，由各步行段累加 */
  walkMeters: number;
  /** 票价（分）；null = 上游无票价信息 */
  fareFen: number | null;
  /** 换乘次数 = 乘车段数 − 1（上游无换乘次数字段） */
  transfers: number;
  /** 是否有轨道交通（地铁或火车）——D73「无地铁」标签用 */
  hasSubway: boolean;
  lines: TransitLine[];
}

/** 解析公交响应的每条方案（保持上游顺序；取最快由 `pickFastestTransit` 负责） */
export function parseTransitRoutes(
  result: TencentTransitResult | undefined,
): TransitPlan[] {
  return (result?.routes ?? []).map((r) => {
    const steps = r.steps ?? [];
    let walkMeters = 0;
    let rideSegments = 0;
    let hasSubway = false;
    const lines: TransitLine[] = [];

    for (const s of steps) {
      if (s.mode === 'WALKING') {
        walkMeters += s.distance ?? 0;
        continue;
      }
      const segLines = s.lines ?? [];
      if (!segLines.length) continue;
      rideSegments++;
      // ⚠️ 同一乘车段里的 `lines[]` 是**并列可选项**（如「1路 / 2路」二选一），
      // 不是顺序乘坐；展开成顺序线路会误导，也会把换乘次数算多。
      for (const l of segLines.slice(0, 1)) {
        if (l.vehicle === 'SUBWAY' || l.vehicle === 'RAIL') hasSubway = true;
        lines.push({
          vehicle: l.vehicle,
          title: l.title ?? '',
          geton: l.geton?.title ?? '',
          getoff: l.getoff?.title ?? '',
          stationCount: l.station_count ?? null,
          runningStatus: l.running_status ?? null,
        });
      }
    }

    return {
      durationMinutes: r.duration ?? 0,
      distanceMeters: r.distance ?? 0,
      walkMeters,
      fareFen: r.price != null && r.price >= 0 ? r.price : null,
      transfers: Math.max(0, rideSegments - 1),
      hasSubway,
      lines,
    };
  });
}

/**
 * 取耗时最短的公交方案（D71）。
 *
 * ⚠️ 上游只承诺默认策略为「时间短」，**未承诺数组按耗时升序**，
 * 故必须自行比较，不能取 `routes[0]`。
 */
export function pickFastestTransit(plans: TransitPlan[]): TransitPlan | null {
  let best: TransitPlan | null = null;
  for (const p of plans) {
    if (!best || p.durationMinutes < best.durationMinutes) best = p;
  }
  return best;
}
