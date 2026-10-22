/**
 * 中转方案列表（D28：按枢纽分组折叠，组内按耗时排序）
 *
 * 每个方案展示：起终点、总耗时、两程车次与上下车、换乘等待、标记（flags）。
 * 分组逻辑来自 view.groupByHub（纯函数，已单测）。
 */

import { Fragment, useEffect, useState } from 'react';
import { Button, Collapse, Empty, Space } from 'antd';

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
  LEG_SEAT_SHORT,
  seatPrices,
  priceKey,
  priceLabel,
  durationLabel,
  dayOffsetAt,
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
        <Button type="link" size="small" className="link-btn" disabled>查接驳</Button>
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
      // 换乘断点已报站对，面板不再重复
      showPair={false}
    />
  );
}

/**
 * 每程到达时刻的跨天天数（D79）。
 *
 * 一程一行后，每程的跨天标识要按**整条行程**累计——只按本程历时算，会把
 * 「次日 07:00 发、14:00 到」这种明明在第二天的程漏标成当日。
 *
 * 累计口径 = 前面各程的历时 + 各段换乘等待 + 本程历时。**最后一程以总耗时为
 * 准**：`totalMinutes` 是「从发车到最终到达」的权威值，逐程相加在个别数据
 * 上（历时缺失、等待未计）会与它对不上，最终到达时刻不该被算错。
 */
function legDayOffsets(
  journeyStart: string,
  legs: TransferLeg[],
  waits: number[],
  totalMinutes: number,
): number[] {
  let cum = 0;
  return legs.map((leg, i) => {
    cum += waits[i] ?? 0;
    cum += legMinutes(leg);
    const elapsed = i === legs.length - 1 ? totalMinutes : cum;
    return dayOffsetAt(journeyStart, elapsed);
  });
}

