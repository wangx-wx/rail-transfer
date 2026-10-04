/**
 * 取数层 —— 与代理层分离（D3），环境无关
 *
 * 只用全局 `fetch` 与 `headers.getSetCookie()`，这两个在 Node 24 与
 * Cloudflare Workers 都原生可用，所以同一份代码本地与线上通用。
 *
 * 职责边界（T1 薄管道）：本层把上游响应的**原始 JSON** 取回来，
 * **不做业务解析**（解析在前端）。只负责区分「真错误」与「正常空结果」（T14）。
 */

import { KYFW, UA, COL } from '../shared/constants.js';

/**
 * 提取 Set-Cookie。
 * 优先标准 `getSetCookie()`，回退合并头（部分运行时只有 `get`）。
 * @param {Response} res
 * @returns {string[]}
 */
export function extractCookies(res) {
  const h = res.headers;
  if (typeof h?.getSetCookie === 'function') {
    try {
      const list = h.getSetCookie();
      if (list && list.length) return list;
    } catch {
      /* 回退到合并头 */
    }
  }
  const merged = h?.get?.('set-cookie');
  return merged ? [merged] : [];
}

/**
 * 判定上游响应是否为「真错误」（T14）。
 *
 * 真错误：网络失败 / HTTP 非 200 / 被 WAF 拦成 302→error.html / 非 JSON。
 * **空 data 不算错误**——5.11：`status` 永远为 true，空 data 只表示「无方案」。
 *
 * @param {Response|{error:string}} res
 * @param {string} text 响应体原文
 * @returns {{ok: boolean, error?: string, retriable?: boolean}}
 */
export function classify(res, text) {
  if (res && res.error) return { ok: false, error: `网络失败: ${res.error}`, retriable: true };

  const location = res.headers?.get?.('location') || '';
  if (location.includes('error.html')) {
    return { ok: false, error: '被拦截：302 → error.html（WAF 或越界）', retriable: false };
  }
  if (res.status !== 200) {
    return { ok: false, error: `HTTP ${res.status}`, retriable: res.status >= 500 };
  }
  try {
    JSON.parse(text);
    return { ok: true };
  } catch {
    return { ok: false, error: '响应非 JSON', retriable: false };
  }
}

/**
 * 发一次上游请求，返回 `{res, text}`。
 * 网络异常不抛出，而是包成 `{error}`，交由 `classify` 统一处理。
 */
