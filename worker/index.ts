/**
 * Cloudflare Workers 入口 —— 代理层
 *
 * 职责（T1 薄管道）：路由 + CORS + 口令 + 缓存 + 转发。
 * **返回上游原始 JSON**，业务解析全在前端。
 *
 * 端点（T2 语义化，1:1 映射上游接口）：
 *   GET /api/left-ticket  余票（需 cookie）
 *   GET /api/transfer     中转（扇出，hubs 逗号分隔）
 *   GET /api/stopover     经停站
 *   GET /api/price        票价
 *
 * 口令（T15）：读 `env.ACCESS_TOKEN`。**未配置时不做校验**，便于本地开发；
 * 生产部署时在 Worker 环境变量里设上即生效。
 *
 * 缓存（T9/T10）：按整段 URL 为键，显式 `Cache-Control: max-age=300`。
 * ⚠️ 不依赖 Edge TTL 默认值（Free 版最小值 2 小时）。
 */

import { fetchLeftTicket, fetchTransferBatch, fetchStopover, fetchPrice } from './source.ts';
import type { FetchLike } from './source.ts';

/** Worker 环境变量 */
export interface Env {
  /** 访问口令；未设置则不校验（T15） */
  ACCESS_TOKEN?: string;
}

/** 可注入依赖（测试用） */
export interface HandlerDeps {
  fetchImpl?: FetchLike;
  cache?: Cache;
}

const CACHE_TTL = 300; // 秒，D30「余票 3~5 分钟」

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Access-Token',
  'Access-Control-Max-Age': '86400',
};

/** 统一 JSON 响应 */
function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', ...CORS, ...extra },
  });
}

/** 路由处理函数签名 */
type RouteHandler = (q: URLSearchParams, deps: HandlerDeps) => Promise<{ ok?: boolean; [k: string]: unknown }>;

/** 从查询参数取值，缺失时抛错（上游会返回空 data，不如早失败） */
function req(q: URLSearchParams, key: string): string {
  const v = q.get(key);
  if (v === null) throw new Error(`缺少参数 ${key}`);
  return v;
}

/** 路由表：路径 → 处理函数 */
const ROUTES: Record<string, RouteHandler> = {
  '/api/left-ticket': (q, deps) =>
    fetchLeftTicket({ from: req(q, 'from'), to: req(q, 'to'), date: req(q, 'date'), ...deps }),
  '/api/transfer': async (q, deps) => {
    const hubs = (q.get('hubs') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const items = await fetchTransferBatch({
      from: req(q, 'from'),
      to: req(q, 'to'),
      date: req(q, 'date'),
      hubs,
      ...deps,
    });
    return { ok: true, items };
  },
  '/api/stopover': (q, deps) =>
    fetchStopover({
      trainNo: req(q, 'train_no'),
      fromStationNo: req(q, 'from_station_no'),
      toStationNo: req(q, 'to_station_no'),
      date: req(q, 'date'),
      ...deps,
    }),
  '/api/price': (q, deps) =>
    fetchPrice({
      trainNo: req(q, 'train_no'),
      fromStationNo: req(q, 'from_station_no'),
      toStationNo: req(q, 'to_station_no'),
      seatTypes: req(q, 'seat_types'),
      date: req(q, 'date'),
      ...deps,
    }),
};

/** 处理一个请求（导出以便测试直接调用）。 */
export async function handleRequest(
  request: Request,
  env: Env = {},
  deps: HandlerDeps = {},
): Promise<Response> {
  const url = new URL(request.url);

  // 预检
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const handler = ROUTES[url.pathname];
  if (!handler) return json({ ok: false, error: '未知端点' }, 404);
  if (request.method !== 'GET') return json({ ok: false, error: '仅支持 GET' }, 405);

  // 口令（T15/T16）：仅在配置了 ACCESS_TOKEN 时校验
  if (env.ACCESS_TOKEN && request.headers.get('X-Access-Token') !== env.ACCESS_TOKEN) {
    return json({ ok: false, error: '口令错误' }, 401);
  }

  // 缓存（T9/T10）：以整段 URL 为键
  // Workers 运行时 caches.default 可用；Node 下无 caches，静默降级
  const cache = deps.cache ?? (globalThis.caches as { default?: Cache } | undefined)?.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {
      /* 缓存不可用时静默降级 */
    }
  }

  let body: { ok?: boolean; [k: string]: unknown };
  try {
    body = await handler(url.searchParams, deps);
  } catch (e) {
    return json({ ok: false, error: `内部错误: ${e}` }, 500);
  }

  const res = json(body, body.ok === false ? 502 : 200);

  // 只缓存成功响应。
  // ⚠️ 必须用 clone() 分流：`new Response(res.body, res)` 会让两个 Response 共享
  // 同一个 body 流，cache.put 读空后返回的 res 就无 body 可用，抛
  // `TypeError: Body has already been used`（仅在注入了 cache 的环境复现）。
  if (cache && body.ok !== false) {
    try {
      const toCache = res.clone();
      toCache.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
      await cache.put(cacheKey, toCache);
    } catch {
      /* 忽略缓存写入失败 */
    }
  }
  return res;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, {});
  },
};
