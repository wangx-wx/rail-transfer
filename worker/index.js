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
 * 口令（T15）：读 `env.ACCESS_TOKEN`。**未配置时不做校验**，便于本地开发
 * （满足「不设环境变量」的根本要求）；生产部署时在 Worker 环境变量里设上即生效。
 *
 * 缓存（T9/T10）：按整段 URL 为键，显式 `Cache-Control: max-age=300`。
 * ⚠️ 不依赖 Edge TTL 默认值（Free 版最小值 2 小时）。
 */

import { fetchLeftTicket, fetchTransferBatch, fetchStopover, fetchPrice } from './source.js';

const CACHE_TTL = 300; // 秒，D30「余票 3~5 分钟」

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Access-Token',
  'Access-Control-Max-Age': '86400',
};

/** 统一 JSON 响应 */
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', ...CORS, ...extra },
  });
}

/**
 * 路由表：路径 → 处理函数（接收 URLSearchParams，返回 body 对象）
 * @type {Record<string, (q: URLSearchParams, deps: any) => Promise<any>>}
 */
const ROUTES = {
  '/api/left-ticket': async (q, deps) => {
    const r = await fetchLeftTicket({
      from: q.get('from'),
      to: q.get('to'),
      date: q.get('date'),
      ...deps,
    });
    return r;
  },
  '/api/transfer': async (q, deps) => {
    const hubs = (q.get('hubs') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const items = await fetchTransferBatch({
      from: q.get('from'),
      to: q.get('to'),
      date: q.get('date'),
      hubs,
      ...deps,
    });
    return { ok: true, items };
  },
  '/api/stopover': async (q, deps) =>
    fetchStopover({
      trainNo: q.get('train_no'),
      fromStationNo: q.get('from_station_no'),
      toStationNo: q.get('to_station_no'),
      date: q.get('date'),
      ...deps,
    }),
  '/api/price': async (q, deps) =>
    fetchPrice({
      trainNo: q.get('train_no'),
      fromStationNo: q.get('from_station_no'),
      toStationNo: q.get('to_station_no'),
      seatTypes: q.get('seat_types'),
      date: q.get('date'),
      ...deps,
    }),
};

/**
 * 处理一个请求。
 *
 * @param {Request} request
 * @param {{ACCESS_TOKEN?: string}} env
 * @param {{fetchImpl?: Function, cache?: any}} [deps] 可注入依赖（测试用）
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env = {}, deps = {}) {
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
  const cache = deps.cache ?? globalThis.caches?.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch {
      /* 缓存不可用时静默降级 */
    }
  }

  let body;
  try {
    body = await handler(url.searchParams, deps);
  } catch (e) {
    return json({ ok: false, error: `内部错误: ${e}` }, 500);
  }

  const res = json(body, body.ok === false ? 502 : 200);

  // 只缓存成功响应
  if (cache && body.ok !== false) {
    try {
      const toCache = new Response(res.body, res);
      toCache.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
      await cache.put(cacheKey, toCache);
    } catch {
      /* 忽略缓存写入失败 */
    }
  }
  return res;
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, {});
  },
};
