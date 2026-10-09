/**
 * 自研中转列表（D63：按换乘次数分组折叠）
 *
 * 每个行程展示：各程车次、换乘站与等待、总耗时、标记（疑似绕远 / 超长等待 / 换乘紧张）。
 * 分组逻辑来自 journeyView.groupByTransfers（纯函数，已单测）。
 */

import { Button, Card, Collapse, Empty, Space, Tag } from 'antd';

import JourneyTimes from './JourneyTimes.tsx';
import { REFERENCE_SEAT_CODE } from '../../shared/constants.ts';
import { durationLabel, priceKey, priceLabel, seatPrices } from '../lib/view.ts';
import { groupByTransfers, journeyTitle } from '../lib/journeyView.ts';
import type { ScoredJourney } from '../lib/selfbuilt.ts';

interface Props {
  journeys: ScoredJourney[];
  /** 查询日期（查价用） */
  date: string;
  /** 站码 → 站名（展示用；缺省回退站码） */
  stationNames: Record<string, string>;
  /** 价格缓存（键 = priceKey → 各席别价格表） */
  prices: Record<string, Record<string, number>>;
  /** 正在查价的键 */
  loadingPrice: Set<string>;
  /** 触发查价 */
  onQueryPrice: (
    trainNo: string,
    fromStationNo: string | undefined,
    toStationNo: string | undefined,
    date: string,
    seatTypes: string,
  ) => void;
}

/** 一程 */
function Leg({ train, no, name }: { train: ScoredJourney['legs'][number]; no: number; name: (code: string) => string }) {
  return (
    <div className="transfer-leg">
      <span className="leg-index">{no}</span>
      <div className="leg-content">
        <div className="leg-heading">
          <strong>{train.trainCode}</strong>
        </div>
        <JourneyTimes
          fromStation={name(train.fromStation)}
          toStation={name(train.toStation)}
          startTime={train.startTime}
          arriveTime={train.arriveTime}
          duration={train.duration}
        />
      </div>
    </div>
  );
}

/** 一条行程卡片 */
function JourneyCard({
  journey: j,
  date,
  name,
  prices,
  loadingPrice,
  onQueryPrice,
}: { journey: ScoredJourney; date: string; name: (code: string) => string } & Pick<
  Props,
  'prices' | 'loadingPrice' | 'onQueryPrice'
>) {
  const first = j.legs[0]!;
  const last = j.legs[j.legs.length - 1]!;
  const legPrices = j.legs.map((l) => {
    const key = priceKey(l.trainNo, l.fromStationNo, l.toStationNo);
    return key ? prices[key]?.[REFERENCE_SEAT_CODE] : undefined;
  });
  const total = legPrices.length > 0 && legPrices.every((x) => x != null)
    ? legPrices.reduce((a, b) => a! + b!, 0) : null;

  return (
    <Card className="ticket-card" size="small" variant="borderless" styles={{ body: { padding: 'var(--card-padding, 20px)' } }}>
      <div className="ticket-caption">
        <span>
          {name(first.fromStation)} → {name(last.toStation)}
        </span>
        <span>总耗时 {durationLabel(j.totalMinutes)}</span>
      </div>
      <div className="ticket-main">
        <div className="train-identity">
          <strong>{j.legs.map((l) => l.trainCode).join(' → ')}</strong>
        </div>
        <JourneyTimes
          fromStation={name(first.fromStation)}
          toStation={name(last.toStation)}
          startTime={first.startTime}
          arriveTime={last.arriveTime}
          duration={durationLabel(j.totalMinutes)}
        />
        <div className="transfer-facts">
          {j.transfers.map((t, i) => (
            <div className="transfer-wait" key={`${t.station}-${i}`}>
              换乘 {name(t.station)}　等待 {durationLabel(t.waitMinutes)}
              <span className="muted">{t.sameStation ? '同站' : '同城异站'}</span>
            </div>
          ))}
        </div>
        {(j.detour || j.longWait || j.risky) && (
          <Space size={4} wrap>
            {j.detour && <Tag color="warning">疑似绕远</Tag>}
            {j.longWait && <Tag>超长等待</Tag>}
            {j.risky && <Tag color="warning">换乘紧张</Tag>}
          </Space>
        )}
        <div className="ticket-actions">
          {total != null ? (
            <span className="ref-price">
              <strong className="total-price">二等座参考价 {priceLabel(total)}</strong>
              <span className="price-breakdown">{legPrices.map((x) => priceLabel(x)).join(' + ')}</span>
            </span>
          ) : (
            <span className="muted">展开两程查价</span>
          )}
        </div>
      </div>
      <details className="journey-details">
        <summary>完整行程</summary>
        <div className="transfer-legs">
          {j.legs.map((l, i) => (
            <Leg key={`${l.trainNo}-${i}`} train={l} no={i + 1} name={name} />
          ))}
        </div>
        <div className="leg-prices">
          {j.legs.map((l, i) => {
            const key = priceKey(l.trainNo, l.fromStationNo, l.toStationNo);
            const map = key ? prices[key] : undefined;
            const items = seatPrices(map);
            return (
              <div className="leg-price" key={`${l.trainCode}-${i}`}>
                <span className="leg-price-code">{l.trainCode}</span>
                {items.length ? (
                  <div className="price-list" aria-label={`${l.trainCode} 各席别价格`}>
                    {items.map((p) => (
                      <div className="price-row" key={p.code}>
                        <span className="price-name">{p.name}</span>
                        <span className="price-amount">{p.label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Button
                    type="link"
                    disabled={!key || !l.seatTypes}
                    loading={key ? loadingPrice.has(key) : false}
                    onClick={() => key && onQueryPrice(l.trainNo, l.fromStationNo, l.toStationNo, date, l.seatTypes ?? '')}
                  >
                    {l.trainCode} 查价
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </Card>
  );
}

export default function SelfBuiltList({ journeys, date, stationNames, prices, loadingPrice, onQueryPrice }: Props) {
  if (!journeys.length) return <Empty description="没有自研中转方案" />;

  const name = (code: string): string => stationNames[code] ?? code;
  const groups = groupByTransfers(journeys);

  const items = groups.map((g) => ({
    key: String(g.transfers),
    label: (
      <Space>
        {journeyTitle(g.transfers)}
        <Tag>{g.journeys.length} 条</Tag>
      </Space>
    ),
    children: g.journeys.map((j, i) => (
      <JourneyCard
        key={`${j.legs.map((l) => l.trainNo).join('-')}-${i}`}
        journey={j}
        date={date}
        name={name}
        prices={prices}
        loadingPrice={loadingPrice}
        onQueryPrice={onQueryPrice}
      />
    )),
  }));

  return <Collapse className="hub-list" defaultActiveKey={groups.map((g) => String(g.transfers))} items={items} />;
}
