/**
 * 解析层 —— 把 12306 原始 JSON 转成领域模型（纯函数）
 *
 * 全部在前端执行（T1 薄管道）：Worker 只转发原始 JSON，解析在这里。
 * 本文件无副作用、无网络，可直接单测。
 */

import { COL, SEAT_COLUMNS, NO_TICKET } from '../../shared/constants.js';

/**
 * 解析 leftTicket 的一行（58 列 `|` 分隔）。
 * @param {string} row
 * @returns {import('../../shared/types.js').Train}
 */
export function parseTrainRow(row) {
  const f = row.split('|');
  const seats = SEAT_COLUMNS.map((col) => {
    const raw = f[col.index] ?? '';
    return {
      code: col.code,
      name: col.name,
      available: raw !== '' && raw !== NO_TICKET,
      count: /^\d+$/.test(raw) ? Number(raw) : null,
      raw,
    };
  });
  return {
    trainNo: f[COL.trainNo],
    trainCode: f[COL.trainCode],
    fromStation: f[COL.fromStationCode],
    toStation: f[COL.toStationCode],
    startTime: f[COL.startTime],
    arriveTime: f[COL.arriveTime],
    duration: f[COL.duration],
    trainDate: f[COL.trainDate],
    fromStationNo: f[COL.fromStationNo],
    toStationNo: f[COL.toStationNo],
    secretStr: f[COL.secretStr],
    seats,
  };
}

/**
 * 解析余票接口响应。
 *
 * ⚠️ 空 data 是**正常结果**（无车次），不是错误（5.11）。
 *
 * @param {any} raw 上游原始 JSON
 * @returns {{trains: import('../../shared/types.js').Train[], stationMap: Record<string,string>}}
 */
export function parseLeftTicket(raw) {
  const d = raw?.data;
  const result = Array.isArray(d?.result) ? d.result : [];
  return {
    trains: result.map(parseTrainRow),
    stationMap: d?.map || {},
  };
}

/**
 * 解析中转接口的一个方案（middleList 项）。
 * @param {any} item
 * @returns {import('../../shared/types.js').TransferPlan}
 */
export function parseTransferItem(item) {
  return {
    fromStation: item.from_station_name,
    middleStation: item.middle_station_name,
    endStation: item.end_station_name,
    firstTrainNo: item.first_train_no,
    secondTrainNo: item.second_train_no,
    startTime: item.start_time,
    arriveTime: item.arrive_time,
    waitMinutes: Number(item.wait_time_minutes) || 0,
    totalMinutes: Number(item.all_lishi_minutes) || 0,
    sameStation: item.same_station === 'Y',
    sameTrain: item.same_train === 'Y',
    score: Number(item.score) || 0,
  };
}

/**
 * 解析中转接口响应。
 * @param {any} raw
 * @returns {{plans: import('../../shared/types.js').TransferPlan[], middleStationList: string[]}}
 */
export function parseTransfer(raw) {
  const d = raw?.data;
  const list = Array.isArray(d?.middleList) ? d.middleList : [];
  return {
    plans: list.map(parseTransferItem),
    middleStationList: Array.isArray(d?.middleStationList) ? d.middleStationList : [],
  };
}

/**
 * 从官方响应里抽出候选枢纽码（D10：官方种子 + 内置兜底）。
 * `middleStationList` 形如 `['BME#白马北', 'CNW#成都南']`。
 * @param {string[]} middleStationList
 * @returns {string[]} 去重后的站码
 */
export function extractHubCodes(middleStationList) {
  const codes = (middleStationList || [])
    .map((s) => String(s).split('#')[0].trim())
    .filter(Boolean);
  return [...new Set(codes)];
}
