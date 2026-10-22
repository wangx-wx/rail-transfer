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
  /**
   * 车次，压在轨道线上（D79）。不传则只画时刻与站名——用于「整条行程」
   * 摘要行，那里车次已在上方单独列出，重复一次反而干扰。
   */
  trainCode?: string;
  /**
   * 跨天天数，由调用方按**整条行程**累计算出（D79）。
   *
   * 一程一行后，每程各自按本程历时算会漏判：北京 20:00 发、次日 06:00 到
   * 武汉，再 07:00 发、14:00 到广州——第二程自身跨 0 天，但它明明在第二天。
   * 调用方用 `dayOffsetAt` 算好传进来；不传则按本程历时自行推算。
   */
  dayOffset?: number;
}

/**
 * 一条腿一行：`发时 发站 ── 车次 ── 到时 到站`，历时在轨道线下方（D79）。
 *
 * 三个结果页共用：直达 1 段、官方中转 2 段、自研 N 段。车次压在轨道线上
 * 并用底色遮断线，是时刻表的标准写法，比「车次单独一列」更省横向空间，
 * 也让「这一行就是一程」这件事在视觉上成立。
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
  trainCode,
  dayOffset: explicitDayOffset,
}: Props) {
  const days = explicitDayOffset ?? (durationMinutes != null
    ? dayOffsetFromMinutes(startTime, arriveTime, durationMinutes)
    : dayOffset(startTime, arriveTime, duration));
  const shown = durationMinutes != null ? durationLabel(durationMinutes) : (duration ?? '');

  return (
    <div className="journey-times leg" role="group" aria-label="行程时间">
      <strong className="leg__t">{startTime}</strong>
      <span className="leg__st">{fromStation}</span>
      <span className="leg__trk">
        {trainCode && <b>{trainCode}</b>}
        <i aria-hidden="true" />
        <small aria-label="历时">{shown}</small>
      </span>
      <strong className="leg__t">
        {arriveTime}
        {days > 0 && <sup className="day-offset" aria-label={`跨${days}天`}>+{days}</sup>}
      </strong>
      <span className="leg__st">{toStation}</span>
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
