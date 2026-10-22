/**
 * 自研中转列表（D63：按换乘次数分组折叠）
 *
 * 每个行程展示：各程车次、换乘站与等待、总耗时、标记（疑似绕远 / 超长等待 / 换乘紧张）。
 * 分组逻辑来自 journeyView.groupByTransfers（纯函数，已单测）。
 *
 * D79：版式与官方中转一致——N 程各成一行，中间 N−1 个换乘断点。
 */

import { Fragment, useState } from 'react';
import { Button, Collapse, Empty, Segmented, Space } from 'antd';

import JourneyTimes from './JourneyTimes.tsx';
import ConnectionPanel from './ConnectionPanel.tsx';
import { REFERENCE_SEAT_CODE } from '../../shared/constants.ts';
import { dayOffsetAt, durationLabel, priceKey, priceLabel, seatLabel, seatPrices, LEG_SEAT_SHORT } from '../lib/view.ts';
import { groupByTransfers, journeyTitle } from '../lib/journeyView.ts';
import { sortJourneys, type SortMode } from '../lib/journeys.ts';
import type { ScoredJourney } from '../lib/selfbuilt.ts';
import type { ConnectionResult } from '../lib/connection.ts';
import type { Train } from '../../shared/types.ts';

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
  /** 接驳结果（键 = `到达站码>出发站码`，D70） */
  connections?: Record<string, ConnectionResult>;
  /** 正在查接驳的键 */
  loadingConnection?: Set<string>;
  /** 触发查接驳 */
  onQueryConnection?: (fromCode: string, toCode: string, waitMinutes: number) => void;
}

