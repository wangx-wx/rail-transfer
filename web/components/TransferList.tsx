/**
 * 中转方案列表（D28：按枢纽分组折叠，组内按耗时排序）
 *
 * 每个方案展示：起终点、总耗时、两程车次与上下车、换乘等待、标记（flags）。
 * 分组逻辑来自 view.groupByHub（纯函数，已单测）。
 */

import { useEffect, useState } from 'react';
import { Button, Card, Collapse, Empty, Space, Tag } from 'antd';

import JourneyTimes from './JourneyTimes.tsx';
import ConnectionPanel from './ConnectionPanel.tsx';
import { stationCodeOf } from '../lib/connectionAdapter.ts';
import type { ConnectionResult } from '../lib/connection.ts';
import { REFERENCE_SEAT_CODE } from '../../shared/constants.ts';
import {
  viaTags,
  seatLabel,
  planFlags,
  groupByHub,
  LEG_SEAT_NAMES,
  seatPrices,
  priceKey,
  priceLabel,
  durationLabel,
} from '../lib/view.ts';
import type { FlagKind } from '../lib/view.ts';
import type { AnnotatedPlan, PlanGroup, TransferLeg } from '../../shared/types.ts';

interface Props {
  groups: PlanGroup[];
  /** 查询日期（查价用） */
  date: string;
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
  /** 接驳结果（键 = `到达站码>出发站码`，D70） */
  connections?: Record<string, ConnectionResult>;
  /** 正在查接驳的键 */
  loadingConnection?: Set<string>;
  /** 触发查接驳 */
  onQueryConnection?: (fromCode: string, toCode: string, waitMinutes: number) => void;
}

/** 同城异站换乘的接驳入口（D69：官方通路与自研通路共用同一组件） */
function ConnectionEntry({ plan: p, connections, loadingConnection, onQueryConnection }: {
  plan: AnnotatedPlan;
  connections?: Props['connections'];
  loadingConnection?: Props['loadingConnection'];
  onQueryConnection?: Props['onQueryConnection'];
}) {
  if (p.sameStation) return null;

  const leg = p.legs[0];
  const next = p.legs[1];
  // T62：官方结果只有站名，需反查站码；失败则禁用并说明（不做城市级近似）
  const fromCode = leg ? stationCodeOf(leg.toStation) : null;
  const toCode = next ? stationCodeOf(next.fromStation) : null;

  if (!fromCode || !toCode || !leg || !next) {
    return (
      <div className="connection-panel">
        <span className="muted">
          {leg?.toStation} → {next?.fromStation} · 未识别换乘站
        </span>
        <Button size="small" disabled>查接驳</Button>
      </div>
    );
  }

  const key = `${fromCode}>${toCode}`;
  return (
    <ConnectionPanel
      point={{
        fromName: leg.toStation,
        toName: next.fromStation,
        fromCode,
        toCode,
        waitMinutes: p.waitMinutes,
      }}
      result={connections?.[key] ?? null}
      loading={loadingConnection?.has(key) ?? false}
      onQuery={() => onQueryConnection?.(fromCode, toCode, p.waitMinutes)}
    />
  );
}

