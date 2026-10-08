/**
 * 绕行判定（D60/D61）—— 官方「回头路线」规则 + 耗时阈值兜底
 *
 * 官方专利 CN114912659A 定义：第一行程车次先后途经某车站，后续车次又返回该站，
 * 或前后行程途经 OD 轨迹有重叠，即为**回头路线**。
 *
 * 需要第一程的经停站序列（T43：只对候选方案 runtime 补查 queryByTrainNo），
 * 故本模块是纯函数，经停数组由调用方传入。
 *
 * 处理策略（D61）：明确折返 → 直接删除；疑似绕远 → 只标记不删除。
 */

/** 一程的最小标识（站名/站码任选，只要前后一致） */
export interface DetourLeg {
  fromStation: string;
  toStation: string;
  trainNo: string;
}

/**
 * 疑似绕行系数（D60 兜底）：总耗时 > 最优 × 该系数 → 标记疑似绕远。
 *
 * 取 2.0 与调研报告 §8.3 的参考实现一致（QDKStorm `BADLIM 2.0`）。
 */
export const DETOUR_RATIO = 2.0;

/**
 * 回头路线判定（D60 官方规则）。
 *
 * @param legs    各程（按顺序）
 * @param stops   各程的经停站名序列（与 legs 等长）；缺失的程传空数组
 * @returns 是否存在回头（后续程重走某前序程的已过站）
 */
export function detectBacktrack(legs: DetourLeg[], stops: string[][]): boolean {
  if (legs.length < 2) return false;

  // 累积「前序程已经过」的站集合；换乘站本身不计入（它是下一程的起点，合理地会再次出现）
  const passed = new Set<string>();
  for (let i = 0; i < legs.length; i++) {
    const seq = stops[i] ?? [];
    const boarding = seq[0] ?? legs[i]!.fromStation;
    const alighting = seq[seq.length - 1] ?? legs[i]!.toStation;
    // 除首末外，中间的经停站算「已过站」
    const via = seq.slice(1, -1);
    for (const s of via) {
      if (passed.has(s)) return true;
    }
    // 到达站若在后续程中再出现，由后续程的 via 判定捕获
    for (const s of via) passed.add(s);
    if (i > 0) passed.add(boarding);
    void alighting;
  }
  return false;
}

/**
 * 耗时阈值兜底（D60）：总耗时是否超过最优的 `DETOUR_RATIO` 倍。
 *
 * @param minutes 本方案总耗时
 * @param best    同查询内最优方案总耗时；<= 0 表示无基准，不判
 */
export function isDetour(minutes: number, best: number): boolean {
  if (!Number.isFinite(best) || best <= 0) return false;
  return minutes > best * DETOUR_RATIO;
}
