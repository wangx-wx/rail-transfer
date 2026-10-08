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

/** 大屏响应行（只标注用到的字段） */
export interface BigScreenRow {
  /** 始发站电报码 */
  start_station_telecode?: string;
  /** 终到站电报码 */
  end_station_telecode?: string;
}

/**
 * 大屏响应 → 城市邻接边（T39 build-time）。
 *
 * 「车站车次大屏」返回的每趟车带起终站电报码，据此推出「出发城市→到达城市」
 * 的直达边。重复边去重，同城边与缺码行忽略。
 *
 * ⚠️ 大屏只给起终站、不给中间经停，故边是**可达性的上界**（可能多、不会少），
 * 用于预筛足够安全。
 */
export function bigscreenToEdges(
  rows: BigScreenRow[],
  cityOf: (stationCode: string) => string,
): ReachEdge[] {
  const seen = new Set<string>();
  const edges: ReachEdge[] = [];
  for (const r of rows) {
    const a = r.start_station_telecode;
    const b = r.end_station_telecode;
    if (!a || !b) continue;
    const from = cityOf(a);
    const to = cityOf(b);
    if (!from || !to || from === to) continue;
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to });
  }
  return edges;
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

/**
 * 离线可达图预筛（T39/T40）——真实产物专用，比 `filterHubs` 更保守。
 *
 * 产物只覆盖 38 个枢纽站，城市未必都在图里，故**只在两侧城市都已知时才过滤**：
 *   - `h` 或对应侧城市不在图中 → 该侧跳过（宁可多查，不可漏）
 *   - 双方都在图中 → 缺 出发→枢纽 或 枢纽→目的 边即剔除
 */
export function prefilterHubs(graph: ReachGraph, from: string, to: string, hubs: string[]): string[] {
  const known = new Set<string>();
  for (const [node, list] of Object.entries(graph)) {
    known.add(node);
    for (const t of list) known.add(t);
  }
  return hubs.filter((h) => {
    if (h === from || h === to) return false;
    if (known.has(from) && !canReach(graph, from, h)) return false;
    if (known.has(to) && !canReach(graph, h, to)) return false;
    return true;
  });
}
