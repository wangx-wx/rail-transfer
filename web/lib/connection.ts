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

// 解析 / 标记 / 编排按职责拆到同目录的其余文件，此处统一再导出，调用方仍只 import './connection.ts'
export { parseTransitRoutes, pickFastestTransit } from './transitParse.ts';
export type {
  TransitPlan,
  TransitLine,
  TencentTransitLine,
  TencentTransitResult,
  TencentTransitRoute,
  TencentTransitStep,
  TencentTransitTransit,
  TencentTransitWalking,
} from './transitParse.ts';
export { parseDrivingRoute } from './taxiPlan.ts';
export type { DrivingPlan, DrivingParseOptions, TencentDrivingRoute, TaxiFareSource } from './taxiPlan.ts';
export { classifyTencentStatus, connectionFlags } from './connectionFlags.ts';
export type { ConnectionFlag, ConnectionFlagInput, ConnectionFlagKind, TencentFailureKind, TencentStatus } from './connectionFlags.ts';
export { loadConnection } from './connectionOrchestrate.ts';
export type { ConnectionApi, ConnectionCache, ConnectionQuery, ConnectionResult, ModeOutcome, TencentEnvelope } from './connectionOrchestrate.ts';
