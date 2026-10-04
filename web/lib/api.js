/**
 * 前端 → Worker 的 API 封装
 *
 * 全部走相对路径 `/api/...`（T19）：本地由静态服务转发，线上由 Worker 处理，
 * 前端代码无需感知环境差异。口令随请求头 `X-Access-Token` 发送（T16）。
 */

/** @typedef {{token?: string, base?: string, fetchImpl?: Function}} ApiOpts */

/**
 * 发起一次 GET。
 * @param {string} path
 * @param {Record<string,string>} params
 * @param {ApiOpts} opts
 */
async function get(path, params, opts = {}) {
  const base = opts.base ?? '';
  const f = opts.fetchImpl ?? globalThis.fetch;
  const url = new URL(base + path, globalThis.location?.href ?? 'http://localhost/');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers = {};
  if (opts.token) headers['X-Access-Token'] = opts.token;
  const res = await f(url.toString(), { headers });
  return res.json();
}

/**
 * 查询直达（余票）。
 * @param {{from:string, to:string, date:string}} p
 * @param {ApiOpts} opts
 */
export function leftTicket(p, opts) {
  return get('/api/left-ticket', { from: p.from, to: p.to, date: p.date }, opts);
}

/**
 * 查询中转（扇出）。hubs 为空数组时 = 官方默认 Top-N 基线。
 * @param {{from:string, to:string, date:string, hubs:string[]}} p
 * @param {ApiOpts} opts
 */
export function transfer(p, opts) {
  return get('/api/transfer', { from: p.from, to: p.to, date: p.date, hubs: p.hubs.join(',') }, opts);
}

/** 经停站 */
export function stopover(p, opts) {
  return get(
    '/api/stopover',
    { train_no: p.trainNo, from_station_no: p.fromStationNo, to_station_no: p.toStationNo, date: p.date },
    opts,
  );
}

/** 票价 */
export function price(p, opts) {
  return get(
    '/api/price',
    {
      train_no: p.trainNo,
      from_station_no: p.fromStationNo,
      to_station_no: p.toStationNo,
      seat_types: p.seatTypes,
      date: p.date,
    },
    opts,
  );
}
