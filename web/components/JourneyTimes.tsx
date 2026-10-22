import { dayOffset, durationLabel } from '../lib/view.ts';

interface Props {
  fromStation: string;
  toStation: string;
  startTime: string;
  arriveTime: string;
  /** 历时，`HH:MM` 形式（直达车次用） */
  duration?: string;
  /**
   * 历时，分钟数（中转与自研用）。
   *
   * D79：此前调用方传的是 `durationLabel()` 的产物「6时20分」，`dayOffset`
   * 的 `HH:MM` 正则匹配不上，跨 2 天以上一律退化成 +1。传分钟数即可算准。
   * 两者同时给出时以 `durationMinutes` 为准。
   */
  durationMinutes?: number;
}

/**
 * 直达、方案摘要和每程详情共用；站名可换行，时刻保持完整。
 *
 * 跨天（T44）：到达时刻数值可小于发车（如 19:10 发、次日 07:31 到），故按
 * **历时**反推天数，在到达时刻右上角标 `+N`（12306 风格）。
 */
export default function JourneyTimes({
  fromStation,
  toStation,
  startTime,
  arriveTime,
  duration,
  durationMinutes,
}: Props) {
  const days = durationMinutes != null
    ? dayOffsetFromMinutes(startTime, arriveTime, durationMinutes)
    : dayOffset(startTime, arriveTime, duration);
  const shown = durationMinutes != null ? durationLabel(durationMinutes) : (duration ?? '');

  return (
    <div className="journey-times" role="group" aria-label="行程时间">
      <div className="journey-end"><strong>{startTime}</strong><span>{fromStation}</span></div>
      <div className="journey-duration"><span aria-label="历时">{shown}</span><i aria-hidden="true" /></div>
      <div className="journey-end">
        <strong>
          {arriveTime}
          {days > 0 && <sup className="day-offset" aria-label={`跨${days}天`}>+{days}</sup>}
        </strong>
        <span>{toStation}</span>
      </div>
    </div>
  );
}

/**
 * 由分钟数反推跨天天数。
 *
 * 与 `dayOffset` 同口径，只是历时直接给分钟数、不经 `HH:MM` 解析——
 * 避免调用方把格式化后的文案当历时传进来。
 */
function dayOffsetFromMinutes(
  startTime: string | undefined,
  arriveTime: string | undefined,
  minutes: number,
): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((startTime ?? '').trim());
  if (m) {
    const start = Number(m[1]) * 60 + Number(m[2]);
    if (Number.isFinite(start) && Number.isFinite(minutes) && minutes >= 0) {
      return Math.floor((start + minutes) / 1440);
    }
  }
  // 发车时刻不可解析时回退到「到达 < 发车 → 1」
  const a = /^(\d{1,2}):(\d{2})$/.exec((arriveTime ?? '').trim());
  if (m && a && Number(a[1]) * 60 + Number(a[2]) < Number(m[1]) * 60 + Number(m[2])) return 1;
  return 0;
}
