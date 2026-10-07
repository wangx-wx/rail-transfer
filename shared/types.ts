/**
 * 领域模型类型定义
 *
 * 12306 响应字段无官方文档，以下类型由实测样本反推（见 spec/技术方案.md §5.1）。
 * 字段标注「实测」的已用真实样本确认；标「推测」的按经典映射，待反推。
 */

// ── 解析后的领域模型 ─────────────────────────────────────

/** 席别中文名 */
export type SeatName = '无座' | '硬座' | '硬卧' | '高级软卧' | '特等座' | '商务座' | '一等座' | '二等座';

/** 某席别的余票状态 */
export interface SeatAvailability {
  /** 席别编码（如 'ZE'） */
  code: string;
  /** 中文名 */
  name: string;
  /** 是否有票 */
  available: boolean;
  /** 余票数；「有」类返回 null（有票但未公开数量） */
  count: number | null;
  /** 原始列值（'无' / '有' / 数字） */
  raw: string;
}

/** 一列车（已解析的 leftTicket 行） */
export interface Train {
  /** 车次编号（如 '240000G53108'） */
  trainNo: string;
  /** 车次（如 'G531'） */
  trainCode: string;
  /** 上车站码 */
  fromStation: string;
  /** 下车站码 */
  toStation: string;
  /** 始发站码（可能 ≠ 上车站） */
  startStation: string;
  /** 终到站码（可能 ≠ 下车站） */
  endStation: string;
  /** 发车时刻 'HH:MM' */
  startTime: string;
  /** 到达时刻 'HH:MM' */
  arriveTime: string;
  /** 历时 'HH:MM' */
  duration: string;
  /** 乘车日期 'YYYYMMDD' */
  trainDate: string;
  /** 出发站序（票价接口用） */
  fromStationNo: string;
  /** 到达站序（票价接口用） */
  toStationNo: string;
  /** 加密串（下单用，本工具不用于下单） */
  secretStr: string;
  /** 各席别余票 */
  seats: SeatAvailability[];
  /** 该车次的席别码串（余票响应第 35 列，如 `9MOO` / `1341`）；查价时原样回传 */
  seatTypes: string;
  /** 已查询到的价格（元）；未查为 undefined */
  price?: number;
}

/** 中转方案的一程（已解析的 fullList 项） */
export interface TransferLeg {
  trainCode: string;
  trainNo: string;
  /** 始发站名（可能 ≠ 上车站） */
  startStation: string;
  /** 终到站名（可能 ≠ 下车站） */
  endStation: string;
  /** 上车站名 */
  fromStation: string;
  /** 下车站名 */
  toStation: string;
  startTime: string;
  arriveTime: string;
  duration: string;
  /** 出发站序（票价接口用） */
  fromStationNo?: string;
  /** 到达站序（票价接口用） */
  toStationNo?: string;
  /** 该程各席别余票原始值（键为席别编码） */
  seats: Record<string, string>;
  /** 该程的席别码串（fullList.seat_types，如 `POMO`）；查价时原样回传 */
  seatTypes?: string;
  /** 已查询到的价格（元）；未查为 undefined */
  price?: number;
}

/** 一个中转方案（已解析的 middleList 项） */
export interface TransferPlan {
  fromStation: string;
  middleStation: string;
  endStation: string;
  /** 内部编号（非显示车次） */
  firstTrainNo: string;
  secondTrainNo: string;
  /** 显示车次（取自 fullList.station_train_code） */
  firstTrainCode: string;
  secondTrainCode: string;
  /** 每程详情 */
  legs: TransferLeg[];
  startTime: string;
  arriveTime: string;
  /** 换乘等待（分钟） */
  waitMinutes: number;
  /** 总耗时（分钟） */
  totalMinutes: number;
  /** 是否同站换乘（实测：same_station "0" = 同站，"1" = 同城异站） */
  sameStation: boolean;
  /** 是否同车接续 */
  sameTrain: boolean;
  /** 官方打分（黑盒，仅供参考） */
  score: number;
}

/** 方案标记（D12：只标记不删除） */
export interface PlanFlags {
  /** 低于换乘下限（物理上不可行） */
  belowMin: boolean;
  /** 换乘时间紧，有赶不上的风险 */
  risky: boolean;
  /** 超长等待，默认折叠 */
  longWait: boolean;
  /** 同车接续 */
  sameTrain: boolean;
}

