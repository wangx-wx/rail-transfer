interface Props {
  fromStation: string;
  toStation: string;
  startTime: string;
  arriveTime: string;
  duration: string;
}

/** 直达、方案摘要和每程详情共用；站名可换行，时刻保持完整。 */
export default function JourneyTimes({ fromStation, toStation, startTime, arriveTime, duration }: Props) {
  return (
    <div className="journey-times" role="group" aria-label="行程时间">
      <div className="journey-end"><strong>{startTime}</strong><span>{fromStation}</span></div>
      <div className="journey-duration"><span aria-label="历时">{duration}</span><i aria-hidden="true" /></div>
      <div className="journey-end"><strong>{arriveTime}</strong><span>{toStation}</span></div>
    </div>
  );
}
