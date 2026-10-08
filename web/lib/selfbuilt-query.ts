/**
 * 自研查询编排（T39~T42）——把枢纽池、可达图预筛、限流与算法串成一次查询
 *
 * 流程：
 *   1. 枢纽预筛（T39）：用离线可达图剔除明显不可达的枢纽
 *   2. 限流取数（T41）：所有 `directTrains` / `stopsOf` 走同一请求网关
 *   3. 分层扩展 + 绕行过滤（selfbuilt.ts，T37/T43）
 *
 * 纯编排，不触碰网络与 UI：取数经注入的 `SelfBuiltQueryDeps`（真实实现见
 * selfbuilt-adapter.ts）。Worker 零改动（T42）。
 */

import { createGateway } from './gateway.ts';
import type { Gateway } from './gateway.ts';
import { orderByReachability, filterByDirection } from './reach.ts';
import type { CityCoords } from './reach.ts';
import type { ReachGraph } from './reach.ts';
import { runSelfBuiltTransfer } from './selfbuilt.ts';
import type { ScoredJourney } from './selfbuilt.ts';
import type { Train } from '../../shared/types.ts';

/** 编排依赖：真实实现包一层 api.ts（见 selfbuilt-adapter.ts 的扩展） */
export interface SelfBuiltQueryDeps {
  directTrains(from: string, to: string): Promise<Train[]>;
  stopsOf(train: Train): Promise<string[]>;
}

/** 限流配置（T41） */
export interface SelfBuiltRateLimit {
  concurrency: number;
  intervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** 一次自研查询的参数 */
export interface SelfBuiltQueryParams {
  from: string;
  to: string;
  date: string;
  /** 候选枢纽（城市代表站码）；未预筛前 */
  hubs: string[];
  maxTransfers: 1 | 2;
  /** 离线可达图；缺省不做预筛 */
  graph?: ReachGraph;
  /** 城市坐标（T40 走行方向过滤）；缺省不做方向过滤 */
  coords?: CityCoords;
  /** 站码 → 城市键（同城判定） */
  cityOf?: (stationCode: string) => string;
  /** 扩展边硬上限（T41） */
  maxEdges?: number;
  /** 输出上限（T45） */
  maxResults?: number;
  /** 经停补查候选上限（T43 请求量收敛） */
  maxDetourChecks?: number;
  /** 限流；缺省不限流（测试用） */
  rateLimit?: SelfBuiltRateLimit;
}

/** 查询结果 */
export interface SelfBuiltQueryResult {
  journeys: ScoredJourney[];
  /** 因回头被删除的候选数 */
  removed: number;
  /** 实际扩展的边数 */
  edges: number;
  /** 预筛后的枢纽 */
  hubs: string[];
}

/** 用限流网关包一层取数依赖 */
function withGateway(deps: SelfBuiltQueryDeps, gateway: Gateway): SelfBuiltQueryDeps {
  return {
    directTrains: (from, to) => gateway.run(() => deps.directTrains(from, to)),
    stopsOf: (train) => gateway.run(() => deps.stopsOf(train)),
  };
}

/** 执行一次自研查询 */
export async function runSelfBuiltQuery(
  p: SelfBuiltQueryParams,
  deps: SelfBuiltQueryDeps,
): Promise<SelfBuiltQueryResult> {
  // 枢纽预筛（T39 可达图）+ 走行方向过滤（T40）。
  // ⚠️ 可达图节点是**城市名**，而 hubs 是**站码**，故先翻成城市名再过滤，
  // 最后翻回站码（保持唯一，避免同城多站重复）。
  const cityOf = p.cityOf ?? ((c: string) => c);
  const fromCity = cityOf(p.from);
  const toCity = cityOf(p.to);
  const cityHubs = [...new Set(p.hubs.map(cityOf))];
  // 可达图只用于**排序**（稀疏子集，不能当硬筛——见 reach.orderByReachability）
  const orderedCities = p.graph
    ? orderByReachability(p.graph, fromCity, toCity, cityHubs)
    : cityHubs;
  const keptCities = new Set(orderedCities);
  // 方向过滤（T40）：作用于城市名，与可达图预筛取交集
  if (p.coords) {
    const directional = new Set(filterByDirection(p.coords, fromCity, toCity, [...keptCities]));
    for (const c of [...keptCities]) if (!directional.has(c)) keptCities.delete(c);
  }
  // 按城市排序结果重排站码（同城只留一个代表，保持稳定序）
  const seen = new Set<string>();
  const hubs: string[] = [];
  for (const city of orderedCities) {
    const code = p.hubs.find((h) => cityOf(h) === city);
    if (!code || !keptCities.has(city) || seen.has(code)) continue;
    seen.add(code);
    hubs.push(code);
  }

  const wrapped = p.rateLimit ? withGateway(deps, createGateway(p.rateLimit)) : deps;

  const r = await runSelfBuiltTransfer(
    {
      from: p.from,
      to: p.to,
      date: p.date,
      hubs,
      maxTransfers: p.maxTransfers,
      ...(p.cityOf ? { cityOf: p.cityOf } : {}),
      ...(p.maxEdges != null ? { maxEdges: p.maxEdges } : {}),
      ...(p.maxResults != null ? { maxResults: p.maxResults } : {}),
      ...(p.maxDetourChecks != null ? { maxDetourChecks: p.maxDetourChecks } : {}),
    },
    wrapped,
  );

  return { ...r, hubs };
}