/** `HH:MM` 形式的历时 → 分钟；非法按 0 处理（缺历时算不出跨天，交给回退） */
function legMinutes(leg: TransferLeg): number {
  const m = /^(\d{1,3}):(\d{2})$/.exec((leg.duration ?? '').trim());
  if (!m || Number(m[2]) > 59) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 方案标记类别 → 换乘断点上的标记样式（D79：颜色只作信号） */
const FLAG_CLASS: Record<FlagKind, string> = {
  bad: 'is-stop',
  risky: '',
  long: '',
  ok: '',
};

/** 一程（展开后的详情行）：车次、始发终到、各席别价格 */
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
  const key = priceKey(leg.trainNo, leg.fromStationNo, leg.toStationNo);
  const priceMap = key ? prices[key] : undefined;
  const priceItems = seatPrices(priceMap);

  return (
    <div className="transfer-leg">
      <span className="leg-index">{no}</span>
      <div className="leg-content">
        <div className="leg-heading">
          <strong>{leg.trainCode}</strong>
          {via.length > 0 && <span className="via">{via.join(' · ')}</span>}
        </div>
        <JourneyTimes fromStation={leg.fromStation} toStation={leg.toStation} startTime={leg.startTime} arriveTime={leg.arriveTime} duration={leg.duration} />
        {/* D77：卡片用短名（8 个席别挤一行），这里用全名——「高软」这类
            简称在详情里要能查回全称 */}
        <div className="seat-list">
          {Object.entries(leg.seats)
            .map(([code, raw]) => seatLabel(LEG_SEAT_NAMES[code] ?? code, raw))
            .filter((x) => x != null)
            .map((label, i) => (
              <span key={i} className={`seat-label seat-${label!.state}`}>{label!.text}</span>
            ))}
        </div>
        {priceItems.length ? (
          <div className="leg-price">
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

/**
 * 换乘断点（D79）：独立成行、横跨整宽。
 *
 * 等待时长按风险着色（充裕绿 / 紧张琥珀 / 来不及红），后接站对与同站标签。
 * 左侧竖线标记而**不用贯穿虚线**——虚线会被文字割碎，反而看不出连续性。
 */
function TransferNode({ plan: p, connections, loadingConnection, onQueryConnection }: {
  plan: AnnotatedPlan;
} & Pick<Props, 'connections' | 'loadingConnection' | 'onQueryConnection'>) {
  const flags = planFlags(p.flags);
  // 低于换乘下限 = 物理上来不及，用错误色；换乘紧张 = 琥珀；其余灰
  const waitClass = p.flags.belowMin ? 'is-stop' : p.flags.risky ? 'is-hold' : 'is-ok';

  return (
    <div className="node">
      <span className={`node__wait ${waitClass}`}>换乘 {durationLabel(p.waitMinutes)}</span>
      <span className="node__pair">
        {p.sameStation ? p.middleStation : `${p.legs[0]?.toStation} → ${p.legs[1]?.fromStation}`}
      </span>
      <span className="node__kind">{p.sameStation ? '同站' : '同城异站'}</span>
      {flags.map((f) => (
        <span key={f.label} className={`node__flag${FLAG_CLASS[f.kind] ? ` ${FLAG_CLASS[f.kind]}` : ''}`}>{f.label}</span>
      ))}
      <ConnectionEntry plan={p} connections={connections} loadingConnection={loadingConnection} onQueryConnection={onQueryConnection} />
    </div>
  );
}

/** 关键行程信息始终可见，两程完整信息原位展开。 */
function TransferCard({ plan: p, date, prices, loadingPrice, onQueryPrice, connections, loadingConnection, onQueryConnection }: {
  plan: AnnotatedPlan; date: string;
} & Pick<Props, 'prices' | 'loadingPrice' | 'onQueryPrice' | 'connections' | 'loadingConnection' | 'onQueryConnection'>) {
  const legPrices = p.legs.map((leg) => {
    const key = priceKey(leg.trainNo, leg.fromStationNo, leg.toStationNo);
    return key ? prices[key]?.[REFERENCE_SEAT_CODE] : undefined;
  });
  const total = legPrices.length > 0 && legPrices.every((x) => x != null)
    ? legPrices.reduce((a, b) => a! + b!, 0) : null;
  // 官方中转只有一次换乘，等待时长只有一个
  const dayOffsets = legDayOffsets(p.startTime, p.legs, [0, p.waitMinutes], p.totalMinutes);

  return (
    <div className="plan">
      <div className="plan__top">
        <div className="plan__head">
          <div className="plan__route">{p.fromStation} → {p.endStation}</div>
          {/* 车次链：一程一行后车次已压在各段轨道线上，这里保留一句概览，
              让「G1 → G2」这种整体形状仍能一眼扫到 */}
          <div className="plan__codes">{p.legs.map((l) => l.trainCode).join(' → ')}</div>
        </div>
        <div className="plan__sum">
          <span>总 {durationLabel(p.totalMinutes)}</span>
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

      {p.legs.map((leg, i) => (
        <Fragment key={`${leg.trainCode}-${i}`}>
          <JourneyTimes
            trainCode={leg.trainCode}
            fromStation={leg.fromStation}
            toStation={leg.toStation}
            startTime={leg.startTime}
            arriveTime={leg.arriveTime}
            duration={leg.duration}
            dayOffset={dayOffsets[i]}
          />
          {i < p.legs.length - 1 && (
            <TransferNode plan={p} connections={connections} loadingConnection={loadingConnection} onQueryConnection={onQueryConnection} />
          )}
        </Fragment>
      ))}

      <div className="seats">
        {p.legs.map((leg, index) => {
          // D77：每个席别都渲染——「无」本身是信息，不能因为无票就隐藏。
          // `'--'` 已在解析层归一为 undefined，这里只需过滤空值。
          // 卡片用短名（8 个席别挤一行），展开详情用全名。
          const labels = Object.entries(leg.seats)
            .map(([code, raw]) => seatLabel(LEG_SEAT_SHORT[code] ?? LEG_SEAT_NAMES[code] ?? code, raw))
            .filter((x) => x != null);
          return (
            <div className="seatrow" key={index}>
              <span className="seatrow__k">第{index + 1}程</span>
              {labels.length ? labels.map((label, i) => (
                <span key={i} className={`seat-label seat-${label!.state}`}>{label!.text}</span>
              )) : (
                <span className="seat-label seat-off">暂无余票信息</span>
              )}
            </div>
          );
        })}
      </div>

      <details className="journey-details">
        <summary>两程详情</summary>
        <div className="transfer-legs">{p.legs.map((leg, index) => (
          <Leg key={`${leg.trainCode}-${index}`} leg={leg} no={index + 1} date={date} prices={prices} loadingPrice={loadingPrice} onQueryPrice={onQueryPrice} />
        ))}</div>
      </details>
    </div>
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
        <span className="muted">{list.length} 个方案</span>
      </Space>
    ),
    children: (
      <div className="sheet">
        {list.map((g) => (
          // ⚠️ 用 Fragment 而非 div 包裹：`.plan:first-child` 靠 DOM 位置去分隔线，
          // 多包一层会让每条方案都成了「第一个孩子」，行间细线全部失效。
          <Fragment key={`${g.firstTrainCode}-${g.secondTrainCode}`}>
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
          </Fragment>
        ))}
      </div>
    ),
  }));

  return <Collapse ghost className="hub-list" styles={{ body: { padding: 0 }, header: { padding: '12px 4px', minHeight: 44 } }} items={items} activeKey={activeKeys} onChange={(k) => setActiveKeys(k as string[])} />;
}
