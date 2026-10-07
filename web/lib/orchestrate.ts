/**
 * 查询编排 —— 分段流式（D37）
 *
 * 前端分多次请求，每段只查一部分枢纽，结果到达即回调显示。
 * 每段是独立的 Worker invocation，各有 50 子请求配额，自然分摊。
 *
 * 流程（产品方案第四节）：
 *   段 A：直达 + 官方中转基线（取候选枢纽种子）
 *   段 B..：按 HUBS_PER_SEGMENT 切分枢纽，逐段查询
 *
 * 失败处理（T13/T14）：某段真错误 → 该段回调 error，其余段照常；空 data 不算错误。
 */

import { HUBS_PER_SEGMENT, FALLBACK_HUBS } from '../../shared/constants.ts';
import type {
  FetchResult,
  LeftTicketData,
  SegmentItem,
  TransferData,
  UpstreamEnvelope,
} from '../../shared/types.ts';
import { extractHubCodes } from './parse.ts';
import type { TransferResponse } from './api.ts';

/** 编排所需的最小 API 接口（便于测试注入） */
export interface QueryApi {
  leftTicket(p: { from: string; to: string; date: string }): Promise<FetchResult<UpstreamEnvelope<LeftTicketData>>>;
  transfer(p: { from: string; to: string; date: string; hubs: string[] }): Promise<TransferResponse>;
}

/** 一次查询的参数 */
export interface RunQueryParams {
  from: string;
  to: string;
  date: string;
  /** 额外排除的站码（城市内其他站） */
  exclude?: string[];
}

/** 一段的查询结果 */
export interface SegmentResult {
  index: number;
  total: number;
  hubs: string[];
  items: Array<SegmentItem<UpstreamEnvelope<TransferData>>>;
  error: string | null;
}

export interface BaselineResult {
  ok: boolean;
  items: Array<SegmentItem<UpstreamEnvelope<TransferData>>>;
  error?: string;
}

export interface QueryResult {
  hubs: string[];
  baseline: BaselineResult;
  segments: SegmentResult[];
}

/** 回调集合 */
export interface RunQueryHooks {
  onDirect?: (r: FetchResult<UpstreamEnvelope<LeftTicketData>>) => void;
  onBaseline?: (r: BaselineResult) => void;
  onSegment?: (r: SegmentResult) => void;
  onDone?: (r: QueryResult) => void;
}

/** 区分整次请求失败与单个枢纽失败，成功的空 data 不算错误。 */
function transferError(r: TransferResponse): string | null {
  if (!r.ok) return r.error ?? '中转查询失败';
  const errors = (r.items ?? [])
    .filter((item) => !item.ok)
    .map((item) => `${item.key || '官方基线'}：${item.error ?? '查询失败'}`);
  return errors.length ? errors.join('；') : null;
}

/** 把枢纽切成每段 N 个。 */
export function chunkHubs(hubs: string[], size: number = HUBS_PER_SEGMENT): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < hubs.length; i += size) out.push(hubs.slice(i, i + size));
  return out;
}

/**
 * 汇总候选枢纽（D10：官方种子 + 内置兜底），剔除出发/到达站自身。
 */
export function buildHubList(
  seed: string[],
  exclude: string[] = [],
  fallback: readonly string[] = FALLBACK_HUBS,
): string[] {
  const ex = new Set(exclude.filter(Boolean));
  return [...new Set([...seed, ...fallback])].filter((c) => !ex.has(c));
}

/** 执行一次分段流式查询。 */
export async function runQuery(
  p: RunQueryParams,
  api: QueryApi,
  hooks: RunQueryHooks = {},
): Promise<QueryResult> {
  const { from, to, date } = p;

  // ── 段 A：直达 ──────────────────────────────────────
  let direct: FetchResult<UpstreamEnvelope<LeftTicketData>>;
  try {
    direct = await api.leftTicket({ from, to, date });
  } catch (e) {
    direct = { ok: false, error: String(e) };
  }
  hooks.onDirect?.(direct);

  // ── 段 A：官方基线（拿候选枢纽种子）─────────────────
  let baseline: BaselineResult;
  try {
    const r = await api.transfer({ from, to, date, hubs: [] });
    const error = transferError(r);
    baseline = { ok: !error, items: r.items ?? [], ...(error ? { error } : {}) };
  } catch (e) {
    baseline = { ok: false, items: [], error: String(e) };
  }
  hooks.onBaseline?.(baseline);

  // 从基线的原始 JSON 里抽官方候选枢纽
  const seed: string[] = [];
  for (const item of baseline.items) {
    if (item.ok && item.data) {
      seed.push(...extractHubCodes(item.data.data?.middleStationList));
    }
  }

  // ── 段 B..：按段枚举枢纽 ────────────────────────────
  const hubs = buildHubList(seed, [from, to, ...(p.exclude ?? [])]);
  const segments = chunkHubs(hubs);
  const results: SegmentResult[] = [];

  for (let i = 0; i < segments.length; i++) {
    const chunk = segments[i] ?? [];
    let res: SegmentResult;
    try {
      const r = await api.transfer({ from, to, date, hubs: chunk });
      res = { index: i, total: segments.length, hubs: chunk, items: r.items ?? [], error: transferError(r) };
    } catch (e) {
      res = { index: i, total: segments.length, hubs: chunk, items: [], error: String(e) };
    }
    results.push(res);
    hooks.onSegment?.(res);
  }

  const done = { hubs, baseline, segments: results };
  hooks.onDone?.(done);
  return done;
}
