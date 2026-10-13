import { dayOffset } from '../lib/view.ts';

interface Props {
  fromStation: string;
  toStation: string;
  startTime: string;
  arriveTime: string;
  duration: string;
}

/**
 * 直达、方案摘要和每程详情共用；站名可换行，时刻保持完整。
 *
 * 跨天（T44）：到达时刻数值可小于发车（如 19:10 发、次日 07:31 到），故按
 * **历时**反推天数，在到达时刻右上角标 `+N`（12306 风格）。
 */
export default function JourneyTimes({ fromStation, toStation, startTime, arriveTime, duration }: Props) {
  const days = dayOffset(startTime, arriveTime, duration);
  return (
    <div className="journey-times" role="group" aria-label="行程时间">
      <div className="journey-end"><strong>{startTime}</strong><span>{fromStation}</span></div>
      <div className="journey-duration"><span aria-label="历时">{duration}</span><i aria-hidden="true" /></div>
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