/** `HH:MM` 形式的历时 → 分钟；非法按 0 处理 */
function legMinutes(leg: Train): number {
  const m = /^(\d{1,3}):(\d{2})$/.exec((leg.duration ?? '').trim());
  if (!m || Number(m[2]) > 59) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 每程到达时刻的跨天天数（D79）。
 *
 * 按整条行程累计，而不是只看本程——否则「次日 07:00 发、14:00 到」的程
 * 会被漏标成当日。最后一程以 `totalMinutes` 为准。
 */
function legDayOffsets(journey: ScoredJourney): number[] {
  let cum = 0;
  return journey.legs.map((leg, i) => {
    cum += journey.transfers[i]?.waitMinutes ?? 0;
    cum += legMinutes(leg);
    const elapsed = i === journey.legs.length - 1 ? journey.totalMinutes : cum;
    return dayOffsetAt(journey.legs[0]!.startTime, elapsed);
  });
}

/** 一程（展开后的详情行）：车次、始发终到、各席别价格 */
function Leg({ train, no, name }: { train: Train; no: number; name: (code: string) => string }) {
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

/**
 * 换乘断点（D79）：独立成行，横跨整宽。
 *
 * 与官方中转共用同一套结构：等待时长着色 + 站对 + 同站标签 + 标记 + 接驳入口。
 */
function TransferNode({
  transfer,
  name,
  waitMinutes,
  risky,
  longWait,
  connections,
  loadingConnection,
  onQueryConnection,
}: {
  transfer: ScoredJourney['transfers'][number];
  name: (code: string) => string;
  waitMinutes: number;
  risky: boolean;
  longWait: boolean;
  connections?: Props['connections'];
  loadingConnection?: Props['loadingConnection'];
  onQueryConnection?: Props['onQueryConnection'];
}) {
  // 行内只报到达站；「到达站 → 下一程出发站」由接驳面板说清（两条通路一致）
  const key = `${transfer.station}>${transfer.toStation}`;
  const waitClass = risky ? 'is-stop' : longWait ? 'is-hold' : 'is-ok';

  return (
    <div className="node">
      <span className={`node__wait ${waitClass}`}>换乘 {durationLabel(waitMinutes)}</span>
      <span className="node__pair">
        {transfer.sameStation
          ? name(transfer.station)
          : `${name(transfer.station)} → ${name(transfer.toStation)}`}
      </span>
      <span className="node__kind">{transfer.sameStation ? '同站' : '同城异站'}</span>
      {longWait && <span className="node__flag">超长等待</span>}
      {risky && <span className="node__flag is-stop">换乘紧张</span>}
      {!transfer.sameStation && (
        <ConnectionPanel
          point={{
            fromName: name(transfer.station),
            toName: name(transfer.toStation),
            fromCode: transfer.station,
            toCode: transfer.toStation,
            waitMinutes: transfer.waitMinutes,
          }}
          result={connections?.[key] ?? null}
          loading={loadingConnection?.has(key) ?? false}
          onQuery={() => onQueryConnection?.(transfer.station, transfer.toStation, transfer.waitMinutes)}
          // 换乘断点已报站对，面板不再重复
          showPair={false}
        />
      )}
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
  connections,
  loadingConnection,
  onQueryConnection,
}: { journey: ScoredJourney; date: string; name: (code: string) => string } & Pick<
  Props,
  'prices' | 'loadingPrice' | 'onQueryPrice' | 'connections' | 'loadingConnection' | 'onQueryConnection'
>) {
  const first = j.legs[0]!;
  const last = j.legs[j.legs.length - 1]!;
  const legPrices = j.legs.map((l) => {
    const key = priceKey(l.trainNo, l.fromStationNo, l.toStationNo);
    return key ? prices[key]?.[REFERENCE_SEAT_CODE] : undefined;
  });
  const total = legPrices.length > 0 && legPrices.every((x) => x != null)
    ? legPrices.reduce((a, b) => a! + b!, 0) : null;
  const dayOffsets = legDayOffsets(j);

  return (
    <div className="plan">
      <div className="plan__top">
        <div className="plan__head">
          <div className="plan__route">{name(first.fromStation)} → {name(last.toStation)}</div>
          <div className="plan__codes">{j.legs.map((l) => l.trainCode).join(' → ')}</div>
        </div>
        <div className="plan__sum">
          <span>总 {durationLabel(j.totalMinutes)}</span>
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

      {j.legs.map((leg, i) => (
        <Fragment key={`${leg.trainNo}-${i}`}>
          <JourneyTimes
            trainCode={leg.trainCode}
            fromStation={name(leg.fromStation)}
            toStation={name(leg.toStation)}
            startTime={leg.startTime}
            arriveTime={leg.arriveTime}
            duration={leg.duration}
            dayOffset={dayOffsets[i]}
          />
          {i < j.legs.length - 1 && j.transfers[i] && (
            <TransferNode
              transfer={j.transfers[i]!}
              name={name}
              waitMinutes={j.transfers[i]!.waitMinutes}
              risky={j.risky}
              longWait={j.longWait}
              connections={connections}
              loadingConnection={loadingConnection}
              onQueryConnection={onQueryConnection}
            />
          )}
        </Fragment>
      ))}

      {j.detour && (
        <Space size={4} wrap>
          <span className="node__flag">疑似绕远</span>
        </Space>
      )}

      <div className="seats">
        {j.legs.map((leg, index) => {
          // D77：每个席别都渲染——「无」本身是信息，不能因为无票就隐藏
          // 卡片用短名（8 个席别挤一行），展开详情用全名。
          const labels = leg.seats
            .map((s) => seatLabel(LEG_SEAT_SHORT[s.code] ?? s.name, s.raw))
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
                      <div className={`price-row${p.code === REFERENCE_SEAT_CODE ? ' price-row--ref' : ''}`} key={p.code}>
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
    </div>
  );
}

/** 每组默认展开的方案数；其余折叠在「展开更多」后（零请求、数据已在内存） */
const TOP_PER_GROUP = 5;

export default function SelfBuiltList({
  journeys, date, stationNames, prices, loadingPrice, onQueryPrice,
  connections, loadingConnection, onQueryConnection,
}: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('weighted');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!journeys.length) return <Empty description="没有自研中转方案" />;

  const name = (code: string): string => stationNames[code] ?? code;
  const sorted = sortJourneys(journeys, { mode: sortMode }) as ScoredJourney[];
  const groups = groupByTransfers(sorted);

  const items = groups.map((g) => {
    const gkey = String(g.transfers);
    const open = expanded.has(gkey);
    const visible = open ? g.journeys : g.journeys.slice(0, TOP_PER_GROUP);
    const rest = g.journeys.length - visible.length;
    return {
      key: gkey,
      label: (
        <Space>
          {journeyTitle(g.transfers)}
          <span className="muted">{g.journeys.length} 条</span>
        </Space>
      ),
      children: (
        <div className="sheet">
          {visible.map((j, i) => (
            <JourneyCard
              key={`${j.legs.map((l) => l.trainNo).join('-')}-${i}`}
              journey={j}
              date={date}
              name={name}
              prices={prices}
              loadingPrice={loadingPrice}
              onQueryPrice={onQueryPrice}
              connections={connections}
              loadingConnection={loadingConnection}
              onQueryConnection={onQueryConnection}
            />
          ))}
          {(rest > 0 || open) && (
            <Button
              type="link"
              block
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(gkey)) next.delete(gkey);
                  else next.add(gkey);
                  return next;
                })
              }
            >
              {open ? '收起' : `展开更多（还有 ${rest} 条）`}
            </Button>
          )}
        </div>
      ),
    };
  });

  return (
    <>
      <div className="list-toolbar">
        <Segmented<SortMode>
          size="small"
          value={sortMode}
          onChange={setSortMode}
          options={[
            { label: '综合推荐', value: 'weighted' },
            { label: '按总耗时', value: 'time' },
          ]}
        />
      </div>
      <Collapse className="hub-list" defaultActiveKey={groups.map((g) => String(g.transfers))} items={items} />
    </>
  );
}
