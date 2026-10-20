/**
 * 同城异站接驳：接驳标记与上游状态码分类（D73/T58）
 *
 * 从 `connection.ts` 拆出（保持单文件 ≤500 行）。判定口径见 D69~D76 / T57~T62。
 */

import { RISK_WAIT_THRESHOLD } from '../../shared/constants.ts';
import { CROSS_CITY_KM } from './connection.ts';
import type { TransitPlan } from './transitParse.ts';
import type { DrivingPlan } from './taxiPlan.ts';

// ── 接驳标记（D73）────────────────────────────────────────

/** 接驳标记类别（决定 Tag 颜色） */
export type ConnectionFlagKind = 'bad' | 'risky' | 'info';

/** 一条接驳标记 */
export interface ConnectionFlag {
  label: string;
  kind: ConnectionFlagKind;
}

/** 标记判定输入 */
export interface ConnectionFlagInput {
  /** 换乘等待（分钟） */
  waitMinutes: number;
  /** 公交方案；null = 未查到 */
  transit: TransitPlan | null;
  /** 打车方案；null = 未查到 */
  driving: DrivingPlan | null;
  /** 两站直线距离（公里） */
  km: number;
}

/** 公交状态码 → 标记文案（300 正常不标） */
const RUNNING_STATUS_LABEL: Record<number, string> = {
  301: '可能错过末班',
  302: '首班未发',
  303: '停运',
};

/** 状态码严重度（越大越严重），用于多条线路时取最严重一个 */
const RUNNING_STATUS_SEVERITY: Record<number, number> = { 301: 1, 302: 2, 303: 3 };

/**
 * 接驳与换乘等待的匹配标记（D73）。
 *
 * 三档沿用既有 `RISK_WAIT_THRESHOLD`（20 分），不新增常量；只标记，
 * **不删方案、不改排序**（延续 D12）。跨城时短路——那时本就没有市内方案可判。
 */
export function connectionFlags(input: ConnectionFlagInput): ConnectionFlag[] {
  if (input.km > CROSS_CITY_KM) return [{ label: '跨城接驳', kind: 'info' }];

  const { waitMinutes, transit, driving } = input;
  const durations = [transit?.durationMinutes, driving?.durationMinutes].filter(
    (m): m is number => m != null,
  );
  if (!durations.length) return [];

  const fastest = Math.min(...durations);
  const margin = waitMinutes - fastest;

  const insufficient = margin < 0;
  // 公交赶不上但打车赶得上——此时「紧张」没有信息量，由本标记取代
  const needTaxi =
    !insufficient &&
    transit != null &&
    driving != null &&
    waitMinutes - transit.durationMinutes < 0 &&
    margin >= 0;

  const flags: ConnectionFlag[] = [];
  if (insufficient) flags.push({ label: '接驳时间不足', kind: 'bad' });
  else if (needTaxi) flags.push({ label: '需打车', kind: 'risky' });
  else if (margin < RISK_WAIT_THRESHOLD) flags.push({ label: '接驳紧张', kind: 'risky' });

  if (transit && !transit.hasSubway) flags.push({ label: '无地铁', kind: 'info' });

  const status = worstRunningStatus(transit);
  if (status != null) flags.push({ label: RUNNING_STATUS_LABEL[status]!, kind: 'risky' });

  return flags;
}

/** 公交线路里最严重的运行状态码（301/302/303）；正常或无状态返回 null */
function worstRunningStatus(plan: TransitPlan | null): number | null {
  let worst: number | null = null;
  let severity = 0;
  for (const line of plan?.lines ?? []) {
    const s = line.runningStatus;
    if (s == null) continue;
    const sev = RUNNING_STATUS_SEVERITY[s] ?? 0;
    if (sev > severity) {
      severity = sev;
      worst = s;
    }
  }
  return worst;
}

// ── 腾讯业务状态码分类（T58）──────────────────────────────

/**
 * 上游失败类别。
 *
 * `retriable` = 配额或瞬时后端错误，重试可能成功；其余重试无意义，
 * 直接展示原因（D74 要求「不提供重试」）。
 */
export type TencentFailureKind =
  | 'retriable'
  | 'unsupportedCity'
  | 'noResult'
  | 'config'
  | 'error';

/** 状态码分类结果 */
export type TencentStatus =
  | { kind: 'ok' }
  | { kind: 'retriable' | 'unsupportedCity' | 'noResult' | 'config' | 'error'; kindLabel: string };

/** 配额与瞬时错误：重试可能成功 */
const RETRIABLE_CODES = new Set([120, 121, 500, 510, 520, 530, 531, 600]);
/** key 未授权 / 无效：属于配置问题，重试无意义 */
const CONFIG_CODES = new Set([110, 111, 112, 113, 190, 199, 311]);
/** 业务性无结果 */
const NO_RESULT_CODES = new Set([327, 328, 329, 344, 347, 387, 393]);
/** 起终点异常（太近 / 太远）——同样不该重试 */
const ENDPOINT_CODES = new Set([326, 365, 366, 373]);

/**
 * 把腾讯业务状态码归入可操作类别（T58）。
 *
 * 腾讯 HTTP 恒 200，成功与否只看响应体顶层 `status`。
 */
export function classifyTencentStatus(status: number): TencentStatus {
  if (status === 0) return { kind: 'ok' };
  if (status === 335) return { kind: 'unsupportedCity', kindLabel: '腾讯不支持该城市的公交查询' };
  if (RETRIABLE_CODES.has(status)) return { kind: 'retriable', kindLabel: '上游繁忙' };
  if (NO_RESULT_CODES.has(status)) return { kind: 'noResult', kindLabel: '无可达路线' };
  if (CONFIG_CODES.has(status)) return { kind: 'config', kindLabel: '接驳服务未配置' };
  if (ENDPOINT_CODES.has(status)) return { kind: 'error', kindLabel: '站点位置异常' };
  return { kind: 'error', kindLabel: `上游错误（${status}）` };
}
