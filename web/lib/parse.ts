/**
 * 解析层 —— 把 12306 原始 JSON 转成领域模型（纯函数）
 *
 * 全部在前端执行（T1 薄管道）：Worker 只转发原始 JSON，解析在这里。
 * 本文件无副作用、无网络，可直接单测。
 */

import { COL, SEAT_COLUMNS, NO_TICKET } from '../../shared/constants.ts';
import type {
  LeftTicketData,
  PriceData,
  RawFullListItem,
  RawMiddleItem,
  Train,
  TransferData,
  TransferLeg,
  TransferPlan,
  UpstreamEnvelope,
} from '../../shared/types.ts';

/**
 * 解析 leftTicket 的一行（58 列 `|` 分隔）。
 */
export function parseTrainRow(row: string): Train {
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
    trainNo: f[COL.trainNo] ?? '',
    trainCode: f[COL.trainCode] ?? '',
    fromStation: f[COL.fromStationCode] ?? '',
    toStation: f[COL.toStationCode] ?? '',
    startStation: f[COL.startStationCode] ?? '',
    endStation: f[COL.endStationCode] ?? '',
    startTime: f[COL.startTime] ?? '',
    arriveTime: f[COL.arriveTime] ?? '',
    duration: f[COL.duration] ?? '',
    trainDate: f[COL.trainDate] ?? '',
    fromStationNo: f[COL.fromStationNo] ?? '',
    toStationNo: f[COL.toStationNo] ?? '',
    secretStr: f[COL.secretStr] ?? '',
    seats,
  };
}

/**
 * 解析余票接口响应。
 *
 * ⚠️ 空 data 是**正常结果**（无车次），不是错误（5.11）。
 */
export function parseLeftTicket(raw: UpstreamEnvelope<LeftTicketData> | undefined): {
  trains: Train[];
  stationMap: Record<string, string>;
} {
  const d = raw?.data;
  const result = Array.isArray(d?.result) ? d.result : [];
  return {
    trains: result.map(parseTrainRow),
    stationMap: d?.map ?? {},
  };
}

/**
 * 解析一程（fullList 项）的展示信息。
 */
export function parseTransferLeg(leg: RawFullListItem): TransferLeg {
  return {
    trainCode: leg.station_train_code,
    trainNo: leg.train_no,
    startStation: leg.start_station_name,
    endStation: leg.end_station_name,
    fromStation: leg.from_station_name,
    toStation: leg.to_station_name,
    startTime: leg.start_time,
    arriveTime: leg.arrive_time,
    duration: leg.lishi,
    fromStationNo: leg.from_station_no,
    toStationNo: leg.to_station_no,
    seats: {
      ZE: leg.ze_num ?? '',
      ZY: leg.zy_num ?? '',
      SWZ: leg.swz_num ?? '',
      WZ: leg.wz_num ?? '',
    },
  };
}

/**
 * 解析中转接口的一个方案（middleList 项）。
 *
 * ⚠️ `first_train_no` / `second_train_no` 是**内部编号**（如 `76000G873541`），
 * 不是显示车次。显示车次在 `fullList[i].station_train_code`（如 `G8735`）。
 * 同车接续时两程的内部编号相同。
 *
 * ⚠️ `same_station` 是字符串 `"0"`/`"1"`，**不是** `"Y"`/`"N"`：
 *   `"0"` = 同站换乘；`"1"` = 同城异站（`middle_station_name` 形如 `北京西-北京南`）。
 * 实测证据见 test/fixtures/transfer-cross-station.json。
 * `same_train` 才是 `"Y"`/`"N"`。
 */
export function parseTransferItem(item: RawMiddleItem): TransferPlan {
  const legs = Array.isArray(item.fullList) ? item.fullList : [];
  return {
    fromStation: item.from_station_name,
    middleStation: item.middle_station_name,
    endStation: item.end_station_name,
    firstTrainNo: item.first_train_no,
    secondTrainNo: item.second_train_no,
    firstTrainCode: legs[0]?.station_train_code || item.first_train_no,
    secondTrainCode: legs[1]?.station_train_code || item.second_train_no,
    legs: legs.map(parseTransferLeg),
    startTime: item.start_time,
    arriveTime: item.arrive_time,
    waitMinutes: Number(item.wait_time_minutes) || 0,
    totalMinutes: Number(item.all_lishi_minutes) || 0,
    sameStation: String(item.same_station) === '0',
    sameTrain: String(item.same_train) === 'Y',
    score: Number(item.score) || 0,
  };
}

/**
 * 解析中转接口响应。
 */
export function parseTransfer(raw: UpstreamEnvelope<TransferData> | undefined): {
  plans: TransferPlan[];
  middleStationList: string[];
} {
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
 */
export function extractHubCodes(middleStationList: string[] | undefined): string[] {
  const codes = (middleStationList ?? [])
    .map((s) => String(s).split('#')[0]?.trim() ?? '')
    .filter(Boolean);
  return [...new Set(codes)];
}

/**
 * 解析 queryTicketPrice 响应，取出价格（元）。
 *
 * 响应形如 `{"O":"¥626.0","WZ":"¥626.0","train_no":"...","OT":[]}`。
 * **按值取**：只认带 `¥` 前缀的字符串，取第一个（一次只查一个席别，故唯一）。
 * 无价格（席别不存在 / 该席别无票）时返回 null。
 */
export function parsePrice(raw: UpstreamEnvelope<PriceData> | undefined): number | null {
  const data = raw?.data;
  if (!data) return null;
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && v.startsWith('¥')) {
      const n = Number.parseFloat(v.slice(1));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
