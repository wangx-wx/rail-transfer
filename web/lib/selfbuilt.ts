/**
 * 自研中转编排（T37/T45，D56~D63）
 *
 * 把纯算法（journey / journeys）与真实取数缝合：
 *   1. 分层扩展（planJourneys）得到候选行程
 *   2. 疑似绕远只标记（D61），最后去重 + 加权排序 + 上限截断（T45）
 *
 * 不触碰网络与 UI：取数通过注入的 `SelfBuiltDeps`。Worker 零改动（T42）。
 *
 * ⚠️ **2026-10-15 移除经停补查与回头判定（T56）**：原第 2 步对每条候选行程补查
 * 经停（`/api/stopover`）做「回头路线」判定，是请求量的最大头（选 2 枢纽 55 次里
 * 占 49 次）。但本算法把行程拆成**独立的直达段再拼接**（北京→天津、天津→济南、
 * 济南→上海），每段都是真实直达车次，**不存在回头路**；且判定用「首程中间经停站」
 * 与后续程比对，而首程常是贴出发地的短程（裁剪后只剩起讫两站）→ 已过站集合恒空、
 * 判定根本不触发。故整体删除。
 */

import { planJourneys } from './journey.ts';
import { capJourneys, dedupeJourneys, journeyFlags } from './journeys.ts';
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
}

/** 自研查询结果 */
export interface SelfBuiltResult {
  journeys: ScoredJourney[];
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

  const candidates = dedupeJourneys(raw);
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
  return { journeys: capped, edges };
}
