/**
 * 同城异站接驳编排（D69~D76 / T60）
 *
 * 纯函数 + 注入式取数，不触碰网络与 DOM，便于零网络单测（沿用买短乘长的写法）。
 * 只负责「给定坐标与上游响应 → 展示模型」，请求由调用方注入。
 */

import { RISK_WAIT_THRESHOLD } from '../../shared/constants.ts';
import { TAXI_TARIFF, estimateTaxiFare, isNightDeparture } from './taxiTariff.ts';

/** 经纬度（腾讯接口一律 `lat,lng` 顺序，T57） */
export interface LatLng {
  lat: number;
  lng: number;
}

/** 地球平均半径（公里） */
const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * 两点间大圆（球面）距离，单位**公里**。
 *
 * D75 用它判定「跨城接驳」，故必须是真实里程而非经纬度欧氏距离——
 * `reach.ts` 里的 `dist()` 是度数欧氏近似，只够做方向过滤，不能用于 50 km 判定。
 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 跨城阈值（公里，D75）：直线距离**大于**此值即判「跨城异站」，不给市内交通方案。
 *
 * 「同城」沿用 12306 的地级行政区口径，会包含榆次↔和顺县这类百公里站对；
 * 本阈值只作用于接驳展示，**不改**换乘可行性判定（同城异站仍按 60 分下限）。
 */
export const CROSS_CITY_KM = 50;

/** 接驳前置判定结果 */
export type ConnectionGate =
  | { kind: 'ok'; km: number }
  | { kind: 'crossCity'; km: number }
  | { kind: 'noCoord' };

/**
 * 判定一对换乘站能否查接驳（D75）。
 *
 * 缺任一坐标 → 不查（宁可不给，也不拿城市坐标瞎猜）。
 */
export function gateConnection(from: LatLng | undefined, to: LatLng | undefined): ConnectionGate {
  if (!from || !to) return { kind: 'noCoord' };
  const km = distanceKm(from, to);
  return km > CROSS_CITY_KM ? { kind: 'crossCity', km } : { kind: 'ok', km };
}

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

// ── 接驳标记（D73）────────────────────────────────────────

/** 接驳标记类别（决定 Tag 颜色） */
export type ConnectionFlagKind = 'bad' | 'risky' | 'info';

/** 一条接驳标记 */
export interface ConnectionFlag {
  label: string;
  kind: ConnectionFlagKind;
}

/** 标记判定输入 */
export interface ConnectionFlagInput {
  /** 换乘等待（分钟） */
  waitMinutes: number;
  /** 公交方案；null = 未查到 */
  transit: TransitPlan | null;
  /** 打车方案；null = 未查到 */
  driving: DrivingPlan | null;
  /** 两站直线距离（公里） */
  km: number;
}

/** 公交状态码 → 标记文案（300 正常不标） */
const RUNNING_STATUS_LABEL: Record<number, string> = {
  301: '可能错过末班',
  302: '首班未发',
  303: '停运',
};

/** 状态码严重度（越大越严重），用于多条线路时取最严重一个 */
const RUNNING_STATUS_SEVERITY: Record<number, number> = { 301: 1, 302: 2, 303: 3 };

/**
 * 接驳与换乘等待的匹配标记（D73）。
 *
 * 三档沿用既有 `RISK_WAIT_THRESHOLD`（20 分），不新增常量；只标记，
 * **不删方案、不改排序**（延续 D12）。跨城时短路——那时本就没有市内方案可判。
 */
export function connectionFlags(input: ConnectionFlagInput): ConnectionFlag[] {
  if (input.km > CROSS_CITY_KM) return [{ label: '跨城接驳', kind: 'info' }];

  const { waitMinutes, transit, driving } = input;
  const durations = [transit?.durationMinutes, driving?.durationMinutes].filter(
    (m): m is number => m != null,
  );
  if (!durations.length) return [];

  const fastest = Math.min(...durations);
  const margin = waitMinutes - fastest;

  const insufficient = margin < 0;
  // 公交赶不上但打车赶得上——此时「紧张」没有信息量，由本标记取代
  const needTaxi =
    !insufficient &&
    transit != null &&
    driving != null &&
    waitMinutes - transit.durationMinutes < 0 &&
    margin >= 0;

  const flags: ConnectionFlag[] = [];
  if (insufficient) flags.push({ label: '接驳时间不足', kind: 'bad' });
  else if (needTaxi) flags.push({ label: '需打车', kind: 'risky' });
  else if (margin < RISK_WAIT_THRESHOLD) flags.push({ label: '接驳紧张', kind: 'risky' });

  if (transit && !transit.hasSubway) flags.push({ label: '无地铁', kind: 'info' });

  const status = worstRunningStatus(transit);
  if (status != null) flags.push({ label: RUNNING_STATUS_LABEL[status]!, kind: 'risky' });

  return flags;
}

