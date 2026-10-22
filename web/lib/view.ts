/**
 * 视图模型（纯函数）
 *
 * 从原 render.ts 抽出：把领域数据转成「渲染所需的形状」，
 * 但不产出 HTML —— 组件据此选 antd 组件的 props / color。
 * 保持纯函数便于单测（T21）。
 */

import { SEAT_CODE_NAME } from '../../shared/constants.ts';
import type { AnnotatedPlan, PlanFlags, PlanGroup } from '../../shared/types.ts';
import { mergePlans, sortPlans } from './plans.ts';

/** 中转每程的席别编码 → 中文名 */
export const LEG_SEAT_NAMES: Record<string, string> = {
  ZE: '二等座',
  ZY: '一等座',
  SWZ: '商务座',
  WZ: '无座',
  // D77：普速车席别——此前只有 4 个高铁席别，未映射的码会显示成原始码
  RW: '软卧',
  YW: '硬卧',
  YZ: '硬座',
  GR: '高级软卧',
};

/**
 * 卡片摘要层用的**短名**（D77）。
 *
 * 每程一行要横向排 8 个席别，全名会把一行撑到折行；短名让同一程的席别
 * 在一行内比完。展开详情里仍用全名，避免「高软」这类简称产生歧义。
 */
export const LEG_SEAT_SHORT: Record<string, string> = {
  ZE: '二等',
  ZY: '一等',
  SWZ: '商务',
  WZ: '无座',
  RW: '软卧',
  YW: '硬卧',
  YZ: '硬座',
  GR: '高软',
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
  const byHub = new Map<string, AnnotatedPlan[]>();
  for (const g of groups) {
    for (const p of g.plans) {
      const list = byHub.get(p.middleStation);
      if (list) list.push(p);
      else byHub.set(p.middleStation, [p]);
    }
  }
  return [...byHub.entries()].map(([hub, plans]) => [hub, sortPlans(mergePlans(plans))]);
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

/** 'HH:MM' → 当日分钟数；非法（含 `'----'`）返回 null */
function clockMinutes(t: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 'HH:MM' 形式的**历时** → 分钟；可超 24 小时（跨天长途，如 `27:05`）。非法返回 null */
function durationMinutes(dur: string | undefined): number | null {
  const m = /^(\d{1,3}):(\d{2})$/.exec((dur ?? '').trim());
  if (!m) return null;
  const min = Number(m[2]);
  if (min > 59) return null;
  return Number(m[1]) * 60 + min;
}

/**
 * 一程的**跨天天数**（T44 展示口径）：跨天到达时返回 ≥1 的天数，否则 0。
 *
 * ⚠️ 不能只看「到达时刻 < 发车时刻」：那会把「历时超 24h 但到达时刻数值更大」
 * 的长途车漏判（如 10:00 发、历时 27:05 → 次日 13:05 到，而 13:05 > 10:00）。
 * 故优先用**历时**反推：`天数 = floor((发车分钟 + 历时分钟) / 1440)`；缺历时或
 * 历时不足跨天时，回退到「到达 < 发车 → 至少 +1 天」。
 */
export function dayOffset(startTime: string | undefined, arriveTime: string | undefined, duration: string | undefined): number {
  const s = clockMinutes(startTime);
  const dur = durationMinutes(duration);
  if (s != null && dur != null) return Math.floor((s + dur) / 1440);
  const a = clockMinutes(arriveTime);
  if (s != null && a != null && a < s) return 1;
  return 0;
}

/**
 * 按**行程内累计分钟数**算某一点落在第几天（D79）。
 *
 * 一程一行之后，每程各自标跨天会漏判：北京 20:00 发、次日 06:00 到武汉，
 * 再 07:00 发、14:00 到广州——第二程自身只跨 0 天，但它明明在第二天。
 * 故调用方传入「发车时刻 + 从行程开始到该程到达的累计分钟数」，
 * 这里只做 `floor((当日发车分钟 + 累计) / 1440)`。
 *
 * `startTime` 是**整个行程**的发车时刻（不是本程的），`elapsedMinutes` 是
 * 从行程开始到**本程到达**的累计分钟数。
 */
export function dayOffsetAt(startTime: string | undefined, elapsedMinutes: number): number {
  const s = clockMinutes(startTime);
  if (s == null || !Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) return 0;
  return Math.floor((s + elapsedMinutes) / 1440);
}

/**
 * 分钟数 → 「x时x分」文案。
 *
 * 不足 1 小时只显示「x分」（不显示「0时」）；整小时显示「x时」。
 * 例：258 → `4时18分`；120 → `2时`；2 → `2分`。
 */
export function durationLabel(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}分`;
  if (rest === 0) return `${h}时`;
  return `${h}时${rest}分`;
}

/** 席别价格表 → 展示条目（按价格表插入顺序，只保留有价的） */
export interface SeatPriceItem {
  code: string;
  name: string;
  label: string;
}

/**
 * 席别价格的固定展示序（先高铁席别、后普速；与 `SEAT_CODE_NAME` 一致）。
 *
 * 用于把每程价格按稳定顺序排成多行，两程并排时同名席别自然对齐、便于比价。
 * 列表外的未知码排在末尾（保持接口内原序，不丢数据）。
 */
export const SEAT_PRICE_ORDER = [
  '9', 'P', 'M', 'D', 'S', 'O', '6', 'I', 'J', 'F', 'A', '4', '3', '2', '1', 'WZ', 'W',
];

/**
 * 席别价格表 → 展示条目（按 `SEAT_PRICE_ORDER` 固定排序）。
 *
 * 键为席别码（`O`/`M`/`9`/`1`/`3`…，见 `SEAT_CODE_NAME`），值为价格（元）。
 * 名字用官方表映射；未知码回退码本身（不丢数据）。
 */
export function seatPrices(map: Record<string, number> | undefined): SeatPriceItem[] {
  if (!map) return [];
  const rank = (code: string): number => {
    const i = SEAT_PRICE_ORDER.indexOf(code);
    return i < 0 ? SEAT_PRICE_ORDER.length : i;
  };
  return Object.entries(map)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([code, p]) => ({ code, name: SEAT_CODE_NAME[code] ?? code, label: priceLabel(p) }));
}

/**
 * 价格缓存的键。
 *
 * 直达车次与中转每程共用一套（都是「车次 + 起终站序」唯一确定一段行程）。
 * 站序缺失时返回 null（无法查价）。
 */
export function priceKey(
  trainNo: string,
  fromStationNo: string | undefined,
  toStationNo: string | undefined,
): string | null {
  if (!trainNo || !fromStationNo || !toStationNo) return null;
  return `${trainNo}|${fromStationNo}|${toStationNo}`;
}
