/**
 * 渲染层 —— 纯函数生成 HTML 字符串（便于测试）
 *
 * 界面决策：D26 单页表单 / D28 按枢纽分组折叠 / D9 展示票-席别-价格
 * 车站展示：区分「始发/终到」与「上车/下车」（见 spec/技术方案.md §5.1）
 */

/** 转义 HTML，防止站名等字段注入 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 把余票原始值渲染成标签。
 * `'无'` 无票 / 纯数字 N 张 / `'有'` 有票 / `'--'` 不适用
 * @param {string} name 席别名
 * @param {string} raw 原始值
 * @param {boolean} highlight 是否高亮（用户选中席别）
 */
export function seatTag(name, raw, highlight = false) {
  const v = String(raw ?? '').trim();
  if (!v || v === '--') return '';
  if (v === '无') return `<span class="seat off">${esc(name)} 无</span>`;
  const cls = highlight ? 'seat on hl' : 'seat on';
  const text = /^\d+$/.test(v) ? `${v} 张` : '有';
  return `<span class="${cls}">${esc(name)} ${text}</span>`;
}

/** 站名：优先用映射表，回退站码 */
const nameOf = (code, map) => map?.[code] || code || '';

/**
 * 渲染一行「车站 + 时刻」。
 * @param {string} time
 * @param {string} station
 * @param {string} cls 附加类名
 */
function timeStation(time, station, cls = '') {
  return `<div class="ts ${cls}">
    <div class="t">${esc(time || '--:--')}</div>
    <div class="s">${esc(station)}</div>
  </div>`;
}

/**
 * 渲染直达车次列表。
 *
 * 展示：车次、始发→终到（若与上下车不同则标注）、上车→下车、发到时刻、历时、席别余票。
 *
 * @param {any[]} trains
 * @param {Record<string,string>} stationMap
 * @param {string} seatCode 高亮席别
 */
export function renderTrains(trains, stationMap = {}, seatCode = 'ZE') {
  if (!trains.length) return '<div class="empty">没有直达车次</div>';
  return trains
    .map((t) => {
      const from = nameOf(t.fromStation, stationMap);
      const to = nameOf(t.toStation, stationMap);
      const start = nameOf(t.startStation, stationMap);
      const end = nameOf(t.endStation, stationMap);
      // 始发/终到与上下车不同时，才额外标注
      const via = [];
      if (t.startStation && t.startStation !== t.fromStation) via.push(`始发 ${start}`);
      if (t.endStation && t.endStation !== t.toStation) via.push(`终到 ${end}`);

      const seats = t.seats.map((s) => seatTag(s.name, s.raw, s.code === seatCode)).filter(Boolean).join('');

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

/**
 * 渲染一程（中转的一段）。
 * @param {any} leg
 * @param {number} no 序号
 */
function renderLeg(leg, no) {
  const via = [];
  if (leg.startStation && leg.startStation !== leg.fromStation) via.push(`始发 ${leg.startStation}`);
  if (leg.endStation && leg.endStation !== leg.toStation) via.push(`终到 ${leg.endStation}`);
  const seats = Object.entries(leg.seats || {})
    .map(([code, raw]) => seatTag({ ZE: '二等座', ZY: '一等座', SWZ: '商务座', WZ: '无座' }[code] || code, raw))
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

/**
 * 渲染中转方案，按换乘枢纽分组折叠（D28）。
 * @param {ReturnType<import('./plans.js').mergePlans>} groups
 */
export function renderTransfers(groups) {
  if (!groups.length) return '<div class="empty">没有中转方案</div>';

  // 按换乘站分组
  const byHub = new Map();
  for (const g of groups) {
    for (const ms of g.middleStations) {
      if (!byHub.has(ms.name)) byHub.set(ms.name, []);
      byHub.get(ms.name).push(g);
    }
  }

  return [...byHub.entries()]
    .map(([hub, list]) => {
      const cards = list
        .map((g) => {
          const p = g.best;
          const f = p.flags || {};
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
          const legsWithWait = (p.legs || [])
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
