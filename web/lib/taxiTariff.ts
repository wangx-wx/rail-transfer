/**
 * 城市出租车计价表（D76 兜底口径）
 *
 * 腾讯驾车响应里的 `taxi_fare` 并非必有字段，缺失时按本表沿里程推算，
 * UI 标「估算」，与腾讯的「路况估算」在界面上必须可区分（D76）。
 *
 * ⚠️ **人工维护的数据**：各城市调价后需更新。单元为元 / 公里。
 * 未收录的城市**不给价**——宁可不显示，也不拿别的城市的价格瞎估。
 */

/** 一个城市的出租车计价规则 */
export interface TaxiTariff {
  /** 起步价（元） */
  baseFare: number;
  /** 起步价含的里程（公里） */
  includedKm: number;
  /** 超出起步里程后的每公里单价（元） */
  perKm: number;
  /** 燃油附加费（元）；多数城市已并入运价，无则 0 */
  fuelSurcharge: number;
  /** 夜间加价比例（对超出起步里程部分）；无夜间加价则 0 */
  nightRatio: number;
}

/** 夜间时段（D76：按出发时刻判定，22:00~06:00 跨零点） */
export const NIGHT_START_MINUTES = 22 * 60;
export const NIGHT_END_MINUTES = 6 * 60;

/**
 * 已收录城市的计价规则（键为 `STATION_CITIES` 里的城市名）。
 *
 * 目前只收录已核对过的城市；扩充时逐条补，不要按「大致同类城市」外推。
 */
export const TAXI_TARIFF: Record<string, TaxiTariff> = {
  // 北京：13 元含 3 公里，超出 2.3 元/公里，燃油附加 1 元，夜间上浮 20%
  北京: { baseFare: 13, includedKm: 3, perKm: 2.3, fuelSurcharge: 1, nightRatio: 0.2 },
};

/** 出发时刻是否落在夜间时段（`HH:MM`；无法解析时按日间处理） */
export function isNightDeparture(time: string | undefined): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time ?? '').trim());
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= NIGHT_START_MINUTES || minutes < NIGHT_END_MINUTES;
}

/**
 * 按计价规则沿里程推算车费（元，取整到元）。
 *
 * 里程向上取到 0.1 公里档——计价器按 100 米跳表，直接按精确里程算会偏低。
 */
export function estimateTaxiFare(
  tariff: TaxiTariff,
  meters: number,
  night = false,
): number {
  const km = Math.ceil(meters / 100) / 10;
  const charged = Math.max(0, km - tariff.includedKm) * tariff.perKm;
  const nightExtra = night ? charged * tariff.nightRatio : 0;
  return Math.round(tariff.baseFare + charged + nightExtra + tariff.fuelSurcharge);
}