/** 公交线路里最严重的运行状态码（301/302/303）；正常或无状态返回 null */
function worstRunningStatus(plan: TransitPlan | null): number | null {
  let worst: number | null = null;
  let severity = 0;
  for (const line of plan?.lines ?? []) {
    const s = line.runningStatus;
    if (s == null) continue;
    const sev = RUNNING_STATUS_SEVERITY[s] ?? 0;
    if (sev > severity) {
      severity = sev;
      worst = s;
    }
  }
  return worst;
}

// ── 腾讯业务状态码分类（T58）──────────────────────────────

/**
 * 上游失败类别。
 *
 * `retriable` = 配额或瞬时后端错误，重试可能成功；其余重试无意义，
 * 直接展示原因（D74 要求「不提供重试」）。
 */
export type TencentFailureKind =
  | 'retriable'
  | 'unsupportedCity'
  | 'noResult'
  | 'config'
  | 'error';

/** 状态码分类结果 */
export type TencentStatus =
  | { kind: 'ok' }
  | { kind: 'retriable' | 'unsupportedCity' | 'noResult' | 'config' | 'error'; kindLabel: string };

/** 配额与瞬时错误：重试可能成功 */
const RETRIABLE_CODES = new Set([120, 121, 500, 510, 520, 530, 531, 600]);
/** key 未授权 / 无效：属于配置问题，重试无意义 */
const CONFIG_CODES = new Set([110, 111, 112, 113, 190, 199, 311]);
/** 业务性无结果 */
const NO_RESULT_CODES = new Set([327, 328, 329, 344, 347, 387, 393]);
/** 起终点异常（太近 / 太远）——同样不该重试 */
const ENDPOINT_CODES = new Set([326, 365, 366, 373]);

/**
 * 把腾讯业务状态码归入可操作类别（T58）。
 *
 * 腾讯 HTTP 恒 200，成功与否只看响应体顶层 `status`。
 */
export function classifyTencentStatus(status: number): TencentStatus {
  if (status === 0) return { kind: 'ok' };
  if (status === 335) return { kind: 'unsupportedCity', kindLabel: '腾讯不支持该城市的公交查询' };
  if (RETRIABLE_CODES.has(status)) return { kind: 'retriable', kindLabel: '上游繁忙' };
  if (NO_RESULT_CODES.has(status)) return { kind: 'noResult', kindLabel: '无可达路线' };
  if (CONFIG_CODES.has(status)) return { kind: 'config', kindLabel: '接驳服务未配置' };
  if (ENDPOINT_CODES.has(status)) return { kind: 'error', kindLabel: '站点位置异常' };
  return { kind: 'error', kindLabel: `上游错误（${status}）` };
}

// ── 编排入口（T60）──────────────────────────────────────

/** 一类方案的取数结果：拿到了 / 没有 / 失败 */
export type ModeOutcome<T> =
  | { kind: 'plan'; plan: T }
  | { kind: 'empty' }
  | { kind: 'error'; message: string; retriable: boolean };

/** 一次接驳查询的结果 */
export type ConnectionResult =
  | { kind: 'noCoord' }
  | { kind: 'crossCity'; km: number }
  | {
      kind: 'ok';
      /** 两站直线距离（公里） */
      km: number;
      transit: ModeOutcome<TransitPlan>;
      driving: ModeOutcome<DrivingPlan>;
      flags: ConnectionFlag[];
    };

/** 腾讯原始响应的统一外壳（HTTP 恒 200，业务码在 `status`） */
export interface TencentEnvelope<T> {
  status: number;
  message?: string;
  result?: T;
}

/** 接驳查询可注入的取数接口（真实实现见 adapter） */
export interface ConnectionApi {
  /** 公交路线规划（`price_unit=1`，价格单位为分） */
  transit(from: LatLng, to: LatLng): Promise<TencentEnvelope<TencentTransitResult>>;
  /** 驾车路线规划 */
  driving(from: LatLng, to: LatLng): Promise<TencentEnvelope<{ routes?: TencentDrivingRoute[] }>>;
}

