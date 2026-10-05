/**
 * 前端 → Worker 的 API 封装
 *
 * 全部走相对路径 `/api/...`（T19）：本地由静态服务转发，线上由 Worker 处理，
 * 前端代码无需感知环境差异。口令随请求头 `X-Access-Token` 发送（T16）。
 */

import type {
  FetchResult,
  LeftTicketData,
  PriceData,
  SegmentItem,
  TransferData,
  UpstreamEnvelope,
} from '../../shared/types.ts';

/** API 调用选项 */
export interface ApiOpts {
  /** 访问口令（T16） */
  token?: string;
  /** API 基址；空 = 同源（本地开发） */
  base?: string;
  /** 可注入 fetch（测试用） */
  fetchImpl?: typeof globalThis.fetch;
}

/** 发起一次 GET，返回解析后的 JSON */
async function get<T>(path: string, params: Record<string, string>, opts: ApiOpts = {}): Promise<T> {
  const base = opts.base ?? '';
  const f = opts.fetchImpl ?? globalThis.fetch;
  const url = new URL(base + path, globalThis.location?.href ?? 'http://localhost/');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (opts.token) headers['X-Access-Token'] = opts.token;
  const res = await f(url.toString(), { headers });
  return res.json() as Promise<T>;
}

/** 直达查询参数 */
export interface LeftTicketQuery {
  from: string;
  to: string;
  date: string;
}

/** 查询直达（余票）。 */
export function leftTicket(
  p: LeftTicketQuery,
  opts?: ApiOpts,
): Promise<FetchResult<UpstreamEnvelope<LeftTicketData>>> {
  return get('/api/left-ticket', { from: p.from, to: p.to, date: p.date }, opts);
}

/** 中转查询参数 */
export interface TransferQuery {
  from: string;
  to: string;
  date: string;
  /** 枢纽站码列表；空数组 = 官方默认 Top-N 基线 */
  hubs: string[];
}

/** 中转扇出结果 */
export interface TransferResponse {
  ok: boolean;
  items: Array<SegmentItem<UpstreamEnvelope<TransferData>>>;
}

/** 查询中转（扇出）。hubs 为空数组时 = 官方默认 Top-N 基线。 */
export function transfer(p: TransferQuery, opts?: ApiOpts): Promise<TransferResponse> {
  return get('/api/transfer', { from: p.from, to: p.to, date: p.date, hubs: p.hubs.join(',') }, opts);
}

/** 经停站查询参数 */
export interface StopoverQuery {
  trainNo: string;
  fromStationNo: string;
  toStationNo: string;
  date: string;
}

/** 经停站 */
export function stopover(p: StopoverQuery, opts?: ApiOpts): Promise<FetchResult<UpstreamEnvelope<unknown>>> {
  return get(
    '/api/stopover',
    { train_no: p.trainNo, from_station_no: p.fromStationNo, to_station_no: p.toStationNo, date: p.date },
    opts,
  );
}

/** 票价查询参数 */
export interface PriceQuery {
  trainNo: string;
  fromStationNo: string;
  toStationNo: string;
  seatTypes: string;
  date: string;
}

/** 票价 */
export function price(p: PriceQuery, opts?: ApiOpts): Promise<FetchResult<UpstreamEnvelope<PriceData>>> {
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
