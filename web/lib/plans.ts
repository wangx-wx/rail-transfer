/**
 * 中转方案处理 —— 标记 / 合并 / 排序（纯函数）
 *
 * 对应决策：
 *   D12 标记优于删除 —— 不删除任何方案，只加标记
 *   D13 换乘下限：同站 15 分 / 同城异站 60 分
 *   D14 超长等待 > 120 分：标记，默认折叠
 *   D15 同车接续：单独标注
 *   D16 视觉合并同一车次组合
 *   D17 默认按总耗时排序；等待 < 20 分打风险标记
 */

import {
  MIN_WAIT_SAME_STATION,
  MIN_WAIT_CROSS_STATION,
  LONG_WAIT_THRESHOLD,
  RISK_WAIT_THRESHOLD,
} from '../../shared/constants.ts';
import type { AnnotatedPlan, PlanGroup, TransferPlan } from '../../shared/types.ts';

/** 给方案打标记（D12：只标记，不删除）。 */
export function annotatePlan(plan: TransferPlan): AnnotatedPlan {
  const minWait = plan.sameStation ? MIN_WAIT_SAME_STATION : MIN_WAIT_CROSS_STATION;
  return {
    ...plan,
    flags: {
      /** 低于换乘下限（物理上不可行） */
      belowMin: plan.waitMinutes < minWait,
      /** 换乘时间紧，有赶不上的风险 */
      risky: plan.waitMinutes >= minWait && plan.waitMinutes < RISK_WAIT_THRESHOLD,
      /** 超长等待，默认折叠 */
      longWait: plan.waitMinutes > LONG_WAIT_THRESHOLD,
      /** 同车接续，无需换乘站台 */
      sameTrain: plan.sameTrain,
    },
  };
}

/** 批量打标记。 */
export function annotatePlans(plans: TransferPlan[]): AnnotatedPlan[] {
  return plans.map(annotatePlan);
}

/**
 * 视觉合并同一车次组合（D16）。
 *
 * 同一对「显示车次」只占一行，换乘站收进 `middleStations`，
 * 代表项取总耗时最小的那条。**不丢信息**：所有换乘站都保留。
 *
 * 注：按 `firstTrainCode`（显示车次）合并，不按 `firstTrainNo`（内部编号）——
 * 同车接续时两程内部编号相同，会误合并。
 */
export function mergePlans(plans: AnnotatedPlan[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const p of plans) {
    const key = `${p.firstTrainCode}|${p.secondTrainCode}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        firstTrainCode: p.firstTrainCode,
        secondTrainCode: p.secondTrainCode,
        firstTrainNo: p.firstTrainNo,
        secondTrainNo: p.secondTrainNo,
        middleStations: [],
        best: p,
        count: 0,
      };
      groups.set(key, g);
    }
    g.count++;
    if (!g.middleStations.some((m) => m.name === p.middleStation)) {
      g.middleStations.push({
        name: p.middleStation,
        waitMinutes: p.waitMinutes,
        sameStation: p.sameStation,
      });
    }
    if (p.totalMinutes < g.best.totalMinutes) g.best = p;
  }
  return [...groups.values()];
}

/** 排序键（D17） */
export type SortBy = 'duration' | 'wait';

const SORTERS: Record<SortBy, (a: PlanGroup, b: PlanGroup) => number> = {
  /** 默认：总耗时升序 */
  duration: (a, b) => a.best.totalMinutes - b.best.totalMinutes,
  /** 换乘等待升序 */
  wait: (a, b) => a.best.waitMinutes - b.best.waitMinutes,
};

/** 排序（D17）。默认总耗时；价格排序待票价接入后再补。 */
export function sortPlans(groups: PlanGroup[], by: SortBy = 'duration'): PlanGroup[] {
  const cmp = SORTERS[by] ?? SORTERS.duration;
  return [...groups].sort(cmp);
}

/** 一站式：标记 → 合并 → 排序。 */
export function processPlans(plans: TransferPlan[], by: SortBy = 'duration'): PlanGroup[] {
  return sortPlans(mergePlans(annotatePlans(plans)), by);
}
