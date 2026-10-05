/**
 * 日期工具（纯函数，从 main.ts 抽出）
 *
 * 时区口径：12306 按北京时间（UTC+8）计算「今天」，故先把 epoch 加 8 小时后
 * 取 UTC 日期部分。`now` 参数可注入，便于单测（否则结果随当前时间漂移）。
 */

import { PRESALE_DAYS } from '../../shared/constants.ts';

/** 东八区偏移（毫秒） */
const TZ_OFFSET = 8 * 3600e3;

/** 把 epoch 毫秒转成北京时间的 'YYYY-MM-DD' */
function beijingDate(ms: number): string {
  return new Date(ms + TZ_OFFSET).toISOString().slice(0, 10);
}

/** 默认日期 = 明天（今天 + 1 天） */
export function defaultDate(now: number = Date.now()): string {
  return beijingDate(now + 86400e3);
}

/** 校验日期在预售期内（D32），返回错误文案或 null */
export function checkDate(date: string, now: number = Date.now()): string | null {
  const today = beijingDate(now);
  const max = beijingDate(now + PRESALE_DAYS * 86400e3);
  if (date < today) return '日期早于今天，无法查询';
  if (date > max) return `尚未开售：仅可查询 ${today} ~ ${max}`;
  return null;
}
