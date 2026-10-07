/**
 * 买短乘长编排（D22 / D45~D53）
 *
 * 「A→B 无票，但 A→X 有票，可上车补票」。
 *
 * 算法（D46/D47）：取该车 A、B 之间的经停站，**从离 B 最近的一站往回**逐个
 * 查 `A→X` 余票，**第一个有票的站即结果、停止查询**；不设站数上限。
 *
 * 纯函数 + 注入式 API，便于单测（T21）。Worker 零改动——三个端点均已存在。
 */

import { parsePrice, parseTrainRow } from './parse.ts';
import { codeOfStation } from './city.ts';
import type {
  FetchResult,
  LeftTicketData,
  PriceData,
  RawStopoverStation,
  SeatAvailability,
  Train,
  UpstreamEnvelope,
} from '../../shared/types.ts';

/** 买短乘长可注入的 API（真实实现见 App.tsx 包一层 api.ts） */
export interface BuyShortApi {
  stopover(p: {
    trainNo: string;
    fromStationNo: string;
    toStationNo: string;
    date: string;
  }): Promise<FetchResult<UpstreamEnvelope<{ data?: RawStopoverStation[] }>>>;
  leftTicket(p: {
    from: string;
    to: string;
    date: string;
  }): Promise<FetchResult<UpstreamEnvelope<LeftTicketData>>>;
  price(p: {
    trainNo: string;
    fromStationNo: string;
    toStationNo: string;
    seatTypes: string;
    date: string;
  }): Promise<FetchResult<UpstreamEnvelope<PriceData>>>;
}

/** 查询结果 */
export type BuyShortResult =
  | { kind: 'found'; stationName: string; seatName: string; price: number | null }
  | { kind: 'none' }
  | { kind: 'noCandidate' }
  | { kind: 'error'; error: string };

/**
 * 基准席别（D49/D54）：高铁看二等座 `ZE`、普速看硬座 `YZ`。
 *
 * 判定依据是车次席别码串是否含 `O`（二等座码）：高铁含、普速不含
 * （K767=`1341`，G531=`9MOO`；见技术方案 §5.3）。
 */
export function baseSeat(train: Train): SeatAvailability | null {
  const isHighSpeed = (train.seatTypes ?? '').includes('O');
  const code = isHighSpeed ? 'ZE' : 'YZ';
  return train.seats.find((s) => s.code === code) ?? null;
}

/** 该车次基准席别是否无票（决定是否提供买短乘长入口，D23） */
export function isSoldOut(train: Train): boolean {
  const s = baseSeat(train);
  return !!s && !s.available;
}

/** 界面席别码 → 价格响应里的席别码（`parsePrice` 的键，见 SEAT_CODE_NAME） */
const PRICE_CODE: Record<string, string> = { ZE: 'O', YZ: '1' };

/** 从 leftTicket 结果里找指定车次的二等/硬座余票是否可用 */
function segmentHasTicket(
  result: string[] | undefined,
  trainNo: string,
  seatCode: string,
): boolean {
  for (const row of result ?? []) {
    const t = parseTrainRow(row);
    if (t.trainNo !== trainNo) continue;
    const s = t.seats.find((x) => x.code === seatCode);
    if (s?.available) return true;
  }
  return false;
}

/**
 * 查一趟车的买短乘长方案。
 *
 * @param onProgress 每查完一个「无票」站回调（参数为累计已查站数）——D53 进度提示
 */
export async function findShortTicket(
  train: Train,
  date: string,
  api: BuyShortApi,
  opts: { onProgress?: (checked: number) => void } = {},
): Promise<BuyShortResult> {
  const fromNo = Number(train.fromStationNo);
  const toNo = Number(train.toStationNo);
  // ⚠️ 用「非空数字串」判，不能只判 Number.isFinite —— `Number('')===0` 会漏过空值
  if (!/^\d+$/.test(train.fromStationNo ?? '') || !/^\d+$/.test(train.toStationNo ?? '') || !train.fromStation) {
    return { kind: 'error', error: '缺少站序，无法查询经停' };
  }

  const seat = baseSeat(train);
  if (!seat) return { kind: 'error', error: '该车次无可用基准席别' };

  // ① 取该车完整经停序列
  let stops: RawStopoverStation[];
  try {
    const r = await api.stopover({
      trainNo: train.trainNo,
      fromStationNo: train.fromStationNo,
      toStationNo: train.toStationNo,
      date,
    });
    if (!r.ok) return { kind: 'error', error: r.error };
    stops = r.data.data?.data ?? [];
  } catch (e) {
    return { kind: 'error', error: String(e) };
  }

  // ② 取 A、B 之间的站（严格介于两者），按离 B 由近到远排序（D46）
  // ⚠️ 保留原始 station_no 字符串（两位补零）——查价接口的 to_station_no 需要
  // 补零形式（`07` 有效，`7` 返回空 data），故不能用 Number 后再 String。
  const candidates = stops
    .map((s) => ({ no: Number(s.station_no), noStr: s.station_no, name: s.station_name }))
    .filter((s) => Number.isFinite(s.no) && s.no > fromNo && s.no < toNo)
    .sort((a, b) => b.no - a.no);

  if (!candidates.length) return { kind: 'noCandidate' };

  // ③ 逐个查 A→X，命中即止
  let checked = 0;
  for (const c of candidates) {
    const target = codeOfStation(c.name);
    if (!target) {
      // 站名无法解析出站码 → 跳过（不中断）
      checked++;
      opts.onProgress?.(checked);
      continue;
    }

    let ok = false;
    try {
      const r = await api.leftTicket({ from: train.fromStation, to: target.code, date });
      ok = r.ok && segmentHasTicket(r.data.data?.result, train.trainNo, seat.code);
    } catch {
      ok = false; // 单站失败 → 跳过继续（T13 精神）
    }
    if (!ok) {
      checked++;
      opts.onProgress?.(checked);
      continue;
    }

    // ④ 命中 → 查该段价格
    let price: number | null = null;
    const pcode = PRICE_CODE[seat.code];
    if (pcode) {
      try {
        const pr = await api.price({
          trainNo: train.trainNo,
          fromStationNo: train.fromStationNo,
          toStationNo: c.noStr,
          seatTypes: train.seatTypes,
          date,
        });
        if (pr.ok) price = parsePrice(pr.data)[pcode] ?? null;
      } catch {
        /* 价格查不到不影响「有票」的结论 */
      }
    }
    return { kind: 'found', stationName: c.name, seatName: seat.name, price };
  }

  return { kind: 'none' };
}
