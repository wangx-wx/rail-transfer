/**
 * 取数层 —— 与代理层分离（D3），环境无关
 *
 * 只用全局 `fetch` 与 `headers.getSetCookie()`，这两个在 Node 24 与
 * Cloudflare Workers 都原生可用，所以同一份代码本地与线上通用。
 *
 * 职责边界（T1 薄管道）：本层把上游响应的**原始 JSON** 取回来，
 * **不做业务解析**（解析在前端）。只负责区分「真错误」与「正常空结果」（T14）。
 */

import { KYFW, UA, COL } from '../shared/constants.ts';
import type { FetchResult, UpstreamEnvelope } from '../shared/types.ts';

/** 可注入的 fetch（测试用 mock；生产用全局 fetch） */
export type FetchLike = typeof globalThis.fetch;

/** 取数层可注入依赖 */
export interface SourceDeps {
  fetchImpl?: FetchLike;
}

/** 上游请求的返回：正常拿到 Response，异常包成 `{error}` */
type RawResponse = Response | { error: string };

/** classify 的判定结果 */
export interface ClassifyResult {
  ok: boolean;
  error?: string;
  /** 是否可重试（5xx / 网络失败为 true） */
  retriable?: boolean;
}

/**
 * 提取 Set-Cookie。
 * 优先标准 `getSetCookie()`，回退合并头（部分运行时只有 `get`）。
 */
export function extractCookies(res: Response): string[] {
  const h = res.headers;
  if (typeof h.getSetCookie === 'function') {
    try {
      const list = h.getSetCookie();
      if (list && list.length) return list;
    } catch {
      /* 回退到合并头 */
    }
  }
  const merged = h.get('set-cookie');
  return merged ? [merged] : [];
}

/**
 * 判定上游响应是否为「真错误」（T14）。
 *
 * 真错误：网络失败 / HTTP 非 200 / 被 WAF 拦成 302→error.html / 非 JSON。
 * **空 data 不算错误**——5.11：`status` 永远为 true，空 data 只表示「无方案」。
 *
 * @param res 上游响应（或包装过的网络错误）
 * @param text 响应体原文
 */
export function classify(res: RawResponse, text: string): ClassifyResult {
  if ('error' in res) return { ok: false, error: `网络失败: ${res.error}`, retriable: true };

  const location = res.headers.get('location') ?? '';
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
async function request(
  path: string,
  params: Record<string, string>,
  { cookie = '', fetchImpl = globalThis.fetch }: SourceDeps & { cookie?: string } = {},
): Promise<{ res: RawResponse; text: string }> {
  const url = new URL(path, KYFW);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: `${KYFW}/otn/leftTicket/init` };
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
 *
 * 必须先访问 init，否则 `/otn/leftTicket/*` 会被 WAF 拦成 302（产品方案 5.3）。
 *
 * ⚠️ init 返回的是 HTML 页面（text/html），**不是 JSON**，不能用 `classify`
 * （它会判「非 JSON」为错误而丢弃 cookie）。见技术方案 §5.2。
 *
 * @returns `k=v; k=v` 形式的 Cookie 头；失败返回空串
 */
export async function initCookie(deps: SourceDeps = {}): Promise<string> {
  const { res } = await request('/otn/leftTicket/init', {}, deps);
  if ('error' in res) return '';
  if (res.status !== 200) return '';
  if ((res.headers.get('location') ?? '').includes('error.html')) return '';
  return extractCookies(res)
    .map((s) => s.split(';')[0])
    .join('; ');
}

/** 查询余票（直达）的参数 */
export interface LeftTicketParams extends SourceDeps {
  from: string;
  to: string;
  /** 'YYYY-MM-DD' */
  date: string;
}

/**
 * 查询余票（直达）。
 *
 * 城市粒度（D6）：传城市代表站码即可，**服务端自动展开全城**（产品方案 5.2）。
 */
export async function fetchLeftTicket({
  from,
  to,
  date,
  fetchImpl = globalThis.fetch,
}: LeftTicketParams): Promise<FetchResult<UpstreamEnvelope<unknown>>> {
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
  if (!c.ok) return { ok: false, error: c.error ?? '未知错误' };
  return { ok: true, data: JSON.parse(text) };
}

/** 查询单个枢纽中转方案的参数 */
export interface TransferParams extends SourceDeps {
  from: string;
  to: string;
  date: string;
  /** 枢纽站码；空串 = 官方默认 Top-N */
  hub?: string;
}

/**
 * 查询单个枢纽的中转方案。
 *
 * ⚠️ 中转接口**不做城市展开**（产品方案 5.2），必须对城市内每个站各查一次。
 * ⚠️ `middle_station` 传空 = 官方默认 Top-N；传枢纽码 = 强制枚举该枢纽（核心价值）。
 */
export async function fetchTransfer({
  from,
  to,
  date,
  hub = '',
  fetchImpl = globalThis.fetch,
}: TransferParams): Promise<FetchResult<UpstreamEnvelope<unknown>>> {
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
  if (!c.ok) return { ok: false, error: c.error ?? '未知错误' };
  return { ok: true, data: JSON.parse(text) };
}

/** 批量查询多个枢纽的参数 */
export interface TransferBatchParams extends SourceDeps {
  from: string;
  to: string;
  date: string;
  hubs: string[];
}

/**
 * 批量查询多个枢纽（供 `/api/transfer` 扇出端点使用）。
 * **段内串行、不加 sleep**（T12）。单项失败不影响其余（T13）。
 */
export async function fetchTransferBatch({
  from,
  to,
  date,
  hubs,
  fetchImpl = globalThis.fetch,
}: TransferBatchParams): Promise<Array<{ key: string; ok: boolean; data?: unknown; error?: string }>> {
  const out: Array<{ key: string; ok: boolean; data?: unknown; error?: string }> = [];
  for (const hub of hubs) {
    const r = await fetchTransfer({ from, to, date, hub, fetchImpl });
    out.push(r.ok ? { key: hub, ok: true, data: r.data } : { key: hub, ok: false, error: r.error });
  }
  return out;
}

/** 查询经停站的参数 */
export interface StopoverParams extends SourceDeps {
  trainNo: string;
  fromStationNo: string;
  toStationNo: string;
  date: string;
}

/** 查询经停站序列（买短乘长 D24 用；产品方案 5.7）。 */
export async function fetchStopover({
  trainNo,
  fromStationNo,
  toStationNo,
  date,
  fetchImpl = globalThis.fetch,
}: StopoverParams): Promise<FetchResult<UpstreamEnvelope<unknown>>> {
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
  if (!c.ok) return { ok: false, error: c.error ?? '未知错误' };
  return { ok: true, data: JSON.parse(text) };
}

/** 查询票价的参数 */
export interface PriceParams extends SourceDeps {
  trainNo: string;
  fromStationNo: string;
  toStationNo: string;
  seatTypes: string;
  date: string;
}

/** 查询票价（D20/D21：直达展示参考价，中转只查第一条）。 */
export async function fetchPrice({
  trainNo,
  fromStationNo,
  toStationNo,
  seatTypes,
  date,
  fetchImpl = globalThis.fetch,
}: PriceParams): Promise<FetchResult<UpstreamEnvelope<unknown>>> {
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
  if (!c.ok) return { ok: false, error: c.error ?? '未知错误' };
  return { ok: true, data: JSON.parse(text) };
}

export { COL };
