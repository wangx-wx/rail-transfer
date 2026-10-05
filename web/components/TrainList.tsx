/**
 * 直达车次列表（D9 展示票-席别-价格）
 *
 * 展示：车次、上车→下车、发到时刻、历时、席别余票；
 * 始发/终到与上下车不同时用 Tag 标注（见 spec/技术方案.md §5.1）。
 */

import { Card, Empty, Space, Tag, Typography } from 'antd';

import { nameOf, viaTags, seatLabel } from '../lib/view.ts';
import type { SeatState } from '../lib/view.ts';
import type { Train } from '../../shared/types.ts';

interface Props {
  result: {
    trains: Train[];
    stationMap: Record<string, string>;
    seat: string;
  } | null;
}

/** 席别状态 → antd Tag color */
const SEAT_COLOR: Record<SeatState, string> = {
  off: 'default',
  on: 'success',
  hl: 'green',
};

export default function TrainList({ result }: Props) {
  if (!result) return null;
  const { trains, stationMap, seat } = result;
  if (!trains.length) return <Empty description="没有直达车次" />;

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size={10}>
      {trains.map((t) => {
        const from = nameOf(t.fromStation, stationMap);
        const to = nameOf(t.toStation, stationMap);
        const via = viaTags(nameOf(t.startStation, stationMap), nameOf(t.endStation, stationMap), from, to);
        const seats = t.seats
          .map((s) => ({ label: seatLabel(s.name, s.raw, s.code === seat), key: s.code }))
          .filter((x) => x.label);

        return (
          <Card key={`${t.trainCode}-${t.fromStation}-${t.toStation}`} size="small">
            <Space align="start" size={16} wrap>
              <Typography.Text strong style={{ fontSize: 17, color: '#2563eb' }}>
                {t.trainCode}
              </Typography.Text>

              <Space size={8}>
                <Typography.Text strong>{t.startTime}</Typography.Text>
                <Typography.Text type="secondary">{from}</Typography.Text>
                <Typography.Text type="secondary">→</Typography.Text>
                <Typography.Text type="secondary">{t.duration}</Typography.Text>
                <Typography.Text type="secondary">→</Typography.Text>
                <Typography.Text strong>{t.arriveTime}</Typography.Text>
                <Typography.Text type="secondary">{to}</Typography.Text>
              </Space>

              {via.length > 0 && <Tag>{via.join(' · ')}</Tag>}

              <Space size={4} wrap>
                {seats.length ? (
                  seats.map((x) => (
                    <Tag key={x.key} color={SEAT_COLOR[x.label!.state]}>
                      {x.label!.text}
                    </Tag>
                  ))
                ) : (
                  <Tag>无票</Tag>
                )}
              </Space>
            </Space>
          </Card>
        );
      })}
    </Space>
  );
}
