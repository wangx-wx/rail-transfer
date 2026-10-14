/**
 * 绕行判定（D61）—— 耗时阈值兜底
 *
 * ⚠️ **2026-10-15（T56）**：原「回头路线」判定（`detectBacktrack`，D60 官方规则）
 * 已随经停补查一并移除。自研行程是**独立直达段的拼接**（北京→天津、天津→济南、
 * 济南→上海），每段都是真实直达车次，不存在回头路；且该判定依赖首程的中间经停站，
 * 而首程常是贴出发地的短程（裁剪后只剩起讫两站）→ 已过站集合恒空、根本不触发。
 * 请求量上的代价却是最大头。详见 `selfbuilt.ts` 顶部说明。
 *
 * 保留的「耗时绕行」（本文件）为纯离线判定，零请求。
 */

/**
 * 耗时绕行系数（D60 兜底，2026-10-13 由 2.0 收紧）：总耗时 > 最优 × 该系数 → 标记疑似绕远。
 *
 * 原取 2.0（调研报告 §8.3 QDKStorm `BADLIM 2.0`）过宽，实测几乎没有方案被打标；
 * 收紧到 1.5 以抓出中度绕路。**只标记不删除**（D61），且参与加权排序惩罚（D63）。
 * 阈值待真实查询标定。
 */
export const DETOUR_RATIO = 1.5;

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
