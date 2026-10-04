/**
 * 决策常量 —— 前端与 Worker 共享
 *
 * 来源：spec/产品方案.md（D-xx）与 spec/技术方案.md（T-xx）。
 * 修改此处等于修改决策，须同步更新两份 spec 文档。
 */

// ── 上游接口白名单（T3：不做开放代理）──────────────────────
export const KYFW = 'https://kyfw.12306.cn';

/** 允许 Worker 转发的上游路径（T3）。白名单之外一律拒绝。 */
export const ALLOWED_PATHS = [
  '/otn/leftTicket/init',
  '/otn/leftTicket/queryG',
  '/lcquery/queryG',
  '/otn/czxx/queryByTrainNo',
  '/otn/leftTicket/queryTicketPrice',
] as const;

/** 伪装 UA —— 12306 对无 UA 请求会返回 error.html */
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── 换乘时间窗（D13 / D14 / D17）──────────────────────────
/** 同站换乘最小等待（分钟） */
export const MIN_WAIT_SAME_STATION = 15;
/** 同城异站换乘最小等待（分钟） */
export const MIN_WAIT_CROSS_STATION = 60;
/** 超过此等待标记「超长等待」并默认折叠（分钟） */
export const LONG_WAIT_THRESHOLD = 120;
/** 低于此等待打风险标记（分钟） */
export const RISK_WAIT_THRESHOLD = 20;

// ── 请求编排（D37 / T11 / T12）────────────────────────────
/** 每个分段查询的枢纽数（T11） */
export const HUBS_PER_SEGMENT = 6;
/** Workers Free 版子请求上限，缓存调用共享此配额（4.1） */
export const MAX_SUBREQUESTS = 50;

// ── 预售期（D32）─────────────────────────────────────────
/** 可查询的最大天数（今天 ~ 今天+14） */
export const PRESALE_DAYS = 14;

// ── 枢纽兜底清单（D10：官方种子 + 内置兜底）──────────────
/**
 * 全国主要换乘枢纽。官方 `middleStationList` 在弱线路上只给 1 个候选（5.9），
 * 用此清单兜底，保证枚举广度。
 */
export const FALLBACK_HUBS = [
  'VNP', // 北京南
  'BXP', // 北京西
  'TJP', // 天津
  'JGK', // 济南西
  'UUH', // 徐州东
  'NKH', // 南京南
  'AOH', // 上海虹桥
  'HGH', // 杭州东
  'ENH', // 合肥南
  'WHN', // 武汉
  'ZAF', // 郑州东
  'SJP', // 石家庄
  'CWQ', // 长沙南
  'EAY', // 西安北
  'ICW', // 成都东
  'CUW', // 重庆北
  'IZQ', // 广州南
  'IOQ', // 深圳北
  'NXG', // 南昌西
  'FZS', // 福州
];

// ── 席别（D9 / D26）──────────────────────────────────────
/** 界面可选席别（对应 SEAT_COLUMNS 的 code） */
export const SEAT_OPTIONS = [
  { code: 'ZE', name: '二等座' },
  { code: 'ZY', name: '一等座' },
  { code: 'SWZ', name: '商务座' },
  { code: 'WZ', name: '无座' },
];

// ── leftTicket 响应列位映射 ──────────────────────────────
/**
 * leftTicket/queryG 的 `result[]` 是 58 列 `|` 分隔字符串。
 * 以下为座位余票列（0-indexed）。
 *
 * ⚠️ 开放项：席别编码无权威文档（产品方案开放项 2）。
 * 已用 spike/tickets.json 实测确认的列见 `confirmed`；其余按经典映射推测，待实测反推。
 * 值为「无」表示无票，纯数字表示余票数，其他（如「有」）表示有票但未公开数量。
 */
/** 座位列定义 */
export interface SeatColumn {
  /** leftTicket result[] 的列索引（0-indexed） */
  index: number;
  /** 席别编码 */
  code: string;
  /** 席别中文名 */
  name: string;
  /** 是否已用实测样本确认（false = 经典映射推测，待反推） */
  confirmed: boolean;
}

export const SEAT_COLUMNS: readonly SeatColumn[] = [
  { index: 26, code: 'WZ', name: '无座', confirmed: true },
  { index: 29, code: 'YZ', name: '硬座', confirmed: false },
  { index: 28, code: 'YW', name: '硬卧', confirmed: false },
  { index: 23, code: 'GR', name: '高级软卧', confirmed: false },
  { index: 33, code: 'TZ', name: '特等座', confirmed: false },
  { index: 32, code: 'SWZ', name: '商务座', confirmed: true },
  { index: 31, code: 'ZY', name: '一等座', confirmed: true },
  { index: 30, code: 'ZE', name: '二等座', confirmed: true },
];

/** 列位映射中其他字段（非座位） */
export const COL = {
  secretStr: 0,
  trainNo: 2,
  trainCode: 3,
  /** 始发站码（非上车站） */
  startStationCode: 4,
  /** 终到站码（非下车站） */
  endStationCode: 5,
  /** 上车站码 */
  fromStationCode: 6,
  /** 下车站码 */
  toStationCode: 7,
  startTime: 8,
  arriveTime: 9,
  duration: 10,
  trainDate: 13,
  fromStationNo: 16,
  toStationNo: 17,
} as const;

/** 无票标记 */
export const NO_TICKET = '无';
