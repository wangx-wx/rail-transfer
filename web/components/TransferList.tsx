/**
 * 中转方案列表（D28：按枢纽分组折叠，组内按耗时排序）
 *
 * 每个方案展示：起终点、总耗时、两程车次与上下车、换乘等待、标记（flags）。
 * 分组逻辑来自 view.groupByHub（纯函数，已单测）。
 */

import { Button, Card, Collapse, Empty, Space, Tag, Typography } from 'antd';

import {
  viaTags,
  seatLabel,
  planFlags,
  waitSeverity,
  groupByHub,
  LEG_SEAT_NAMES,
  seatPrices,
  priceKey,
  priceLabel,
  durationLabel,
} from '../lib/view.ts';
import type { FlagKind, SeatState } from '../lib/view.ts';
import type { PlanGroup, TransferLeg } from '../../shared/types.ts';

interface Props {
  groups: PlanGroup[];
  /** 查询日期（查价用） */
  date: string;
  /** 用户所选席别（合计参考价按它求和） */
  seat: string;
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
  ) => void;
}

/** 方案标记类别 → antd Tag color */
const FLAG_COLOR: Record<FlagKind, string> = {
  bad: 'error',
  risky: 'warning',
  long: 'default',
  ok: 'success',
};

/** 席别状态 → antd Tag color */
const SEAT_COLOR: Record<SeatState, string> = {
  off: 'default',
  on: 'success',
  hl: 'green',
};

/** 一程（中转的一段） */
function Leg({
  leg,
  no,
  date,
  prices,
  loadingPrice,
  onQueryPrice,
}: {
  leg: TransferLeg;
  no: number;
  date: string;
} & Pick<Props, 'prices' | 'loadingPrice' | 'onQueryPrice'>) {
  const via = viaTags(leg.startStation, leg.endStation, leg.fromStation, leg.toStation);
  const seats = Object.entries(leg.seats)
    .map(([code, raw]) => ({ label: seatLabel(LEG_SEAT_NAMES[code] ?? code, raw), key: code }))
    .filter((x) => x.label);

  const key = priceKey(leg.trainNo, leg.fromStationNo, leg.toStationNo);
  const priceMap = key ? prices[key] : undefined;
  const priceItems = seatPrices(priceMap);

  return (
    <Space align="start" size={10} style={{ display: 'flex' }}>
      <Tag color="blue" style={{ borderRadius: '50%', marginTop: 4 }}>
        {no}
      </Tag>
      <div>
        <Space size={8} wrap>
          <Typography.Text strong>{leg.trainCode}</Typography.Text>
          {via.length > 0 && <Tag>{via.join(' · ')}</Tag>}
          {priceItems.length ? (
            priceItems.map((p) => (
              <Typography.Text key={p.code} strong style={{ color: '#d97706' }}>
                {p.name} {p.label}
              </Typography.Text>
            ))
          ) : (
            <Button
              size="small"
              type="link"
              disabled={!key}
              loading={key ? loadingPrice.has(key) : false}
              onClick={() => key && onQueryPrice(leg.trainNo, leg.fromStationNo, leg.toStationNo, date)}
            >
              查价
            </Button>
          )}
        </Space>
        <div>
          <Space size={8}>
            <Typography.Text strong>{leg.startTime}</Typography.Text>
            <Typography.Text type="secondary">{leg.fromStation}</Typography.Text>
            <Typography.Text type="secondary">→ {leg.duration} →</Typography.Text>
            <Typography.Text strong>{leg.arriveTime}</Typography.Text>
            <Typography.Text type="secondary">{leg.toStation}</Typography.Text>
          </Space>
        </div>
        {seats.length > 0 && (
          <Space size={4} wrap style={{ marginTop: 4 }}>
            {seats.map((x) => (
              <Tag key={x.key} color={SEAT_COLOR[x.label!.state]}>
                {x.label!.text}
              </Tag>
            ))}
          </Space>
        )}
      </div>
    </Space>
  );
}

/** 单个中转方案卡片 */
function TransferCard({
  group,
  date,
  seat,
  prices,
  loadingPrice,
  onQueryPrice,
}: { group: PlanGroup; date: string; seat: string } & Pick<
  Props,
  'prices' | 'loadingPrice' | 'onQueryPrice'
>) {
  const p = group.best;
  const flags = planFlags(p.flags);
  const severity = waitSeverity(p.flags);
  const waitColor = severity === 'warn' ? 'warning' : severity === 'dim' ? 'default' : 'blue';

  // 两程都查到「用户所选席别」价格时，显示合计参考价
  const legPrices = p.legs.map((leg) => {
    const k = priceKey(leg.trainNo, leg.fromStationNo, leg.toStationNo);
    return k ? prices[k]?.[seat] : undefined;
  });
  const total = legPrices.every((x) => x != null) ? legPrices.reduce((a, b) => a! + b!, 0) : null;

  return (
    <Card size="small" style={{ marginBottom: 10 }}>
      <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Text strong>
          {p.fromStation} → {p.endStation}
        </Typography.Text>
        <Space size={12}>
          {total != null && (
            <Typography.Text strong style={{ color: '#d97706' }}>
              参考价 {priceLabel(total)}
            </Typography.Text>
          )}
          <Typography.Text style={{ color: '#2563eb' }}>总耗时 {durationLabel(p.totalMinutes)}</Typography.Text>
        </Space>
      </Space>

      <div style={{ marginTop: 8 }}>
        {p.legs.map((leg, i) => (
          <div key={`${leg.trainCode}-${i}`}>
            <Leg
              leg={leg}
              no={i + 1}
              date={date}
              prices={prices}
              loadingPrice={loadingPrice}
              onQueryPrice={onQueryPrice}
            />
            {i === 0 && (
              <Space size={6} style={{ margin: '6px 0 6px 30px' }}>
                <Tag color={waitColor}>换乘 {p.middleStation}　等待 {durationLabel(p.waitMinutes)}</Tag>
                <Tag>{p.sameStation ? '同站' : '同城异站'}</Tag>
                {p.sameTrain && <Tag color="success">同车接续</Tag>}
              </Space>
            )}
          </div>
        ))}
      </div>

      {flags.length > 0 && (
        <Space size={6} wrap style={{ marginTop: 8 }}>
          {flags.map((f) => (
            <Tag key={f.label} color={FLAG_COLOR[f.kind]}>
              {f.label}
            </Tag>
          ))}
        </Space>
      )}
    </Card>
  );
}

export default function TransferList({ groups, date, seat, prices, loadingPrice, onQueryPrice }: Props) {
  if (!groups.length) return <Empty description="没有中转方案" />;

  const items = groupByHub(groups).map(([hub, list]) => ({
    key: hub,
    label: (
      <Space>
        {hub}
        <Tag>{list.length} 个方案</Tag>
      </Space>
    ),
    children: list.map((g) => (
      <TransferCard
        key={`${g.firstTrainCode}-${g.secondTrainCode}-${g.middleStations.map((m) => m.name).join('/')}`}
        group={g}
        date={date}
        seat={seat}
        prices={prices}
        loadingPrice={loadingPrice}
        onQueryPrice={onQueryPrice}
      />
    )),
  }));

  return <Collapse items={items} defaultActiveKey={items.map((i) => i.key)} />;
}
