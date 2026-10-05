/**
 * 中转方案列表（D28：按枢纽分组折叠，组内按耗时排序）
 *
 * 每个方案展示：起终点、总耗时、两程车次与上下车、换乘等待、标记（flags）。
 * 分组逻辑来自 view.groupByHub（纯函数，已单测）。
 */

import { Card, Collapse, Empty, Space, Tag, Typography } from 'antd';

import { viaTags, seatLabel, planFlags, waitSeverity, groupByHub, LEG_SEAT_NAMES } from '../lib/view.ts';
import type { FlagKind, SeatState } from '../lib/view.ts';
import type { PlanGroup, TransferLeg } from '../../shared/types.ts';

interface Props {
  groups: PlanGroup[];
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
function Leg({ leg, no }: { leg: TransferLeg; no: number }) {
  const via = viaTags(leg.startStation, leg.endStation, leg.fromStation, leg.toStation);
  const seats = Object.entries(leg.seats)
    .map(([code, raw]) => ({ label: seatLabel(LEG_SEAT_NAMES[code] ?? code, raw), key: code }))
    .filter((x) => x.label);

  return (
    <Space align="start" size={10} style={{ display: 'flex' }}>
      <Tag color="blue" style={{ borderRadius: '50%', marginTop: 4 }}>
        {no}
      </Tag>
      <div>
        <Space size={8}>
          <Typography.Text strong>{leg.trainCode}</Typography.Text>
          {via.length > 0 && <Tag>{via.join(' · ')}</Tag>}
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
function TransferCard({ group }: { group: PlanGroup }) {
  const p = group.best;
  const flags = planFlags(p.flags);
  const severity = waitSeverity(p.flags);
  const waitColor = severity === 'warn' ? 'warning' : severity === 'dim' ? 'default' : 'blue';

  return (
    <Card size="small" style={{ marginBottom: 10 }}>
      <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography.Text strong>
          {p.fromStation} → {p.endStation}
        </Typography.Text>
        <Typography.Text style={{ color: '#2563eb' }}>总耗时 {p.totalMinutes} 分</Typography.Text>
      </Space>

      <div style={{ marginTop: 8 }}>
        {p.legs.map((leg, i) => (
          <div key={`${leg.trainCode}-${i}`}>
            <Leg leg={leg} no={i + 1} />
            {i === 0 && (
              <Space size={6} style={{ margin: '6px 0 6px 30px' }}>
                <Tag color={waitColor}>换乘 {p.middleStation}　等待 {p.waitMinutes} 分</Tag>
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

export default function TransferList({ groups }: Props) {
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
      <TransferCard key={`${g.firstTrainCode}-${g.secondTrainCode}-${g.middleStations.map((m) => m.name).join('/')}`} group={g} />
    )),
  }));

  return <Collapse items={items} defaultActiveKey={items.map((i) => i.key)} />;
}
