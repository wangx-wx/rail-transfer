/**
 * 同城异站接驳：编排入口（T60）
 *
 * 从 `connection.ts` 拆出（保持单文件 ≤500 行）。判定口径见 D69~D76 / T57~T62。
 */

import { classifyTencentStatus } from './connectionFlags.ts';
import type { ConnectionFlag } from './connectionFlags.ts';
import { connectionFlags } from './connectionFlags.ts';
import { pickFastestTransit, parseTransitRoutes } from './transitParse.ts';
import type { TencentTransitResult, TransitPlan } from './transitParse.ts';
import { parseDrivingRoute } from './taxiPlan.ts';
import type { DrivingPlan, TencentDrivingRoute } from './taxiPlan.ts';
import { gateConnection } from './connection.ts';
import type { LatLng } from './connection.ts';

// ── 编排入口（T60）──────────────────────────────────────

/** 一类方案的取数结果：拿到了 / 没有 / 失败 */
export type ModeOutcome<T> =
  | { kind: 'plan'; plan: T }
  | { kind: 'empty' }
  | { kind: 'error'; message: string; retriable: boolean };

/** 一次接驳查询的结果 */
export type ConnectionResult =
  | { kind: 'noCoord' }
  | { kind: 'crossCity'; km: number }
  | {
      kind: 'ok';
      /** 两站直线距离（公里） */
      km: number;
      transit: ModeOutcome<TransitPlan>;
      driving: ModeOutcome<DrivingPlan>;
      flags: ConnectionFlag[];
    };

/** 腾讯原始响应的统一外壳（HTTP 恒 200，业务码在 `status`） */
export interface TencentEnvelope<T> {
  status: number;
  message?: string;
  result?: T;
}

/** 接驳查询可注入的取数接口（真实实现见 adapter） */
export interface ConnectionApi {
  /** 公交路线规划（`price_unit=1`，价格单位为分） */
  transit(from: LatLng, to: LatLng): Promise<TencentEnvelope<TencentTransitResult>>;
  /** 驾车路线规划 */
  driving(from: LatLng, to: LatLng): Promise<TencentEnvelope<{ routes?: TencentDrivingRoute[] }>>;
}

/** 一次接驳查询的输入（一个换乘点） */
export interface ConnectionQuery {
  /** 上一程到达站坐标 */
  from: LatLng | undefined;
  /** 下一程出发站坐标 */
  to: LatLng | undefined;
  /** 上一程到达站码（缓存键） */
  fromCode: string;
  /** 下一程出发站码（缓存键） */
  toCode: string;
  /** 换乘等待（分钟） */
  waitMinutes: number;
}

/**
 * 接驳**取数**缓存：键为「出发站码>到达站码」（T60）。
 *
 * ⚠️ 只缓存上游响应，不缓存「判定结果」——接驳耗时与站对无关，但**余量标记**
 * 依赖本次行程的等待、**打车价**依赖出发时刻（夜间加价）。若把整个结果缓存起来，
 * 同一站对在不同行程里会沿用第一次的标记与价格。
 */
export type ConnectionCache = Map<string, Promise<{ transit: TencentEnvelope<TencentTransitResult> | Error; driving: TencentEnvelope<{ routes?: TencentDrivingRoute[] }> | Error }>>;

/** 把一类方案的失败封装成统一的 `ModeOutcome` */
function failure(e: TencentEnvelope<unknown> | Error): ModeOutcome<never> {
  if (e instanceof Error) {
    // 带了明确「是否可重试」判定的错误（如 Worker 未配置 key）按其口径，别一律当网络故障
    const retriable = (e as Error & { retriable?: boolean }).retriable;
    return {
      kind: 'error',
      message: e.message || '接驳查询失败',
      retriable: retriable ?? true,
    };
  }
  const s = classifyTencentStatus(e.status);
  if (s.kind === 'ok') return { kind: 'empty' };
  if (s.kind === 'noResult') return { kind: 'empty' };
  return { kind: 'error', message: s.kindLabel, retriable: s.kind === 'retriable' };
}

/**
 * 加载一个换乘点的接驳方案（D70/D71）。
 *
 * - 两类请求**并行**发出，一侧失败不拖垮另一侧
 * - 公交取耗时最短那条；打车取唯一那条
 * - 结果进 `cache`，同站对只请求一次（含并发去重，缓存存 Promise）
 */
export async function loadConnection(
  q: ConnectionQuery,
  api: ConnectionApi,
  cache: ConnectionCache = new Map(),
): Promise<ConnectionResult> {
  const gate = gateConnection(q.from, q.to);
  if (gate.kind === 'noCoord') return { kind: 'noCoord' };
  if (gate.kind === 'crossCity') return { kind: 'crossCity', km: gate.km };

  const from = q.from!;
  const to = q.to!;
  const key = `${q.fromCode}>${q.toCode}`;

  // 只缓存取数；判定（标记 / 夜间价）每次按本次行程重算
  let fetched = cache.get(key);
  if (!fetched) {
    fetched = (async () => {
      const [transitRes, drivingRes] = await Promise.allSettled([api.transit(from, to), api.driving(from, to)]);
      return {
        transit: transitRes.status === 'rejected' ? (transitRes.reason as Error) : transitRes.value,
        driving: drivingRes.status === 'rejected' ? (drivingRes.reason as Error) : drivingRes.value,
      };
    })();
    cache.set(key, fetched);
  }
  const { transit: transitRaw, driving: drivingRaw } = await fetched;

  const transit: ModeOutcome<TransitPlan> =
    transitRaw instanceof Error
      ? failure(transitRaw)
      : transitRaw.status !== 0
        ? failure(transitRaw)
        : (() => {
            const best = pickFastestTransit(parseTransitRoutes(transitRaw.result));
            return best ? { kind: 'plan' as const, plan: best } : { kind: 'empty' as const };
          })();

  const driving: ModeOutcome<DrivingPlan> =
    drivingRaw instanceof Error
      ? failure(drivingRaw)
      : drivingRaw.status !== 0
        ? failure(drivingRaw)
        : (() => {
            const plan = parseDrivingRoute(drivingRaw.result?.routes?.[0]);
            return plan ? { kind: 'plan' as const, plan } : { kind: 'empty' as const };
          })();

  const flags = connectionFlags({
    waitMinutes: q.waitMinutes,
    transit: transit.kind === 'plan' ? transit.plan : null,
    driving: driving.kind === 'plan' ? driving.plan : null,
    km: gate.km,
  });

  return { kind: 'ok', km: gate.km, transit, driving, flags };
}

