/**
 * 视图模型（纯函数）
 *
 * 从原 render.ts 抽出：把领域数据转成「渲染所需的形状」，
 * 但不产出 HTML —— 组件据此选 antd 组件的 props / color。
 * 保持纯函数便于单测（T21）。
 */

import type { PlanFlags, PlanGroup } from '../../shared/types.ts';

/** 中转每程的席别编码 → 中文名 */
export const LEG_SEAT_NAMES: Record<string, string> = {
  ZE: '二等座',
  ZY: '一等座',
  SWZ: '商务座',
  WZ: '无座',
};

/** 站名：优先用映射表，回退站码 */
export function nameOf(code: string, map?: Record<string, string>): string {
  return map?.[code] ?? code ?? '';
}

/**
 * 始发/终到与上下车不同时，生成标注。
 * 例：['始发 北京', '终到 杭州东']
 */
export function viaTags(
  startStation: string,
  endStation: string,
  fromStation: string,
  toStation: string,
): string[] {
  const via: string[] = [];
  if (startStation && startStation !== fromStation) via.push(`始发 ${startStation}`);
  if (endStation && endStation !== toStation) via.push(`终到 ${endStation}`);
  return via;
}

/** 席别标签的状态：off 无票 / on 有票 / hl 有票且为用户所选席别 */
export type SeatState = 'off' | 'on' | 'hl';

/** 席别标签的渲染数据；返回 null 表示不展示（'--' 或空） */
export interface SeatLabel {
  text: string;
  state: SeatState;
}

/**
 * 余票原始值 → 标签数据。
 * `'无'` 无票 / 纯数字 `N 张` / `'有'` 有票 / `'--'` 与空不展示。
 */
export function seatLabel(name: string, raw: string | undefined, highlight = false): SeatLabel | null {
  const v = String(raw ?? '').trim();
  if (!v || v === '--') return null;
  if (v === '无') return { text: `${name} 无`, state: 'off' };
  const text = /^\d+$/.test(v) ? `${name} ${v} 张` : `${name} 有`;
  return { text, state: highlight ? 'hl' : 'on' };
}

/** 方案标记的类别 */
export type FlagKind = 'bad' | 'risky' | 'long' | 'ok';

/** 方案标记的渲染数据 */
export interface FlagItem {
  label: string;
  kind: FlagKind;
}

/** 把 PlanFlags 转成要展示的标签列表（顺序固定） */
export function planFlags(f: PlanFlags): FlagItem[] {
  const items: FlagItem[] = [];
  if (f.belowMin) items.push({ label: '低于换乘下限', kind: 'bad' });
  if (f.risky) items.push({ label: '换乘紧张', kind: 'risky' });
  if (f.longWait) items.push({ label: '超长等待', kind: 'long' });
  if (f.sameTrain) items.push({ label: '同车接续', kind: 'ok' });
  return items;
}

/** 换乘等待行的警示级别 */
export function waitSeverity(f: PlanFlags): 'warn' | 'dim' | '' {
  return f.risky || f.belowMin ? 'warn' : f.longWait ? 'dim' : '';
}

/** 按换乘枢纽分组（D28），返回 [枢纽名, 该枢纽的方案列表] */
export function groupByHub(groups: PlanGroup[]): Array<[hub: string, list: PlanGroup[]]> {
  const byHub = new Map<string, PlanGroup[]>();
  for (const g of groups) {
    for (const ms of g.middleStations) {
      const list = byHub.get(ms.name);
      if (list) list.push(g);
      else byHub.set(ms.name, [g]);
    }
  }
  return [...byHub.entries()];
}

/**
 * 价格 → 展示文案。
 *
 * 整数不带小数（`¥626`），非整数保留一位（`¥177.5`）。未查到返回空串。
 */
export function priceLabel(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '';
  return Number.isInteger(price) ? `¥${price}` : `¥${price.toFixed(1)}`;
}
