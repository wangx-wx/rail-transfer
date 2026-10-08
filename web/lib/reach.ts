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
  /** 被查询站电报码（该车经停此站） */
  station_telecode?: string;
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
  const add = (a: string | undefined, b: string | undefined): void => {
    if (!a || !b) return;
    const from = cityOf(a);
    const to = cityOf(b);
    if (!from || !to || from === to) return;
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to });
  };
  for (const r of rows) {
    // 每行是「某车经停被查询站」：可得 始发→本站 与 本站→终到 两条可达边。
    // ⚠️ 只用 始发→终到 会漏掉大量经停方向的可达性（实测：武汉大屏取不到
    // 广州→武汉 边，导致预筛误杀武汉）。
    add(r.start_station_telecode, r.station_telecode);
    add(r.station_telecode, r.end_station_telecode);
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
 * 按可达性给枢纽排序（T39）——**只排序，不删除**。
 *
 * ⚠️ 实测：大屏接口只覆盖「被查询站」的车次，故图是真实可达性的**稀疏子集**，
 * 「图中无边」绝不等于「不可达」（例：武汉→十堰 无直接边，但经武昌/汉口有多趟车）。
 * 因此**不能拿它做硬筛**，否则会误杀大量可行枢纽（实测 37 → 2）。
 * 正确用法：把「两侧都已知可达」的枢纽排在前面，配合边预算（T41）自然剪枝。
 *
 * 排序键：两侧都可证可达 = 0（优先）；否则 = 1（保留但靠后）。
 */
export function orderByReachability(
  graph: ReachGraph,
  from: string,
  to: string,
  hubs: string[],
): string[] {
  const rank = (h: string): number => (canReach(graph, from, h) && canReach(graph, h, to) ? 0 : 1);
  return [...hubs].sort((a, b) => rank(a) - rank(b));
}

/**
 * 离线可达图预筛（T39/T40）——真实产物专用，比 `filterHubs` 更保守。
 *
 * ⚠️ 可达图的节点是**城市名**，而 `hubs` 传入的是**站码**——调用方必须先用
 * `cityOf` 把站码翻成城市名（见 selfbuilt-query.ts），否则过滤会静默失效。
 *
 * 规则：只在**两侧城市都已知**时才过滤（产物只覆盖若干枢纽）；
 * 未知侧跳过，宁可多查不可漏。
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

// ── 走行方向过滤（T40）────────────────────────────────────
/** 城市 → [经度, 纬度] */
export type CityCoords = Record<string, [number, number] | undefined>;

/**
 * 枢纽是否落在「出发地 → 目的地」的大致走行方向上。
 *
 * 用向量点积判定：枢纽相对出发地的位移在「出发地→目的地」方向上的投影为正，
 * 即不算反方向。深圳（广州东南）在「广州→十堰」方向上的投影为负 → 剔除。
 *
 * ⚠️ 这是**粗略**过滤（纬度/经度不按真实里程归一），只用于砍掉明显南辕北辙的
 * 枢纽（T40），不追求精确——精确筛选交给后续的绕行判定（D60）。
 * 缺少任意一侧坐标时返回 true（宁可多查，不可漏）。
 */
export function onDirection(
  from: [number, number] | undefined,
  to: [number, number] | undefined,
  hub: [number, number] | undefined,
): boolean {
  if (!from || !to || !hub) return true;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const hx = hub[0] - from[0];
  const hy = hub[1] - from[1];
  return dx * hx + dy * hy >= 0;
}

/** 按走行方向过滤枢纽（T40）；缺坐标的枢纽保留 */
export function filterByDirection(
  coords: CityCoords,
  from: string,
  to: string,
  hubs: string[],
): string[] {
  return hubs.filter((h) => onDirection(coords[from], coords[to], coords[h]));
}
