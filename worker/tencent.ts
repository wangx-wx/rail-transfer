/**
 * 腾讯位置服务取数（T57/T58）—— 与 12306 取数层并列，各自独立
 *
 * 同样只做「取回上游原始 JSON」，解析在前端（T1 薄管道）。
 *
 * ⚠️ 两条必须守住的事实：
 *   1. key 只在 Worker 侧注入，**异常信息必须脱敏**——上游 URL 里带 key，
 *      若把 fetch 的异常原样回传，客户端就能拿到 key。
 *   2. 腾讯 HTTP 恒 200，成功与否看响应体 `status`，故这里只判 HTTP 层，
 *      业务码原样透传给前端分类（T58）。
 */

import type { FetchLike } from './source.ts';

/** 腾讯 WebService 基址 */
export const TENCENT_BASE = 'https://apis.map.qq.com';

/** 取数依赖（测试注入 fetch） */
export interface TencentDeps {
  fetchImpl?: FetchLike;
}

/** 取数结果：成功带原始 JSON，失败带**脱敏后**的原因 */
export type TencentResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/** 经纬度参数（调用方已校验过的 `lat,lng`） */
export interface LatLngParam {
  from: string;
  to: string;
}

/**
 * 发一次腾讯 WebService 请求并取回原始 JSON。
 *
 * 失败原因**只用状态码描述**，绝不拼接 URL 或异常原文。
 */
async function request(
  path: string,
  params: Record<string, string>,
  key: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<TencentResult> {
  const url = new URL(path, TENCENT_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);

  try {
    const res = await fetchImpl(url.toString());
    if (res.status !== 200) return { ok: false, error: `接驳上游 HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: '接驳上游响应非 JSON' };
    }
  } catch {
    // ⚠️ 不能回传 e：其 message 常含完整 URL（内含 key）
    return { ok: false, error: '接驳上游网络失败' };
  }
}

/**
 * 公交路线规划。
 *
 * `price_unit=1` 强制价格单位为「分」（T57）——不加此参数时，含火车方案
 * 的价格会以「元」返回，单位在两种量纲间摇摆。
 */
export function fetchTransit(
  { from, to }: LatLngParam,
  key: string,
  deps: TencentDeps = {},
): Promise<TencentResult> {
  return request(
    '/ws/direction/v1/transit/',
    { from, to, price_unit: '1' },
    key,
    deps.fetchImpl,
  );
}

/** 驾车路线规划（打车方案的数据源） */
export function fetchDriving(
  { from, to }: LatLngParam,
  key: string,
  deps: TencentDeps = {},
): Promise<TencentResult> {
  return request('/ws/direction/v1/driving/', { from, to }, key, deps.fetchImpl);
}

/** 经纬度参数校验：`lat,lng`，纬度 ±90、经度 ±180 */
export function isValidLatLng(v: string | null): v is string {
  if (!v) return false;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return false;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
