/**
 * 离线可达图（T39/T40）—— 枢纽预筛，runtime 零网络
 *
 * build-time 由 mobile 小程序「车站车次大屏」接口预生成「城市→城市」邻接矩阵，
 * runtime 只做内存查询：出发地能直达该枢纽、且该枢纽能直达目的地，才纳入候选。
 * 纯函数，便于单测。
 */

/** 城市 → 可直达城市列表 */
export type ReachGraph = Record<string, string[]>;

/** 邻接图的一条边 */
export interface ReachEdge {
  from: string;
  to: string;
}

/** 把 {from,to} 边列表聚成邻接表（去重） */
export function parseReachability(edges: ReachEdge[]): ReachGraph {
  const graph: ReachGraph = {};
  for (const { from, to } of edges) {
    if (!from || !to) continue;
    const list = (graph[from] ??= []);
    if (!list.includes(to)) list.push(to);
  }
  return graph;
}

/**
 * 单跳可达判定：`from` 是否能直达 `to`（自身视为可达）。
 *
 * 只查一跳——多跳可达由 BFS 的逐边查询自然覆盖，预筛只需剔除「连直边都不存在」
 * 的明显无效枢纽。
 */
export function canReach(graph: ReachGraph, from: string, to: string): boolean {
  if (from === to) return true;
  return (graph[from] ?? []).includes(to);
}

/**
 * 枢纽预筛（T40）：保留 出发→枢纽 与 枢纽→目的 均可达的枢纽，
 * 并剔除出发城市自身与目的城市。
 */
export function filterHubs(graph: ReachGraph, from: string, to: string, hubs: string[]): string[] {
  return hubs.filter(
    (h) => h !== from && h !== to && canReach(graph, from, h) && canReach(graph, h, to),
  );
}
