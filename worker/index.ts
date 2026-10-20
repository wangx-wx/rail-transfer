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
 *   GET /api/transit      接驳公交（腾讯，T58）
 *   GET /api/driving      接驳打车（腾讯，T58）
 *
 * 口令（T15）：读 `env.ACCESS_TOKEN`。**未配置时不做校验**，便于本地开发；
 * 生产部署时在 Worker 环境变量里设上即生效。
 *
 * 缓存（T9/T10）：按整段 URL 为键，显式 `Cache-Control: max-age=300`。
 * ⚠️ 不依赖 Edge TTL 默认值（Free 版最小值 2 小时）。
 */

import { fetchLeftTicket, fetchTransferBatch, fetchStopover, fetchPrice } from './source.ts';
import { fetchDriving, fetchTransit, isValidLatLng } from './tencent.ts';
import type { FetchLike } from './source.ts';

/** Worker 环境变量 */
export interface Env {
  /** 访问口令；未设置则不校验（T15） */
  ACCESS_TOKEN?: string;
  /** 腾讯位置服务 key（T58）；用 `wrangler secret put` 注入，不得写进 wrangler.toml */
  TENCENT_KEY?: string;
}

/** 不走 Worker 缓存的端点（T58：接驳由前端内存缓存） */
const NO_CACHE_PATHS = new Set(['/api/transit', '/api/driving']);

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
type RouteHandler = (
  q: URLSearchParams,
  deps: HandlerDeps,
  env: Env,
) => Promise<{ ok?: boolean; [k: string]: unknown }>;

/** 从查询参数取值，缺失时抛错（上游会返回空 data，不如早失败） */
function req(q: URLSearchParams, key: string): string {
  const v = q.get(key);
  if (v === null) throw new Error(`缺少参数 ${key}`);
  return v;
}

/** 校验并取经纬度参数，格式不对抛错（上游会返回难懂的业务码，不如早失败） */
function reqLatLng(q: URLSearchParams, key: string): string {
  const v = q.get(key);
  if (!isValidLatLng(v)) throw new Error(`参数 ${key} 需为「纬度,经度」`);
  return v;
}

/** 接驳端点的公共流程：校验 key → 校验坐标 → 转发 */
async function connectionRoute(
  q: URLSearchParams,
  env: Env,
  deps: HandlerDeps,
  fetchUpstream: (p: { from: string; to: string }, key: string, deps: HandlerDeps) => Promise<
    { ok: true; data: unknown } | { ok: false; error: string }
  >,
): Promise<{ ok?: boolean; [k: string]: unknown }> {
  const key = env.TENCENT_KEY;
  if (!key) return { ok: false, error: '接驳服务未配置（缺少 TENCENT_KEY）' };
  const params = { from: reqLatLng(q, 'from'), to: reqLatLng(q, 'to') };
  const r = await fetchUpstream(params, key, deps);
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
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
      hubs: hubs.length ? hubs : [''],
      ...deps,
    });
    return { ok: true, items };
  },
  '/api/transit': (q, deps, env) => connectionRoute(q, env, deps, fetchTransit),
  '/api/driving': (q, deps, env) => connectionRoute(q, env, deps, fetchDriving),
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
  // 接驳端点不缓存（T58）：结果由前端内存缓存，且上游偶尔抖动的时长不该被冻住 5 分钟
  const cache = NO_CACHE_PATHS.has(url.pathname)
    ? undefined
    : (deps.cache ?? (globalThis.caches as { default?: Cache } | undefined)?.default);
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
    body = await handler(url.searchParams, deps, env);
  } catch (e) {
    // 参数类错误是我们自己抛的，属客户端问题 → 400；其余算内部错误
    const msg = e instanceof Error ? e.message : String(e);
    if (/^参数 /.test(msg)) return json({ ok: false, error: msg }, 400);
    return json({ ok: false, error: `内部错误: ${msg}` }, 500);
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