/** 带标记的方案 */
export type AnnotatedPlan = TransferPlan & { flags: PlanFlags };

/** 同一车次组合合并后的一组（D16） */
export interface PlanGroup {
  firstTrainCode: string;
  secondTrainCode: string;
  firstTrainNo: string;
  secondTrainNo: string;
  /** 该组合涉及的所有换乘站 */
  middleStations: Array<{ name: string; waitMinutes: number; sameStation: boolean }>;
  /** 代表项（总耗时最小） */
  best: AnnotatedPlan;
  /** 合并了多少条方案 */
  count: number;
}

// ── 上游原始响应（部分类型，只标注用到的字段）────────────

/** 上游通用响应外壳 */
export interface UpstreamEnvelope<T> {
  /** ⚠️ 永远为 true，不能拿它判成功（见技术方案 5.11） */
  status?: boolean;
  data?: T;
  errorMsg?: string;
}

/** leftTicket 响应的 data */
export interface LeftTicketData {
  /** 58 列 `|` 分隔的车次行 */
  result?: string[];
  /** 站码 → 站名（只覆盖本次查询涉及的少数站） */
  map?: Record<string, string>;
}

/** lcquery 响应的 data */
export interface TransferData {
  middleList?: RawMiddleItem[];
  /** 官方候选枢纽，形如 `['BME#白马北']` */
  middleStationList?: string[];
}

/**
 * queryTicketPrice 响应的 data。
 *
 * 键是席别码、值是 `"¥626.0"` 形式的价格串；另有 `train_no` 与 `OT`（非价格）。
 * 席别码无权威文档，故解析时**按值取**（带 `¥` 前缀的才是价格），不按键取。
 * 实测 seat_types 传单码即可：`O`=二等座、`M`=一等座、`9`=商务座（返回键带 `A` 前缀）。
 */
export interface PriceData {
  train_no?: string;
  OT?: unknown;
  [seatCode: string]: unknown;
}

/** queryByTrainNo（经停站）响应的单项（只标注用到的字段） */
export interface RawStopoverStation {
  /** 站名（⚠️ 可能是城市名，如「广州」实为广州南；候选站定位用 station_no 而非此字段） */
  station_name: string;
  /** 站序（'01'、'02'…，与 leftTicket 的 from/to_station_no 同源） */
  station_no: string;
  /** 到达时刻；始发站为 '----' */
  arrive_time?: string;
  /** 发车时刻；终到站为 '----' */
  start_time?: string;
}

/** lcquery 的 middleList 原始项（只标注用到的字段） */
export interface RawMiddleItem {
  from_station_name: string;
  middle_station_name: string;
  end_station_name: string;
  first_train_no: string;
  second_train_no: string;
  fullList?: RawFullListItem[];
  start_time: string;
  arrive_time: string;
  wait_time_minutes: string | number;
  all_lishi_minutes: string | number;
  /** 实测：字符串 "0"（同站）/ "1"（同城异站），不是 "Y"/"N" */
  same_station: string;
  /** 实测：字符串 "Y"/"N" */
  same_train: string;
  score?: string | number;
}

/** lcquery 的 fullList 原始项（只标注用到的字段） */
export interface RawFullListItem {
  station_train_code: string;
  train_no: string;
  start_station_name: string;
  end_station_name: string;
  from_station_name: string;
  to_station_name: string;
  start_time: string;
  arrive_time: string;
  lishi: string;
  /** 出发站序（实测存在，票价接口用） */
  from_station_no?: string;
  /** 到达站序（实测存在，票价接口用） */
  to_station_no?: string;
  /** 席别码串（如 "POMO"） */
  seat_types?: string;
  ze_num?: string;
  zy_num?: string;
  swz_num?: string;
  wz_num?: string;
}

// ── Worker 与前端之间的接口 ──────────────────────────────

/** 分段查询的单项结果（Worker → 前端） */
export interface SegmentItem<T = unknown> {
  /** 该项标识（枢纽码等） */
  key: string;
  /** 是否成功 */
  ok: boolean;
  /** 成功时的原始 JSON */
  data?: T;
  /** 失败原因（仅真错误；空 data 不算错误） */
  error?: string;
}

/** 取数层返回 */
export type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };
