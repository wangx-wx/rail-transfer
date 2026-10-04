/**
 * 渲染层 —— 纯函数生成 HTML 字符串（便于测试）
 *
 * 界面决策：D26 单页表单 / D28 按枢纽分组折叠 / D9 展示票-席别-价格
 * 车站展示：区分「始发/终到」与「上车/下车」（见 spec/技术方案.md §5.1）
 */

import type { PlanGroup, Train, TransferLeg } from '../../shared/types.ts';

/** 席别编码 → 中文名（中转每程的余票字段） */
const LEG_SEAT_NAMES: Record<string, string> = {
  ZE: '二等座',
  ZY: '一等座',
  SWZ: '商务座',
  WZ: '无座',
};

/** 转义 HTML，防止站名等字段注入 */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });
}

/**
 * 把余票原始值渲染成标签。
 * `'无'` 无票 / 纯数字 N 张 / `'有'` 有票 / `'--'` 不适用
 *
 * @param name 席别名
 * @param raw 原始值
 * @param highlight 是否高亮（用户选中席别）
 */
export function seatTag(name: string, raw: string | undefined, highlight = false): string {
  const v = String(raw ?? '').trim();
  if (!v || v === '--') return '';
  if (v === '无') return `<span class="seat off">${esc(name)} 无</span>`;
  const cls = highlight ? 'seat on hl' : 'seat on';
  const text = /^\d+$/.test(v) ? `${v} 张` : '有';
  return `<span class="${cls}">${esc(name)} ${text}</span>`;
}

/** 站名：优先用映射表，回退站码 */
const nameOf = (code: string, map: Record<string, string> | undefined): string => map?.[code] ?? code ?? '';

/** 渲染一行「车站 + 时刻」。 */
function timeStation(time: string, station: string, cls = ''): string {
  return `<div class="ts ${cls}">
    <div class="t">${esc(time || '--:--')}</div>
    <div class="s">${esc(station)}</div>
  </div>`;
}

/** 始发/终到与上下车不同时，生成标注片段 */
function viaTags(startStation: string, endStation: string, fromStation: string, toStation: string): string[] {
  const via: string[] = [];
  if (startStation && startStation !== fromStation) via.push(`始发 ${startStation}`);
  if (endStation && endStation !== toStation) via.push(`终到 ${endStation}`);
  return via;
}

/**
 * 渲染直达车次列表。
 *
 * 展示：车次、始发→终到（若与上下车不同则标注）、上车→下车、发到时刻、历时、席别余票。
 */
export function renderTrains(
  trains: Train[],
  stationMap: Record<string, string> = {},
  seatCode = 'ZE',
): string {
  if (!trains.length) return '<div class="empty">没有直达车次</div>';
  return trains
    .map((t) => {
      const from = nameOf(t.fromStation, stationMap);
      const to = nameOf(t.toStation, stationMap);
      const via = viaTags(
        nameOf(t.startStation, stationMap),
        nameOf(t.endStation, stationMap),
        from,
        to,
      );

      const seats = t.seats
        .map((s) => seatTag(s.name, s.raw, s.code === seatCode))
        .filter(Boolean)
        .join('');

      return `<div class="train-card">
        <div class="train-code">${esc(t.trainCode)}</div>
        <div class="route">
          ${timeStation(t.startTime, from, 'dep')}
          <div class="arrow"><span class="line"></span><span class="dur">${esc(t.duration)}</span></div>
          ${timeStation(t.arriveTime, to, 'arr')}
        </div>
        <div class="train-meta">
          ${via.length ? `<span class="via">${via.map(esc).join(' · ')}</span>` : ''}
          <div class="seats">${seats || '<span class="seat off">无票</span>'}</div>
        </div>
      </div>`;
    })
    .join('');
}

/** 渲染一程（中转的一段）。 */
function renderLeg(leg: TransferLeg, no: number): string {
  const via = viaTags(leg.startStation, leg.endStation, leg.fromStation, leg.toStation);
  const seats = Object.entries(leg.seats)
    .map(([code, raw]) => seatTag(LEG_SEAT_NAMES[code] ?? code, raw))
    .filter(Boolean)
    .join('');

  return `<div class="leg">
    <div class="leg-no">${no}</div>
    <div class="leg-body">
      <div class="leg-head">
        <span class="train-code sm">${esc(leg.trainCode)}</span>
        ${via.length ? `<span class="via">${via.map(esc).join(' · ')}</span>` : ''}
      </div>
      <div class="route">
        ${timeStation(leg.startTime, leg.fromStation, 'dep')}
        <div class="arrow"><span class="line"></span><span class="dur">${esc(leg.duration)}</span></div>
        ${timeStation(leg.arriveTime, leg.toStation, 'arr')}
      </div>
      ${seats ? `<div class="seats">${seats}</div>` : ''}
    </div>
  </div>`;
}

/** 渲染中转方案，按换乘枢纽分组折叠（D28）。 */
export function renderTransfers(groups: PlanGroup[]): string {
  if (!groups.length) return '<div class="empty">没有中转方案</div>';

  // 按换乘站分组
  const byHub = new Map<string, PlanGroup[]>();
  for (const g of groups) {
    for (const ms of g.middleStations) {
      const list = byHub.get(ms.name);
      if (list) list.push(g);
      else byHub.set(ms.name, [g]);
    }
  }

  return [...byHub.entries()]
    .map(([hub, list]) => {
      const cards = list
        .map((g) => {
          const p = g.best;
          const f = p.flags;
          const flags = [
            f.belowMin ? '<span class="flag bad">低于换乘下限</span>' : '',
            f.risky ? '<span class="flag risky">换乘紧张</span>' : '',
            f.longWait ? '<span class="flag long">超长等待</span>' : '',
            f.sameTrain ? '<span class="flag ok">同车接续</span>' : '',
          ].join('');

          const waitCls = f.risky || f.belowMin ? 'warn' : f.longWait ? 'dim' : '';
          const waitRow = `<div class="wait ${waitCls}">
            <span class="wait-icon">↕</span>
            换乘 <b>${esc(p.middleStation)}</b>　等待 ${p.waitMinutes} 分
            ${p.sameStation ? '<span class="tag">同站</span>' : '<span class="tag">同城异站</span>'}
            ${p.sameTrain ? '<span class="tag ok">同车接续</span>' : ''}
          </div>`;

          // 逐程渲染，两程之间插入等待行（显式拼接，不用正则）
          const legsWithWait = p.legs
            .map((leg, i) => renderLeg(leg, i + 1) + (i === 0 ? waitRow : ''))
            .join('');

          return `<div class="transfer-card">
            <div class="transfer-head">
              <span class="od">${esc(p.fromStation)} → ${esc(p.endStation)}</span>
              <span class="total">总耗时 ${p.totalMinutes} 分</span>
            </div>
            ${legsWithWait}
            ${flags ? `<div class="flags">${flags}</div>` : ''}
          </div>`;
        })
        .join('');
      return `<details class="hub-group" open>
        <summary>${esc(hub)}<span class="count">${list.length} 个方案</span></summary>
        ${cards}
      </details>`;
    })
    .join('');
}
