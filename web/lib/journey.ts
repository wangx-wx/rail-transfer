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

/**
 * 'HH:MM' 形式的**历时** → 分钟；可超 24 小时（跨天长途，如 `27:05`）。
 * 非法返回 null。与 `timeToMinutes` 分开：后者用于时钟时刻，上限 23:59。
 */
export function durationToMinutes(duration: string): number | null {
  const m = /^(\d{1,3}):(\d{2})$/.exec((duration ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
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
  /** 同一到达城市每层最多保留几条部分行程（支配剪枝，T49）；缺省不剪 */
  beamPerStation?: number;
  /** 每层部分行程总数上限（束宽，T49）；缺省不剪 */
  beamSize?: number;
}

/** 部分行程 + 其绝对到达时刻（分钟，首程发车日为 0 点基准）——T44 跨天自算 */
interface Partial {
  journey: Journey;
  arriveAbs: number;
}

/** 一条待取边：由某个 partial 接续到某 target */
interface Task {
  partial: Partial;
  target: string;
  trains: Promise<Train[]>;
}

/** 一程的绝对到达时刻（分钟，以首程发车日为 0 点基准）——T44 跨天自算 */
function arriveAbs(startAbs: number, duration: string, arriveTime: string, startTime: string): number {
  const dur = durationToMinutes(duration);
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
 * 按到达时间剪枝一层部分行程（T49）。
 *
 * ① **支配剪枝**：同一到达城市只保留最早到达的 N 条——晚到的部分行程在同一条
 *    后续边上必然仍晚到，被完全支配，留着只是浪费边预算。
 * ② **束宽**：整层再截到最多 `size` 条。
 *
 * 依据：首层候选可达上千条（实测 广州南经 36 枢纽 → 1568 条），不剪枝则边预算
 * 会被浅层的次优行程吃光，二次换乘无从展开。
 */
function pruneLayer(
  layer: Partial[],
  cityOf: (c: string) => string,
  perStation: number | undefined,
  size: number | undefined,
): Partial[] {
  let out = layer;
  if (perStation != null) {
    const best = new Map<string, Partial[]>();
    for (const p of out) {
      const key = cityOf(p.journey.legs[p.journey.legs.length - 1]!.toStation);
      const list = best.get(key);
      if (list) list.push(p);
      else best.set(key, [p]);
    }
    out = [...best.values()].flatMap((list) =>
      [...list].sort((a, b) => a.arriveAbs - b.arriveAbs).slice(0, perStation),
    );
  }
  out = [...out].sort((a, b) => a.arriveAbs - b.arriveAbs);
  return size != null ? out.slice(0, size) : out;
}

/**
 * 自研中转主入口：在时间扩展图上做**分层扩展**（T37）。
 *
 * 逐层（换乘 0 次 → 1 次 → …）广度展开，保证浅层（少换乘）结果先于深层被枚举——
 * 边预算（T41）耗尽时，被牺牲的一定是更深、更差的方案。每层用 `pruneLayer`
 * 控制规模（T49）。同一条边只查一次（内存去重）。
 */
export async function planJourneys(p: JourneyParams, api: JourneyApi): Promise<Journey[]> {
  const cityOf = p.cityOf ?? ((c: string) => c);
  const sameCity = (a: string, b: string): boolean => cityOf(a) === cityOf(b);
  const destCity = cityOf(p.to);
  const budget = p.maxEdges ?? Number.POSITIVE_INFINITY;

  const cache = new Map<string, Promise<Train[]>>();
  let edges = 0;

  /**
   * 查 from→to 的城市级直达车次。
   *
   * ⚠️ 缓存键按**城市**归一（T55）：上游收到城市站码会**自动展开全城车站**（D19/T35，
   * 实测「天津西→济南」与「天津→济南」返回完全相同的 110 趟），而一程的到达站是上游
   * 挑的具体站（天津有 TJP/TXP/TIP/WWP）。若按具体站做键，同一对城市会被重复查 4 次——
   * 这是北京→上海选 2 个枢纽时枚举请求从 6 涨到 30 的**唯一原因**。
   *
   * 归一后同城只查一次；**请求参数仍用调用方给的站码**（上游结果与站码无关），
   * 换乘的同站/异站判定也仍用具体站（见 `connectLegs`），不受影响。
   *
   * 缓存存 **Promise**：分层已并发派发，同城的并发调用必须共享同一次请求，否则
   * 同时未命中会各发一次（归一失效）。
   */
  function query(from: string, to: string): Promise<Train[]> {
    const key = `${cityOf(from)}>${cityOf(to)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    edges++;
    const pending = api.directTrains(from, to);
    cache.set(key, pending);
    return pending;
  }

  const results: Journey[] = [];

  /**
   * 用已取到的车次列表接续（纯计算，无 await）。
   * 到终点的进 `done`，其余成为下一层的部分行程。
   */
  function connectWith(
    partial: Partial,
    target: string,
    trains: Train[],
    done: Journey[],
    next: Partial[],
  ): void {
    const last = partial.journey.legs[partial.journey.legs.length - 1]!;
    if (cityOf(target) === cityOf(last.toStation)) return;
    for (const train of trains) {
      const xfer = connectLegs(last, train, partial.arriveAbs, sameCity);
      if (!xfer) continue;
      const journey: Journey = {
        legs: [...partial.journey.legs, train],
        transfers: [...partial.journey.transfers, xfer],
      };
      if (cityOf(train.toStation) === destCity) {
        done.push(journey);
      } else {
        const arr = arriveAbs(partial.arriveAbs, train.duration, train.arriveTime, train.startTime);
        next.push({ journey, arriveAbs: arr });
      }
    }
  }

  /**
   * 登记一条待取的边；越界（预算不足且缓存未命中）返回 null。
   *
   * 预算只对**未命中的边**计数：命中缓存的边不再花预算，故不会被预算挡住
   * （归一后同城边必定命中，只有首条真正花钱）。
   */
  function planTask(partial: Partial, target: string, reserve = 0): Task | null {
    const last = partial.journey.legs[partial.journey.legs.length - 1];
    const from = last ? last.toStation : p.from;
    if (cityOf(target) === cityOf(from)) return null; // 同城不必换乘
    const key = `${cityOf(from)}>${cityOf(target)}`;
    if (!cache.has(key) && edges + reserve >= budget) return null;
    return { partial, target, trains: query(from, target) };
  }

  /**
   * 把「各 partial × 各 target」的边查询**并发**派发出去。
   *
   * ⚠️ 并发是必须的：原实现逐个 `await query(...)`，耗时 = 请求数 × 单次往返
   * （用户线上 1~2s/次 → 数十次即数分钟）。限流仍由注入网关把关（T41：
   * 并发 ≤3、间隔 ≥300ms），这里只是不再人为串行。
   * `reserve` 为后续轮次要预留的边数（保证浅层「直达终点」先完成）。
   */
  async function expand(
    partials: Partial[],
    targets: string[],
    done: Journey[],
    next: Partial[],
    reserve = 0,
  ): Promise<void> {
    const tasks: Task[] = [];
    for (const partial of partials) {
      for (const target of targets) {
        const t = planTask(partial, target, reserve);
        if (t) tasks.push(t);
      }
    }
    const lists = await Promise.all(tasks.map((t) => t.trains));
    tasks.forEach((t, i) => connectWith(t.partial, t.target, lists[i]!, done, next));
  }

  // 首层：出发地 → 各枢纽
  const firstTargets = p.hubs.filter(
    (hub) => cityOf(hub) !== cityOf(p.from) && cityOf(hub) !== destCity,
  );
  let layer: Partial[] = [];
  {
    const root: Partial = { journey: { legs: [], transfers: [] }, arriveAbs: 0 };
    const tasks: Task[] = [];
    for (const hub of firstTargets) {
      const t = planTask(root, hub);
      if (t) tasks.push(t);
    }
    const lists = await Promise.all(tasks.map((t) => t.trains));
    tasks.forEach((t, i) => {
      for (const train of lists[i]!) {
        if (cityOf(train.fromStation) !== cityOf(p.from)) continue;
        const startAbs = timeToMinutes(train.startTime);
        if (startAbs == null) continue;
        const arr = arriveAbs(startAbs, train.duration, train.arriveTime, train.startTime);
        layer.push({ journey: { legs: [train], transfers: [] }, arriveAbs: arr });
      }
    });
  }
  // ⚠️ 首层**不按到达时间剪枝**：晚到的首程能接上不同的第二程，剪掉会丢一次换乘结果。
  // 只保留束宽上限作为兜底。
  layer = p.beamSize != null ? pruneLayer(layer, cityOf, undefined, p.beamSize) : layer;

  for (let depth = 0; depth < p.maxTransfers; depth++) {
    // 第一趟：所有部分行程先试「直达终点」——浅层（少换乘）结果优先。
    await expand(layer, [p.to], results, []);
    if (depth + 1 >= p.maxTransfers) break;

    // 第二趟：向其他枢纽扩展形成下一层；为下一层的『直达终点』预留配额。
    const next: Partial[] = [];
    await expand(layer, p.hubs, [], next, p.hubs.length);
    // 中间层（2 段及以上）按到达时间支配剪枝，控制二次换乘的规模（T49）
    layer = pruneLayer(next, cityOf, p.beamPerStation, p.beamSize);
  }

  return results;
}