/** 一次接驳查询的输入（一个换乘点） */
export interface ConnectionQuery {
  /** 上一程到达站坐标 */
  from: LatLng | undefined;
  /** 下一程出发站坐标 */
  to: LatLng | undefined;
  /** 上一程到达站码（缓存键） */
  fromCode: string;
  /** 下一程出发站码（缓存键） */
  toCode: string;
  /** 换乘等待（分钟） */
  waitMinutes: number;
  /** 出发时刻 `HH:MM`（夜间加价用） */
  departureTime?: string;
  /** 城市名（计价表兜底用） */
  city?: string;
}

/**
 * 接驳**取数**缓存：键为「出发站码>到达站码」（T60）。
 *
 * ⚠️ 只缓存上游响应，不缓存「判定结果」——接驳耗时与站对无关，但**余量标记**
 * 依赖本次行程的等待、**打车价**依赖出发时刻（夜间加价）。若把整个结果缓存起来，
 * 同一站对在不同行程里会沿用第一次的标记与价格。
 */
export type ConnectionCache = Map<string, Promise<{ transit: TencentEnvelope<TencentTransitResult> | Error; driving: TencentEnvelope<{ routes?: TencentDrivingRoute[] }> | Error }>>;

/** 把一类方案的失败封装成统一的 `ModeOutcome` */
function failure(e: TencentEnvelope<unknown> | Error): ModeOutcome<never> {
  if (e instanceof Error) {
    // 带了明确「是否可重试」判定的错误（如 Worker 未配置 key）按其口径，别一律当网络故障
    const retriable = (e as Error & { retriable?: boolean }).retriable;
    return {
      kind: 'error',
      message: e.message || '接驳查询失败',
      retriable: retriable ?? true,
    };
  }
  const s = classifyTencentStatus(e.status);
  if (s.kind === 'ok') return { kind: 'empty' };
  if (s.kind === 'noResult') return { kind: 'empty' };
  return { kind: 'error', message: s.kindLabel, retriable: s.kind === 'retriable' };
}

/**
 * 加载一个换乘点的接驳方案（D70/D71）。
 *
 * - 两类请求**并行**发出，一侧失败不拖垮另一侧
 * - 公交取耗时最短那条；打车取唯一那条
 * - 结果进 `cache`，同站对只请求一次（含并发去重，缓存存 Promise）
 */
export async function loadConnection(
  q: ConnectionQuery,
  api: ConnectionApi,
  cache: ConnectionCache = new Map(),
): Promise<ConnectionResult> {
  const gate = gateConnection(q.from, q.to);
  if (gate.kind === 'noCoord') return { kind: 'noCoord' };
  if (gate.kind === 'crossCity') return { kind: 'crossCity', km: gate.km };

  const from = q.from!;
  const to = q.to!;
  const key = `${q.fromCode}>${q.toCode}`;

  // 只缓存取数；判定（标记 / 夜间价）每次按本次行程重算
  let fetched = cache.get(key);
  if (!fetched) {
    fetched = (async () => {
      const [transitRes, drivingRes] = await Promise.allSettled([api.transit(from, to), api.driving(from, to)]);
      return {
        transit: transitRes.status === 'rejected' ? (transitRes.reason as Error) : transitRes.value,
        driving: drivingRes.status === 'rejected' ? (drivingRes.reason as Error) : drivingRes.value,
      };
    })();
    cache.set(key, fetched);
  }
  const { transit: transitRaw, driving: drivingRaw } = await fetched;

  const transit: ModeOutcome<TransitPlan> =
    transitRaw instanceof Error
      ? failure(transitRaw)
      : transitRaw.status !== 0
        ? failure(transitRaw)
        : (() => {
            const best = pickFastestTransit(parseTransitRoutes(transitRaw.result));
            return best ? { kind: 'plan' as const, plan: best } : { kind: 'empty' as const };
          })();

  const driving: ModeOutcome<DrivingPlan> =
    drivingRaw instanceof Error
      ? failure(drivingRaw)
      : drivingRaw.status !== 0
        ? failure(drivingRaw)
        : (() => {
            const plan = parseDrivingRoute(drivingRaw.result?.routes?.[0], {
              ...(q.city ? { city: q.city } : {}),
              ...(q.departureTime ? { departureTime: q.departureTime } : {}),
            });
            return plan ? { kind: 'plan' as const, plan } : { kind: 'empty' as const };
          })();

  const flags = connectionFlags({
    waitMinutes: q.waitMinutes,
    transit: transit.kind === 'plan' ? transit.plan : null,
    driving: driving.kind === 'plan' ? driving.plan : null,
    km: gate.km,
  });

  return { kind: 'ok', km: gate.km, transit, driving, flags };
}