async function request(path, params, { cookie = '', fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(path, KYFW);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { 'User-Agent': UA, Referer: `${KYFW}/otn/leftTicket/init` };
  if (cookie) headers.Cookie = cookie;
  try {
    const res = await fetchImpl(url.toString(), { headers, redirect: 'manual' });
    const text = await res.text();
    return { res, text };
  } catch (e) {
    return { res: { error: String(e) }, text: '' };
  }
}

/**
 * 取余票接口所需的 cookie（T8：每次现取现用，不缓存）。
 * 必须先访问 init，否则 `/otn/leftTicket/*` 会被 WAF 拦成 302（产品方案 5.3）。
 * @returns {Promise<string>} `k=v; k=v` 形式的 Cookie 头；失败返回空串
 */
export async function initCookie({ fetchImpl = globalThis.fetch } = {}) {
  const { res, text } = await request('/otn/leftTicket/init', {}, { fetchImpl });
  const c = classify(res, text);
  if (!c.ok) return '';
  return extractCookies(res)
    .map((s) => s.split(';')[0])
    .join('; ');
}

/**
 * 查询余票（直达）。
 *
 * 城市粒度（D6）：传城市代表站码即可，**服务端自动展开全城**（产品方案 5.2）。
 *
 * @param {{from:string, to:string, date:string, fetchImpl?:Function}} opts
 *        date 格式 'YYYY-MM-DD'
 * @returns {Promise<{ok:boolean, data?:any, error?:string}>} data 为上游原始 JSON
 */
export async function fetchLeftTicket({ from, to, date, fetchImpl = globalThis.fetch }) {
  const cookie = await initCookie({ fetchImpl });
  const { res, text } = await request(
    '/otn/leftTicket/queryG',
    {
      'leftTicketDTO.train_date': date,
      'leftTicketDTO.from_station': from,
      'leftTicketDTO.to_station': to,
      purpose_codes: 'ADULT',
    },
    { cookie, fetchImpl },
  );
  const c = classify(res, text);
  if (!c.ok) return { ok: false, error: c.error };
  return { ok: true, data: JSON.parse(text) };
}

/**
 * 查询单个枢纽的中转方案。
 *
 * ⚠️ 中转接口**不做城市展开**（产品方案 5.2），必须对城市内每个站各查一次。
 * ⚠️ `middle_station` 传空 = 官方默认 Top-N；传枢纽码 = 强制枚举该枢纽（核心价值）。
 *
 * @param {{from:string, to:string, date:string, hub:string, fetchImpl?:Function}} opts
 * @returns {Promise<{ok:boolean, data?:any, error?:string}>}
 */
export async function fetchTransfer({ from, to, date, hub = '', fetchImpl = globalThis.fetch }) {
  const { res, text } = await request(
    '/lcquery/queryG',
    {
      train_date: date,
      from_station_telecode: from,
      to_station_telecode: to,
      middle_station: hub,
      result_index: '0',
      can_query: 'Y',
      isShowWZ: 'N',
      purpose_codes: '00',
      channel: 'E',
    },
    { fetchImpl },
  );
  const c = classify(res, text);
  if (!c.ok) return { ok: false, error: c.error };
  return { ok: true, data: JSON.parse(text) };
}

/**
 * 批量查询多个枢纽（供 `/api/transfer` 扇出端点使用）。
 * **段内串行、不加 sleep**（T12）。单项失败不影响其余（T13）。
 *
 * @param {{from:string, to:string, date:string, hubs:string[], fetchImpl?:Function}} opts
 * @returns {Promise<Array<{key:string, ok:boolean, data?:any, error?:string}>>}
 */
export async function fetchTransferBatch({ from, to, date, hubs, fetchImpl = globalThis.fetch }) {
  const out = [];
  for (const hub of hubs) {
    const r = await fetchTransfer({ from, to, date, hub, fetchImpl });
    out.push({ key: hub, ...r });
  }
  return out;
}

/**
 * 查询经停站序列（买短乘长 D24 用；产品方案 5.7）。
 * @param {{trainNo:string, fromStationNo:string, toStationNo:string, date:string, fetchImpl?:Function}} opts
 */
export async function fetchStopover({ trainNo, fromStationNo, toStationNo, date, fetchImpl = globalThis.fetch }) {
  const { res, text } = await request(
    '/otn/czxx/queryByTrainNo',
    {
      train_no: trainNo,
      from_station_telecode: fromStationNo,
      to_station_telecode: toStationNo,
      depart_date: date,
    },
    { fetchImpl },
  );
  const c = classify(res, text);
  if (!c.ok) return { ok: false, error: c.error };
  return { ok: true, data: JSON.parse(text) };
}

/**
 * 查询票价（D20/D21：直达展示参考价，中转只查第一条）。
 * @param {{trainNo:string, fromStationNo:string, toStationNo:string, seatTypes:string, date:string, fetchImpl?:Function}} opts
 */
export async function fetchPrice({ trainNo, fromStationNo, toStationNo, seatTypes, date, fetchImpl = globalThis.fetch }) {
  const { res, text } = await request(
    '/otn/leftTicket/queryTicketPrice',
    {
      train_no: trainNo,
      from_station_no: fromStationNo,
      to_station_no: toStationNo,
      seat_types: seatTypes,
      train_date: date,
    },
    { fetchImpl },
  );
  const c = classify(res, text);
  if (!c.ok) return { ok: false, error: c.error };
  return { ok: true, data: JSON.parse(text) };
}

export { COL };