/** 方案标记类别 → antd Tag color */
const FLAG_COLOR: Record<FlagKind, string> = {
  bad: 'error',
  risky: 'warning',
  long: 'default',
  ok: 'success',
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
    <div className="transfer-leg">
      <span className="leg-index">{no}</span>
      <div className="leg-content">
        <div className="leg-heading">
          <strong>{leg.trainCode}</strong>
          {via.length > 0 && <Tag className="wrapping-tag">{via.join(' · ')}</Tag>}
        </div>
        <JourneyTimes fromStation={leg.fromStation} toStation={leg.toStation} startTime={leg.startTime} arriveTime={leg.arriveTime} duration={leg.duration} />
        <div className="leg-tools">
          <div className="seat-list">{seats.map((x) => (
            <span key={x.key} className={`seat-label seat-${x.label!.state}`}>{x.label!.text}</span>
          ))}</div>
        </div>
        {priceItems.length ? (
          <div className="leg-price">
            <div className="leg-price-head">{leg.trainCode} · {leg.fromStation} → {leg.toStation}</div>
            <div className="price-list" aria-label="各席别价格">
              {priceItems.map((p) => (
                <div className={`price-row${p.code === REFERENCE_SEAT_CODE ? ' price-row--ref' : ''}`} key={p.code}>
                  <span className="price-name">{p.name}</span>
                  <span className="price-amount">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="leg-price-cta">
            <Button type="link" disabled={!key || !leg.seatTypes} loading={key ? loadingPrice.has(key) : false}
              onClick={() => key && onQueryPrice(leg.trainNo, leg.fromStationNo, leg.toStationNo, date, leg.seatTypes ?? '')}>
              查价
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 关键行程信息始终可见，两程完整信息原位展开。 */
function TransferCard({ plan: p, date, prices, loadingPrice, onQueryPrice, connections, loadingConnection, onQueryConnection }: {
  plan: AnnotatedPlan; date: string;
} & Pick<Props, 'prices' | 'loadingPrice' | 'onQueryPrice' | 'connections' | 'loadingConnection' | 'onQueryConnection'>) {
  const flags = planFlags(p.flags);
  const legPrices = p.legs.map((leg) => {
    const key = priceKey(leg.trainNo, leg.fromStationNo, leg.toStationNo);
    return key ? prices[key]?.[REFERENCE_SEAT_CODE] : undefined;
  });
  const total = legPrices.length > 0 && legPrices.every((x) => x != null)
    ? legPrices.reduce((a, b) => a! + b!, 0) : null;

  return (
    <Card className="ticket-card" size="small" variant="borderless" styles={{ body: { padding: 'var(--card-padding, 20px)' } }}>
      <div className="ticket-caption">
        <span>{p.fromStation} → {p.endStation}</span>
        <span>总耗时 {durationLabel(p.totalMinutes)}</span>
      </div>
      <div className="ticket-main">
        <div className="train-identity"><strong>{p.firstTrainCode} → {p.secondTrainCode}</strong><span>{p.sameTrain ? '同车接续' : '换乘一次'}</span></div>
        <JourneyTimes fromStation={p.fromStation} toStation={p.endStation} startTime={p.startTime} arriveTime={p.arriveTime} duration={durationLabel(p.totalMinutes)} />
        <div className="transfer-facts">
          <div className="transfer-wait">换乘 {p.middleStation}　等待 {durationLabel(p.waitMinutes)}</div>
          <span className="muted">{p.sameStation ? '同站' : '同城异站'}</span>
          <div className="seat-list">
            {p.legs.map((leg, index) => {
              // D77：每个席别都渲染——「无」本身是信息，不能因为无票就隐藏。
              // `'--'` 已在解析层归一为 undefined，这里只需过滤空值。
              const labels = Object.entries(leg.seats)
                .map(([code, raw]) => seatLabel(LEG_SEAT_NAMES[code] ?? code, raw))
                .filter((x) => x != null);
              return labels.length ? (
                labels.map((label, i) => (
                  <span key={`${index}-${i}`} className={`seat-label seat-${label!.state}`}>
                    第{index + 1}程 {label!.text}
                  </span>
                ))
              ) : (
                <span key={index} className="seat-label seat-off">第{index + 1}程 暂无余票信息</span>
              );
            })}
          </div>
          {flags.length > 0 && <Space size={4} wrap>{flags.map((flag) => <Tag className="wrapping-tag" key={flag.label} color={FLAG_COLOR[flag.kind]}>{flag.label}</Tag>)}</Space>}
          <ConnectionEntry plan={p} connections={connections} loadingConnection={loadingConnection} onQueryConnection={onQueryConnection} />
        </div>
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
        <summary>两程详情</summary>
        <div className="transfer-legs">{p.legs.map((leg, index) => (
          <Leg key={`${leg.trainCode}-${index}`} leg={leg} no={index + 1} date={date} prices={prices} loadingPrice={loadingPrice} onQueryPrice={onQueryPrice} />
        ))}</div>
      </details>
    </Card>
  );
}

export default function TransferList({ groups, date, prices, loadingPrice, onQueryPrice, connections, loadingConnection, onQueryConnection }: Props) {
  const hubGroups = groupByHub(groups);
  const allKeys = hubGroups.map(([hub]) => hub);

  // 受控展开：流式到达的新枢纽自动展开。
  // ⚠️ 不能用 defaultActiveKey —— 它只在挂载时生效，后续到达的枢纽面板会默认折叠，
  // 用户看不到（自动查好的）参考价。故用受控 activeKey，新增键并入、已折叠的不再强制展开。
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  useEffect(() => {
    setActiveKeys((prev) => [...new Set([...prev, ...allKeys])]);
  }, [allKeys.join('\u0000')]);

  if (!groups.length) return <Empty description="没有中转方案" />;

  const renderCard = (plan: AnnotatedPlan, index: number) => (
    <TransferCard
      key={index}
      plan={plan}
      date={date}
      prices={prices}
      loadingPrice={loadingPrice}
      onQueryPrice={onQueryPrice}
      connections={connections}
      loadingConnection={loadingConnection}
      onQueryConnection={onQueryConnection}
    />
  );

  const items = hubGroups.map(([hub, list]) => ({
    key: hub,
    label: (
      <Space>
        {hub}
        <Tag>{list.length} 个方案</Tag>
      </Space>
    ),
    children: list.map((g) => (
      <div key={`${g.firstTrainCode}-${g.secondTrainCode}`}>
        {renderCard(g.best, 0)}
        {g.plans.length > 1 && (
          <Collapse
            size="small"
            ghost
            styles={{ body: { padding: 0 }, header: { padding: 8, minHeight: 44 } }}
            items={[{
              key: 'alternatives',
              label: `同车次其他方案（${g.plans.length - 1}）`,
              children: g.plans.filter((p) => p !== g.best).map(renderCard),
            }]}
          />
        )}
      </div>
    )),
  }));

  return <Collapse ghost className="hub-list" styles={{ body: { padding: 0 }, header: { padding: '12px 4px', minHeight: 44 } }} items={items} activeKey={activeKeys} onChange={(k) => setActiveKeys(k as string[])} />;
}
