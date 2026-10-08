/**
 * 自研中转：行程装配（时间扩展图 + 分层扩展，T37 / D56~D58）
 *
 * 与官方 lcquery 路线不同：不依赖官方候选枢纽，改为**自行把直达车次拼成多段行程**。
 * 跨城层节点 = 城市（由 cityOf 判定同城），每扩展一条边 = 一次余票查询（T38/T42）。
 *
 * 纯函数 + 注入式 API（`JourneyApi`），不触碰网络与 UI，便于单测（T21）。
 */

import { MIN_WAIT_SAME_STATION, MIN_WAIT_CROSS_STATION } from '../../shared/constants.ts';
import type { Train } from '../../shared/types.ts';

/** 一天分钟数 */
const DAY = 1440;

/** 'HH:MM' → 当日分钟数；非法（含 '----'）返回 null */
export function timeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 一次换乘点（接在某一程之后） */
export interface JourneyTransfer {
  /** 换乘站码（上一程的到达站） */
  station: string;
  /** 换乘等待（分钟） */
  waitMinutes: number;
  /** 是否同站换乘（false = 同城异站） */
  sameStation: boolean;
}

/** 一条自研行程（2 段及以上） */
export interface Journey {
  legs: Train[];
  /** 长度 = legs.length - 1 */
  transfers: JourneyTransfer[];
}

/** 自研编排所需的取数接口（真实实现包一层 api.ts；测试可注入） */
export interface JourneyApi {
  /** 查 from→to 的城市级直达车次（已解析） */
  directTrains(from: string, to: string): Promise<Train[]>;
}

/** 一次自研查询的参数 */
export interface JourneyParams {
  from: string;
  to: string;
  date: string;
  /** 候选换乘枢纽（城市代表站码） */
  hubs: string[];
  /** 最多换乘次数：1 = 两段，2 = 三段（D57） */
  maxTransfers: 1 | 2;
  /** 站码 → 城市键（同城判定，T37）；缺省按站码相等 */
  cityOf?: (stationCode: string) => string;
  /** 单次查询最多扩展的边数（硬上限，T41）；缺省不限制 */
  maxEdges?: number;
}

/** 一程的绝对到达时刻（分钟，以首程发车日为 0 点基准）——T44 跨天自算 */
function arriveAbs(startAbs: number, duration: string, arriveTime: string, startTime: string): number {
  const dur = timeToMinutes(duration);
  if (dur != null) return startAbs + dur;
  // 无历时字段时的兜底：到达时刻早于发车时刻判为跨天
  const a = timeToMinutes(arriveTime);
  const s = timeToMinutes(startTime);
  if (a == null || s == null) return startAbs;
  return startAbs + ((a - s + DAY) % DAY);
}

/**
 * 上一程到达 → 下一程发车的等待（分钟）。
 *
 * 单日查询口径：次程发车早于到达（负等待）视为**同日不可行**（跨天需查次日车次，
 * 属另一轮查询），返回 null 由调用方剪掉。
 */
function waitMinutes(arrAbs: number, nextStart: string): number | null {
  const s = timeToMinutes(nextStart);
  if (s == null) return null;
  const wait = s - (arrAbs % DAY);
  return wait < 0 ? null : wait;
}

/** 判断两程能否接续；能则返回换乘点，否则 null */
export function connectLegs(
  prev: Train,
  next: Train,
  arrAbs: number,
  sameCity: (a: string, b: string) => boolean,
): JourneyTransfer | null {
  const same = prev.toStation === next.fromStation;
  if (!same && !sameCity(prev.toStation, next.fromStation)) return null;
  const wait = waitMinutes(arrAbs, next.startTime);
  if (wait == null) return null;
  const minWait = same ? MIN_WAIT_SAME_STATION : MIN_WAIT_CROSS_STATION;
  if (wait < minWait) return null;
  return { station: prev.toStation, waitMinutes: wait, sameStation: same };
}

/**
 * 自研中转主入口：在时间扩展图上做分层扩展（T37）。
 *
 * 只产出**终点落在目的地城市**的行程；换乘等待低于 T62 下限的边直接剪掉。
 * 同一条边（起站→终站）只查一次（内存去重），受 `maxEdges` 约束（T41）。
 */
export async function planJourneys(p: JourneyParams, api: JourneyApi): Promise<Journey[]> {
  const cityOf = p.cityOf ?? ((c: string) => c);
  const sameCity = (a: string, b: string): boolean => cityOf(a) === cityOf(b);
  const destCity = cityOf(p.to);
  const budget = p.maxEdges ?? Number.POSITIVE_INFINITY;

  const cache = new Map<string, Train[]>();
  let edges = 0;

  async function query(from: string, to: string): Promise<Train[]> {
    const key = `${from}>${to}`;
    const hit = cache.get(key);
    if (hit) return hit;
    edges++;
    const trains = await api.directTrains(from, to);
    cache.set(key, trains);
    return trains;
  }

  const results: Journey[] = [];

  /** 从当前最后一程继续扩展 */
  async function go(legs: Train[], transfers: JourneyTransfer[], arrAbs: number, visited: Set<string>): Promise<void> {
    if (transfers.length >= p.maxTransfers || edges >= budget) return;
    const last = legs[legs.length - 1]!;
    // 只剩一次换乘时，最后一段只需通向目的地——再经其他枢纽就超次数了，
    // 否则会在第一个枢纽就把边预算烧光（每枢纽 × 全枢纽）。
    const remaining = p.maxTransfers - transfers.length;
    const nexts = [...(remaining > 1 ? p.hubs : []), p.to];
    for (const next of nexts) {
      if (visited.has(cityOf(next))) continue;
      if (edges >= budget) return;
      const trains = await query(last.toStation, next);
      for (const train of trains) {
        const xfer = connectLegs(last, train, arrAbs, sameCity);
        if (!xfer) continue;
        const newLegs = [...legs, train];
        const newTransfers = [...transfers, xfer];
        const newArr = arriveAbs(arrAbs, train.duration, train.arriveTime, train.startTime);
        if (cityOf(train.toStation) === destCity) {
          results.push({ legs: newLegs, transfers: newTransfers });
        } else {
          await go(newLegs, newTransfers, newArr, new Set([...visited, cityOf(train.toStation)]));
        }
      }
    }
  }

  for (const hub of p.hubs) {
    if (cityOf(hub) === cityOf(p.from) || cityOf(hub) === destCity) continue;
    if (edges >= budget) break;
    const firstLegs = await query(p.from, hub);
    for (const train of firstLegs) {
      if (cityOf(train.fromStation) !== cityOf(p.from)) continue;
      const startAbs = timeToMinutes(train.startTime);
      if (startAbs == null) continue;
      const arr = arriveAbs(startAbs, train.duration, train.arriveTime, train.startTime);
      await go([train], [], arr, new Set([cityOf(p.from), cityOf(hub)]));
    }
  }

  return results;
}
