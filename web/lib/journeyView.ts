/**
 * 自研行程视图模型（纯函数，D63）
 *
 * 按换乘次数分组（直达不在此列——自研只产出 2 段及以上的行程）。
 */

import type { ScoredJourney } from './selfbuilt.ts';

/** 一个换乘次数分组 */
export interface TransferGroup {
  transfers: number;
  journeys: ScoredJourney[];
}

/** 按换乘次数分组，组内保持传入顺序，组间按换乘次数升序 */
export function groupByTransfers(js: ScoredJourney[]): TransferGroup[] {
  const map = new Map<number, ScoredJourney[]>();
  for (const j of js) {
    const list = map.get(j.transfersCount);
    if (list) list.push(j);
    else map.set(j.transfersCount, [j]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([transfers, journeys]) => ({ transfers, journeys }));
}

const CN: Record<number, string> = { 1: '一次换乘', 2: '两次换乘' };

/** 换乘次数 → 分组标题 */
export function journeyTitle(transfers: number): string {
  return CN[transfers] ?? `${transfers} 次换乘`;
}
