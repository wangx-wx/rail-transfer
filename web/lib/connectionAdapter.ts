/**
 * 接驳查询的前端胶水（D70/T60）——把纯编排接到 Worker 端点
 *
 * 这里只做三件事：站码 → 坐标、调 `/api/transit` 与 `/api/driving`、
 * 把结果塞进跨查询复用的内存缓存。判定与解析全在 `connection.ts`（纯函数）。
 */

import { codeOfStation, cityOfStation } from './city.ts';
import { loadConnection } from './connection.ts';
import type { ConnectionApi, ConnectionCache, ConnectionResult, TencentEnvelope, LatLng } from './connection.ts';
import type { CoordSource } from './stationCoords.ts';
import type { ApiOpts } from './api.ts';

/** Worker 接驳端点的响应（与既有端点同形：`{ok, data, error}`） */
interface ProxyResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** 坐标 → 腾讯要求的 `lat,lng` 字符串（T57：纬度在前） */
export function latLngParam(p: LatLng): string {
  return `${p.lat},${p.lng}`;
}

/** 用注入的 fetch 造一个接驳取数实现（真实走 Worker） */
export function createConnectionApi(
  opts: ApiOpts = {},
): ConnectionApi {
  const base = opts.base ?? '';
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const call = async <T,>(path: string, from: LatLng, to: LatLng): Promise<TencentEnvelope<T>> => {
    const url = new URL(base + path, globalThis.location?.href ?? 'http://localhost/');
    url.searchParams.set('from', latLngParam(from));
    url.searchParams.set('to', latLngParam(to));
    const headers: Record<string, string> = {};
    if (opts.token) headers['X-Access-Token'] = opts.token;
    const res = await fetchImpl(url.toString(), { headers });
    const body = (await res.json()) as ProxyResponse<TencentEnvelope<T>>;
    // Worker 层的失败（未配置 key / 上游网络失败）用非 0 业务码表达，
    // 让上层沿用同一套分类；`classifyTencentStatus` 会把它当不可重试错误。
    if (!body.ok) throw new Error(body.error ?? '接驳查询失败');
    return body.data ?? { status: -1 };
  };

  return {
    transit: (from, to) => call('/api/transit', from, to),
    driving: (from, to) => call('/api/driving', from, to),
  };
}

/** 一个换乘点的查询输入（站码层面） */
export interface ConnectionRequest {
  /** 上一程到达站码 */
  fromCode: string;
  /** 下一程出发站码 */
  toCode: string;
  waitMinutes: number;
  /** 出发时刻 `HH:MM`（夜间加价用） */
  departureTime?: string;
}

/**
 * 查一个换乘点的接驳（站码 → 坐标 → 编排）。
 *
 * 站码无法反查坐标时不发请求，直接返回 `noCoord`（D74 的禁用分支）。
 */
export async function loadConnectionByCode(
  req: ConnectionRequest,
  deps: { coords: CoordSource; api: ConnectionApi; cache: ConnectionCache },
): Promise<ConnectionResult> {
  const [from, to] = await Promise.all([deps.coords.of(req.fromCode), deps.coords.of(req.toCode)]);
  if (!from || !to) return { kind: 'noCoord' };
  return loadConnection(
    {
      from,
      to,
      fromCode: req.fromCode,
      toCode: req.toCode,
      waitMinutes: req.waitMinutes,
      ...(req.departureTime ? { departureTime: req.departureTime } : {}),
      // 计价表按城市兜底（D76）；两个站在同城，用出发站城市即可
      city: cityOfStation(req.toCode),
    },
    deps.api,
    deps.cache,
  );
}

/** 站名 → 站码（官方通路用；T62 反查失败返回 null） */
export function stationCodeOf(name: string): string | null {
  return codeOfStation(name)?.code ?? null;
}
