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
import { canReach, filterByDirection, selectHubs } from './reach.ts';
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
  /** 几何硬砍线（T40）：绕行比值 > 此值的枢纽整个剔除；缺省不砍 */
  maxHubRatio?: number;
  /** 排序后枢纽上限（T40 兜底，防大池溢出）；缺省不截断 */
  maxHubs?: number;
  /** 几何硬砍后的保底枢纽数（短途 OD 防止砍光）；缺省不保底 */
  minHubs?: number;
  /** 扩展边硬上限（T41） */
  maxEdges?: number;
  /** 同一到达城市每层最多保留几条部分行程（支配剪枝，T49） */
  beamPerStation?: number;
  /** 每层部分行程总数上限（束宽，T49） */
  beamSize?: number;
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

/**
 * 枢纽选留（T39 可达图分档 + T40 方向过滤 + 几何硬砍 + 截断），返回站码。
 *
 * 纯函数、零网络——供 `runSelfBuiltQuery` 与请求量预估共用，保证两处口径一致。
 * ⚠️ 可达图节点是**城市名**，hubs 是**站码**，故先翻城市名再过滤，最后翻回站码。
 */
export function selectHubCodes(p: SelfBuiltQueryParams): string[] {
  const cityOf = p.cityOf ?? ((c: string) => c);
  const fromCity = cityOf(p.from);
  const toCity = cityOf(p.to);
  const cityHubs = [...new Set(p.hubs.map(cityOf))];
  // 方向过滤（T40）：作用于城市名，与后续选留取交集
  let keptCities = cityHubs;
  if (p.coords) {
    const directional = new Set(filterByDirection(p.coords, fromCity, toCity, keptCities));
    keptCities = keptCities.filter((c) => directional.has(c));
  }
  // 枢纽选留（T40 落实）：几何硬砍 → 按绕行比值升序（可达性分档仅破平）→ 截断。
  const tierOf = (city: string): number =>
    p.graph && canReach(p.graph, fromCity, city) && canReach(p.graph, city, toCity) ? 0 : 1;
  // 有坐标 → 几何硬砍 + 比值排序（分档破平）；无坐标 → 仅按可达性分档排（稳定，保原序）
  const selectedCities = p.coords
    ? selectHubs(p.coords, fromCity, toCity, keptCities, {
        maxRatio: p.maxHubRatio,
        maxHubs: p.maxHubs,
        minHubs: p.minHubs,
        tierOf,
      })
    : [...keptCities].sort((a, b) => tierOf(a) - tierOf(b));
  // 按选留顺序重排站码（同城只留一个代表，保持稳定序）
  const seen = new Set<string>();
  const hubs: string[] = [];
  for (const city of selectedCities) {
    const code = p.hubs.find((h) => cityOf(h) === city);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    hubs.push(code);
  }
  return hubs;
}

/** 执行一次自研查询 */
export async function runSelfBuiltQuery(
  p: SelfBuiltQueryParams,
  deps: SelfBuiltQueryDeps,
): Promise<SelfBuiltQueryResult> {
  const hubs = selectHubCodes(p);

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
      ...(p.beamPerStation != null ? { beamPerStation: p.beamPerStation } : {}),
      ...(p.beamSize != null ? { beamSize: p.beamSize } : {}),
    },
    wrapped,
  );

  return { ...r, hubs };
}

/** 一次查询的请求量预估（T50） */
export interface RequestEstimate {
  /** 预筛后的枢纽数 */
  hubs: number;
  /** 预估上游请求数（枚举边 + 经停补查） */
  requests: number;
  /** 按限流参数折算的预计秒数 */
  seconds: number;
  /** 该预估一次换乘/二次换乘 */
  maxTransfers: 1 | 2;
}

/**
 * 预估一次自研查询的请求量与耗时（T50，纯前端、零网络）。
 *
 * `N` = 预筛后枢纽数，`T` = 换乘次数，`K_detour` = 经停补查候选上限：
 * - 枚举边：一次换乘 `≈ 2N`；二次换乘 `≈ N² + 2N`。
 * - 经停补查：`K_detour × 2`（每程 1 次，实测 2 段居多）。
 *
 * ⚠️ 旧 T50 只估算 `2N`，**漏掉了经停补查**（实测的大头）——此处补上。
 * ⚠️ 不含查价 / 买短乘长（另走 `api.price`，不经本编排）。
 *
 * 耗时按 `请求数 ÷ (1/间隔)` 折算（T41：相邻请求间隔 `intervalMs`）。
 */
export function estimateSelfBuiltRequests(
  p: SelfBuiltQueryParams,
  opts: { intervalMs: number; detourChecks?: number },
): RequestEstimate {
  const n = selectHubCodes(p).length;
  const t = p.maxTransfers;
  const edges = t === 1 ? 2 * n : n * n + 2 * n;
  const detour = (opts.detourChecks ?? 20) * 2;
  const requests = edges + detour;
  return { hubs: n, requests, seconds: Math.ceil((requests * opts.intervalMs) / 1000), maxTransfers: t };
}
