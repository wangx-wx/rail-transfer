/**
 * 渲染层 —— 纯函数生成 HTML 字符串（便于测试）
 *
 * 界面决策：D26 单页表单 / D27 直达-中转标签页 / D28 按枢纽分组折叠 / D9 展示票-席别-价格
 */

/** 转义 HTML，防止站名等字段注入 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 把 'HH:MM' 转成当天分钟数，用于时段过滤 */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

/** 时段过滤（D26） */
export const PERIODS = {
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 18 * 60],
  evening: [18 * 60, 24 * 60],
};

/**
 * 按出发时段过滤车次。
 * @param {any[]} trains
 * @param {string} period
 */
export function filterByPeriod(trains, period) {
  const range = PERIODS[period];
  if (!range) return trains;
  return trains.filter((t) => {
    const m = toMinutes(t.startTime);
    return m >= range[0] && m < range[1];
  });
}

/**
 * 渲染直达车次列表。
 * @param {any[]} trains
 * @param {Record<string,string>} stationMap
 * @param {string} seatCode 高亮席别
 */
export function renderTrains(trains, stationMap = {}, seatCode = 'ZE') {
  if (!trains.length) return '<div class="empty">没有直达车次</div>';
  return trains
    .map((t) => {
      const seat = t.seats.find((s) => s.code === seatCode);
      const seatText = !seat
        ? ''
        : seat.available
          ? `<span class="tag on">${esc(seat.name)}${seat.count !== null ? ' ' + seat.count + ' 张' : ' 有票'}</span>`
          : `<span class="tag off">${esc(seat.name)} 无票</span>`;
      return `<div class="card">
        <div class="head">
          <span class="train">${esc(t.trainCode)}</span>
          <span class="time">${esc(t.startTime)} → ${esc(t.arriveTime)}　历时 ${esc(t.duration)}</span>
        </div>
        <div class="time">${esc(stationMap[t.fromStation] || t.fromStation)} → ${esc(stationMap[t.toStation] || t.toStation)}</div>
        <div class="seats">${seatText}</div>
      </div>`;
    })
    .join('');
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
          const f = g.best.flags || {};
          const flags = [
            f.belowMin ? '<span class="flag bad">低于换乘下限</span>' : '',
            f.risky ? '<span class="flag risky">换乘紧张</span>' : '',
            f.longWait ? '<span class="flag long">超长等待</span>' : '',
            f.sameTrain ? '<span class="flag">同车接续</span>' : '',
          ].join(' ');
          const mss = g.middleStations.map((m) => `${esc(m.name)}(${m.waitMinutes}分)`).join(' / ');
          return `<div class="card">
            <div class="head">
              <span class="train">${esc(g.firstTrainCode)} → ${esc(g.secondTrainCode)}</span>
              <span class="time">总耗时 ${g.best.totalMinutes} 分</span>
            </div>
            <div class="time">经 ${mss}</div>
            <div class="seats">${flags}${g.count > 1 ? ` <span class="tag">${g.count} 个换乘站</span>` : ''}</div>
          </div>`;
        })
        .join('');
      return `<details class="hub-group" open>
        <summary>${esc(hub)}（${list.length} 个方案）</summary>
        ${cards}
      </details>`;
    })
    .join('');
}
