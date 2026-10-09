/**
 * 自研中转编排（T37/T43/T45，D56~D63）
 *
 * 把纯算法（journey / detour / journeys）与真实取数缝合：
 *   1. 分层扩展（planJourneys）得到候选行程
 *   2. 只对候选行程补查经停（T43），做回头判定（D60），明确折返删除（D61）
 *   3. 疑似绕远只标记（D61），最后去重 + 加权排序 + 上限截断（T45）
 *
 * 不触碰网络与 UI：取数通过注入的 `SelfBuiltDeps`。Worker 零改动（T42）。
 */

import { planJourneys } from './journey.ts';
import { detectBacktrack } from './detour.ts';
import { capJourneys, dedupeJourneys, journeyFlags, sortJourneys } from './journeys.ts';
import { isDetour } from './detour.ts';
import type { Journey, JourneyApi, JourneyParams } from './journey.ts';
import type { Train } from '../../shared/types.ts';

/** 带标记与统计的输出行程 */
export interface ScoredJourney extends Journey {
  /** 换乘次数 */
  transfersCount: number;
  /** 总耗时（分钟） */
  totalMinutes: number;
  /** 疑似绕远（只标记，不删除，D61） */
  detour: boolean;
  /** 超长等待，默认折叠 */
  longWait: boolean;
  /** 换乘紧张 */
  risky: boolean;
}

/** 自研编排依赖（真实实现包一层 api.ts 与 parse.ts） */
export interface SelfBuiltDeps {
  /** from→to 的城市级直达车次（已解析） */
  directTrains(from: string, to: string): Promise<Train[]>;
  /** 一程的完整经停站序列（站名）；失败应返回该程起讫两站 */
  stopsOf(train: Train): Promise<string[]>;
}

/** 自研查询参数 */
export interface SelfBuiltParams {
  from: string;
  to: string;
  date: string;
  hubs: string[];
  maxTransfers: 1 | 2;
  /** 站码 → 城市键（同城判定） */
  cityOf?: (stationCode: string) => string;
  /** 单次查询最多扩展的边数（T41） */
  maxEdges?: number;
  /** 输出上限，默认 200（T45） */
  maxResults?: number;
  /** 同一到达城市每层最多保留几条部分行程（T49） */
  beamPerStation?: number;
  /** 每层部分行程总数上限（T49） */
  beamSize?: number;
  /** 经停补查的候选上限（T43 请求量收敛），默认 60 */
  maxDetourChecks?: number;
}

/** 自研查询结果 */
export interface SelfBuiltResult {
  journeys: ScoredJourney[];
  /** 因回头被删除的候选数 */
  removed: number;
  /** 实际扩展的边数 */
  edges: number;
}

/**
 * 执行一次自研中转查询。
 *
 * 参考方案总量：一次换乘 2×|枢纽| 次；二次换乘 |枢纽| + |枢纽|² + |枢纽| 次——
 * 故必须靠离线可达图预筛（T39）与 `maxEdges` 硬上限（T41）收敛。
 */
export async function runSelfBuiltTransfer(
  p: SelfBuiltParams,
  deps: SelfBuiltDeps,
): Promise<SelfBuiltResult> {
  let edges = 0;
  const api: JourneyApi = {
    async directTrains(from, to) {
      edges++;
      return deps.directTrains(from, to);
    },
  };
  const params: JourneyParams = {
    from: p.from,
    to: p.to,
    date: p.date,
    hubs: p.hubs,
    maxTransfers: p.maxTransfers,
    ...(p.cityOf ? { cityOf: p.cityOf } : {}),
    ...(p.maxEdges != null ? { maxEdges: p.maxEdges } : {}),
    ...(p.beamPerStation != null ? { beamPerStation: p.beamPerStation } : {}),
    ...(p.beamSize != null ? { beamSize: p.beamSize } : {}),
  };

  const raw = await planJourneys(params, api);

  // 回头判定：只对候选行程补查经停（T43），明确折返删除（D61）。
  // 候选可能上百条，故**先去重 + 加权排序取前 K 条**再补经停，避免上百次串行请求。
  const ranked = sortJourneys(dedupeJourneys(raw)).slice(0, p.maxDetourChecks ?? 60);

  let removed = 0;
  let candidates: Journey[] = [];
  for (const j of ranked) {
    const stopsByLeg: string[][] = [];
    for (const leg of j.legs) stopsByLeg.push(await deps.stopsOf(leg));
    if (detectBacktrack(j.legs, stopsByLeg)) {
      removed++;
      continue;
    }
    candidates.push(j);
  }

  candidates = dedupeJourneys(candidates);
  const best = Math.min(...candidates.map((j) => journeyFlags(j).totalMinutes).filter((n) => n > 0), Number.POSITIVE_INFINITY);

  const scored: ScoredJourney[] = candidates.map((j) => {
    const s = journeyFlags(j);
    return {
      ...j,
      transfersCount: s.transfers,
      totalMinutes: s.totalMinutes,
      detour: isDetour(s.totalMinutes, best),
      longWait: s.longWait,
      risky: s.risky,
    };
  });

  const capped = capJourneys(scored, p.maxResults ?? 200) as ScoredJourney[];
  return { journeys: capped, removed, edges };
}
