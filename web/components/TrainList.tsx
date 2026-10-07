/**
 * 直达车次列表（D9 展示票-席别-价格）
 *
 * 展示：车次、上车→下车、发到时刻、历时、席别余票；
 * 始发/终到与上下车不同时用 Tag 标注（见 spec/技术方案.md §5.1）。
 * 价格懒加载：点「查价」才请求（1 趟车 1 次请求，避开子请求上限）。
 * 买短乘长（D45~D53）：无票车卡片内联「查买短乘长」，手动点、就地显示结果。
 */

import { Button, Card, Empty, Tag, Typography } from 'antd';

import { nameOf, viaTags, seatLabel, seatPrices, priceKey } from '../lib/view.ts';
import JourneyTimes from './JourneyTimes.tsx';
import { isSoldOut } from '../lib/buyshort.ts';
import type { BuyShortResult } from '../lib/buyshort.ts';
import type { Train } from '../../shared/types.ts';

interface Props {
  result: {
    trains: Train[];
    stationMap: Record<string, string>;
    /** 查询日期（YYYY-MM-DD，查价用） */
    date: string;
  } | null;
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
  /** 买短乘长结果（键 = 车次编号） */
  buyShort: Record<string, BuyShortResult>;
  /** 正在查买短乘长的车次编号 */
  buyShortLoading: Set<string>;
  /** 买短乘长进度（车次编号 → 已查站数） */
  buyShortProgress: Record<string, number>;
  /** 触发查买短乘长 */
  onQueryBuyShort: (train: Train, key: string) => void;
}

/** 灰字提示样式（风险提示 / 无结果） */
const HINT_STYLE: React.CSSProperties = { color: 'var(--rail-secondary)', fontSize: 13 };

/**
 * 买短乘长结果区（D45~D53）——未查时不渲染，挂在卡片下方。
 *
 * 查询中：显示「查询中… 已查 N 站，均无票」（D53）
 * 命中：完整句 + 一行灰色风险提示（D51/Q23）
 * 无结果：灰字（D52）
 */
function BuyShortResultArea({
  state,
  result,
  loading,
  progress,
}: {
  state: { from: string; to: string };
  result: BuyShortResult | undefined;
  loading: boolean;
  progress: number | undefined;
}) {
  if (!loading && !result) return null;
  const priceText = result?.kind === 'found' && result.price != null ? `¥${result.price}` : '有票';

  return (
    <div className="buy-short-result">
      {loading ? (
        <Typography.Text style={HINT_STYLE}>
          查询中… 已查 {progress ?? 0} 站，均无票
        </Typography.Text>
      ) : result?.kind === 'found' ? (
        <div>
          <Typography.Text>
            <Typography.Text type="success" strong>
              买短乘长
            </Typography.Text>
            ：买「{state.from} → {result.stationName}」{result.seatName} {priceText}，上车后补票至 {state.to}
          </Typography.Text>
          <div style={HINT_STYLE}>需车上补票，超员时可能被要求下车</div>
        </div>
      ) : result?.kind === 'noCandidate' ? (
        <Typography.Text style={HINT_STYLE}>该车无中途可买站</Typography.Text>
      ) : result?.kind === 'error' ? (
        <Typography.Text style={HINT_STYLE}>查询失败：{result.error}</Typography.Text>
      ) : (
        <Typography.Text style={HINT_STYLE}>该车沿途各站均无票</Typography.Text>
      )}
    </div>
  );
}

export default function TrainList({
  result,
  prices,
  loadingPrice,
  onQueryPrice,
  buyShort,
  buyShortLoading,
  buyShortProgress,
  onQueryBuyShort,
}: Props) {
  if (!result) return null;
  const { trains, stationMap, date } = result;
  if (!trains.length) return <Empty description="没有直达车次" />;

  return (
    <div className="train-list">
      {trains.map((t) => {
        const from = nameOf(t.fromStation, stationMap);
        const to = nameOf(t.toStation, stationMap);
        const via = viaTags(nameOf(t.startStation, stationMap), nameOf(t.endStation, stationMap), from, to);
        const seats = t.seats
          .map((s) => ({ label: seatLabel(s.name, s.raw), key: s.code }))
          .filter((x) => x.label);

        const key = priceKey(t.trainNo, t.fromStationNo, t.toStationNo);
        const priceMap = key ? prices[key] : undefined;
        const priceItems = seatPrices(priceMap);

        // 买短乘长：仅无票车显示（D45/D23）
        const soldOut = isSoldOut(t);
        const bsKey = t.trainNo;

        return (
          <Card key={`${t.trainCode}-${t.fromStation}-${t.toStation}`} className="ticket-card" size="small" variant="borderless" styles={{ body: { padding: 'var(--card-padding, 20px)' } }}>
            <div className="ticket-main">
              <div className="train-identity"><strong>{t.trainCode}</strong><span>直达列车</span></div>
              <JourneyTimes fromStation={from} toStation={to} startTime={t.startTime} arriveTime={t.arriveTime} duration={t.duration} />
              <div className="seat-list">
                {seats.length ? seats.map((x) => (
                  <span key={x.key} className={`seat-label seat-${x.label!.state}`}>{x.label!.text}</span>
                )) : <span className="seat-label seat-off">无票</span>}
              </div>
              <div className="ticket-actions">
                {priceItems.length ? priceItems.map((p) => (
                  <span className="price-item" key={p.code}>{p.name} {p.label}</span>
                )) : (
                  <Button type="link" disabled={!key || !t.seatTypes} loading={key ? loadingPrice.has(key) : false}
                    onClick={() => key && onQueryPrice(t.trainNo, t.fromStationNo, t.toStationNo, date, t.seatTypes)}>
                    查价
                  </Button>
                )}
                {soldOut && !buyShort[bsKey] && (
                  <Button type="link" loading={buyShortLoading.has(bsKey)} onClick={() => onQueryBuyShort(t, bsKey)}>
                    买短乘长
                  </Button>
                )}
              </div>
            </div>
            {via.length > 0 && <Tag className="wrapping-tag ticket-note">{via.join(' · ')}</Tag>}

            {soldOut && (
              <BuyShortResultArea
                state={{ from, to }}
                result={buyShort[bsKey]}
                loading={buyShortLoading.has(bsKey)}
                progress={buyShortProgress[bsKey]}
              />
            )}
          </Card>
        );
      })}
    </div>
  );
}
