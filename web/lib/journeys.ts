/**
 * 自研行程的展示层（D63/T45）：标记 / 去重 / 加权排序 / 上限截断
 *
 * 纯函数。输入为 `journey.planJourneys` 产出的 `Journey`，
 * 与官方路线时代的 `plans.ts` 并存（T46：先并存，验证后再删）。
 */

import {
  MIN_WAIT_SAME_STATION,
  MIN_WAIT_CROSS_STATION,
  LONG_WAIT_THRESHOLD,
  RISK_WAIT_THRESHOLD,
} from '../../shared/constants.ts';
import { durationToMinutes } from './journey.ts';
import type { Journey } from './journey.ts';

/** 单次换乘的等效惩罚（分钟）——加权排序用（D63） */
export const TRANSFER_PENALTY_MINUTES = 45;

/** 行程统计与标记 */
export interface JourneyStats {
  /** 换乘次数 */
  transfers: number;
  /** 总耗时（分钟）：各程耗时 + 换乘等待 */
  totalMinutes: number;
  /** 低于换乘下限（物理不可行） */
  belowMin: boolean;
  /** 换乘紧张（有赶不上的风险） */
  risky: boolean;
  /** 超长等待，默认折叠 */
  longWait: boolean;
}

/** 一程的耗时（分钟）；无法解析时为 0 */
function legMinutes(j: Journey, i: number): number {
  const d = durationToMinutes(j.legs[i]!.duration);
  return d ?? 0;
}

/** 计算行程统计与标记 */
export function journeyFlags(j: Journey): JourneyStats {
  let total = 0;
  for (let i = 0; i < j.legs.length; i++) total += legMinutes(j, i);
  for (const tr of j.transfers) total += tr.waitMinutes;

  let belowMin = false;
  let risky = false;
  let longWait = false;
  for (const tr of j.transfers) {
    const minWait = tr.sameStation ? MIN_WAIT_SAME_STATION : MIN_WAIT_CROSS_STATION;
    if (tr.waitMinutes < minWait) belowMin = true;
    else if (tr.waitMinutes < RISK_WAIT_THRESHOLD) risky = true;
    if (tr.waitMinutes > LONG_WAIT_THRESHOLD) longWait = true;
  }

  return { transfers: j.transfers.length, totalMinutes: total, belowMin, risky, longWait };
}

/** 行程的去重键：车次序列 + 每程上下车站 */
export function journeyKey(j: Journey): string {
  return j.legs.map((l) => `${l.trainNo}:${l.fromStation}-${l.toStation}:${l.startTime}`).join('|');
}

/** 去重（保留首次出现的） */
export function dedupeJourneys(js: Journey[]): Journey[] {
  const seen = new Set<string>();
  const out: Journey[] = [];
  for (const j of js) {
    const k = journeyKey(j);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}

/** 加权分（D63）：总耗时 + 换乘次数惩罚；分越小越优 */
export function weightedScore(j: Journey): number {
  const s = journeyFlags(j);
  return s.totalMinutes + s.transfers * TRANSFER_PENALTY_MINUTES;
}

/** 按加权分升序排序（D63 默认） */
export function sortJourneys(js: Journey[]): Journey[] {
  return [...js].sort((a, b) => weightedScore(a) - weightedScore(b));
}

/** 上限截断（T45）：去重 → 按加权排序 → 取前 M 条 */
export function capJourneys(js: Journey[], max = 200): Journey[] {
  return sortJourneys(dedupeJourneys(js)).slice(0, max);
}
