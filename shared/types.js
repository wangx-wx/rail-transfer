/**
 * 领域模型类型定义（JSDoc，供编辑器类型提示）
 *
 * 本项目零构建、零依赖，用 JSDoc 而非 TypeScript（见 spec/技术方案.md 的零依赖修订）。
 * 本文件只导出类型，运行时无副作用。
 */

/**
 * @typedef {'无座'|'硬座'|'硬卧'|'高级软卧'|'特等座'|'商务座'|'一等座'|'二等座'} SeatName
 */

/**
 * 某席别的余票状态。
 * @typedef {Object} SeatAvailability
 * @property {string} code     席别编码（如 'ZE'）
 * @property {SeatName} name   中文名
 * @property {boolean} available 是否有票
 * @property {number|null} count 余票数；'有' 类返回 null（有票但未公开数量）
 * @property {string} raw      原始列值（'无' / '有' / 数字）
 */

/**
 * 一列车（已解析的 leftTicket 行）。
 * @typedef {Object} Train
 * @property {string} trainNo      车次编号（如 '240000G53108'）
 * @property {string} trainCode    车次（如 'G531'）
 * @property {string} fromStation  出发站码
 * @property {string} toStation    到达站码
 * @property {string} startTime    发车时刻 'HH:MM'
 * @property {string} arriveTime   到达时刻 'HH:MM'
 * @property {string} duration     历时 'HH:MM'
 * @property {string} trainDate    乘车日期 'YYYYMMDD'
 * @property {string} fromStationNo 出发站序（票价接口用）
 * @property {string} toStationNo   到达站序（票价接口用）
 * @property {string} secretStr    加密串（下单用，本工具不用于下单）
 * @property {SeatAvailability[]} seats 各席别余票
 */

/**
 * 一个中转方案（已解析的 middleList 项）。
 * @typedef {Object} TransferPlan
 * @property {string} fromStation      出发站名
 * @property {string} middleStation    换乘站名
 * @property {string} endStation       终点站名
 * @property {string} firstTrainNo     第一程车次编号
 * @property {string} secondTrainNo    第二程车次编号
 * @property {string} startTime        第一程发车
 * @property {string} arriveTime       第二程到达
 * @property {number} waitMinutes      换乘等待（分钟）
 * @property {number} totalMinutes     总耗时（分钟）
 * @property {boolean} sameStation     是否同站换乘
 * @property {boolean} sameTrain       是否同车接续
 * @property {number} score            官方打分（黑盒，仅供参考）
 */

/**
 * 分段查询的单项结果（Worker → 前端）。
 * @template T
 * @typedef {Object} SegmentItem
 * @property {string} key     该项标识（枢纽码等）
 * @property {boolean} ok     是否成功
 * @property {T} [data]       成功时的原始 JSON
 * @property {string} [error] 失败原因（仅真错误；空 data 不算错误）
 */

export {};
