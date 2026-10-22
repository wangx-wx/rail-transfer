/**
 * 共用接驳面板（D69~D76）—— 自研列表与官方中转列表同时使用
 *
 * 只负责「给定换乘点与已加载结果 → 展示」，取数由父层注入（T60/T61）。
 * 降级口径严格按 D74：任何情况下不留空白，也不显示「0 分钟」。
 */

import { Button, Space, Tag } from 'antd';
import { useState } from 'react';

import { CROSS_CITY_KM } from '../lib/connection.ts';
import type { ConnectionResult, TransitPlan } from '../lib/connection.ts';
import { durationLabel, priceLabel } from '../lib/view.ts';

/** 一个换乘点（同城异站） */
export interface ConnectionPoint {
  /** 上一程到达站名 */
  fromName: string;
  /** 下一程出发站名 */
  toName: string;
  /** 上一程到达站码（缓存键用） */
  fromCode: string;
  /** 下一程出发站码（缓存键用） */
  toCode: string;
  /** 换乘等待（分钟） */
  waitMinutes: number;
}

interface Props {
  point: ConnectionPoint;
  /** 已加载的结果；null = 还没查 */
  result: ConnectionResult | null;
  loading: boolean;
  onQuery: () => void;
}

/** 米 → 「8.1 公里」；不足 1 公里给米 */
function kmLabel(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

/** 分 → 元。公交票价上游以分为单位（T57：已显式 price_unit=1） */
function yuanOfFen(fen: number): number {
  return fen / 100;
}

/**
 * 一条方式的摘要（D72 / D78）：时间 · 里程 · 票价 · 余量。
 *
 * D78：里程与票价此前只在展开详情里，摘要行看不到——而用户判断「这条
 * 接驳能不能用」正需要这两项，不该逼人先展开。票价仅在上游给出时显示。
 */
function SummaryMode({ label, minutes, meters, fare, waitMinutes }: {
  label: string;
  minutes: number;
  meters: number;
  fare: number | null;
  waitMinutes: number;
}) {
  const margin = waitMinutes - minutes;
  const over = margin < 0;
  return (
    <div className="connection-mode">
      <strong>{label}</strong>
      <span className="connection-mode-time">{durationLabel(minutes)}</span>
      <span className="connection-mode-distance">{kmLabel(meters)}</span>
      {fare != null && <span className="connection-mode-fare">{priceLabel(fare)}</span>}
      <span className={`connection-mode-margin${over ? ' is-over' : ''}`}>
        {over ? `超 ${durationLabel(-margin)}` : `余 ${durationLabel(margin)}`}
      </span>
    </div>
  );
}

/**
 * 公交逐段明细（D78）：每段都标时长，步行段只给距离。
 *
 * 与旧版 `lines` 的区别：旧版只列「坐了哪几条线」，看不出每段各多久；
 * 这里按时间顺序列出全部步骤，时长靠右对齐便于竖读。
 */
function TransitSegments({ plan }: { plan: TransitPlan }) {
  if (!plan.segments?.length) {
    // 上游未给 steps 时的兜底：退回只列线路名
    return (
      <div className="connection-lines">
        {plan.lines.map((l, i) => (
          <div className="connection-line" key={`${l.title}-${i}`}>
            <span className="connection-line-title">{l.title}</span>
            <span className="muted">
              {l.geton} → {l.getoff}
              {l.stationCount != null && ` · ${l.stationCount} 站`}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="connection-segments">
      {plan.segments.map((s, i) => (
        <div className="connection-segment" key={`${s.mode}-${i}`}>
          <span className="connection-segment-mode">
            {s.mode === 'WALKING' ? '步行' : s.title}
          </span>
          <span className="muted">
            {s.mode === 'WALKING'
              ? `${Math.round(s.distanceMeters)} 米`
              : `${s.geton} → ${s.getoff}${s.stationCount != null ? ` · ${s.stationCount} 站` : ''}`}
          </span>
          <span className="connection-segment-time">{durationLabel(s.durationMinutes)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ConnectionPanel({ point, result, loading, onQuery }: Props) {
  const [open, setOpen] = useState(false);

  const header = (
    <span className="connection-pair">
      {point.fromName} → {point.toName}
    </span>
  );

  // 跨城（D75）：只给一行事实，不给按钮
  if (result?.kind === 'crossCity') {
    return (
      <div className="connection-panel">
        <Tag color="default">跨城接驳</Tag>
        <span className="muted">
          {header}· 直线约 {Math.round(result.km)} 公里 · 不提供市内交通方案
        </span>
      </div>
    );
  }

  // 缺坐标（D74）：按钮禁用 + 说明
  if (result?.kind === 'noCoord') {
    return (
      <div className="connection-panel">
        <span className="muted">{header}· 未获取到站点位置</span>
        <Button size="small" disabled>
          查接驳
        </Button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="connection-panel">
        <span className="muted">{header}</span>
        <Button size="small" loading={loading} onClick={onQuery}>
          查接驳
        </Button>
      </div>
    );
  }

  const { transit, driving, flags, km } = result;
  const bothEmpty = transit.kind === 'empty' && driving.kind === 'empty';
  const anyError = transit.kind === 'error' || driving.kind === 'error';
  const retriable =
    (transit.kind === 'error' && transit.retriable) ||
    (driving.kind === 'error' && driving.retriable);

  return (
    <div className="connection-panel">
      <div className="connection-summary">
        <span className="muted">{header}</span>
        <Space size={4} wrap>
          {flags.map((f) => (
            <Tag key={f.label} color={f.kind === 'bad' ? 'error' : f.kind === 'risky' ? 'warning' : 'default'}>
              {f.label}
            </Tag>
          ))}
        </Space>
      </div>

      {bothEmpty && (
        <div className="muted">
          暂未获取到接驳方案（直线 {kmLabel(km * 1000)}）
        </div>
      )}

      <div className="connection-modes">
        {transit.kind === 'plan' && (
          <SummaryMode
            label="公交"
            minutes={transit.plan.durationMinutes}
            meters={transit.plan.distanceMeters}
            fare={transit.plan.fareFen != null ? yuanOfFen(transit.plan.fareFen) : null}
            waitMinutes={point.waitMinutes}
          />
        )}
        {driving.kind === 'plan' && (
          <SummaryMode
            label="打车"
            minutes={driving.plan.durationMinutes}
            meters={driving.plan.distanceMeters}
            fare={driving.plan.fare}
            waitMinutes={point.waitMinutes}
          />
        )}
      </div>

      {anyError && (
        <div className="connection-errors">
          {transit.kind === 'error' && <span className="muted">公交：{transit.message}</span>}
          {driving.kind === 'error' && <span className="muted">打车：{driving.message}</span>}
          {retriable && (
            <Button size="small" loading={loading} onClick={onQuery}>
              重试
            </Button>
          )}
        </div>
      )}

      {(transit.kind === 'plan' || driving.kind === 'plan') && (
        <>
          <Button type="link" size="small" onClick={() => setOpen((v) => !v)}>
            {open ? '收起详情' : '展开详情'}
          </Button>
          {open && (
            <div className="connection-details">
              {transit.kind === 'plan' && (
                <div className="connection-detail">
                  <div>
                    <strong>公共交通</strong>
                    <span className="muted">
                      {' '}
                      {durationLabel(transit.plan.durationMinutes)} · {kmLabel(transit.plan.distanceMeters)} · 步行{' '}
                      {Math.round(transit.plan.walkMeters)} 米 · 换乘 {transit.plan.transfers} 次
                      {transit.plan.fareFen != null && ` · ${priceLabel(yuanOfFen(transit.plan.fareFen))}`}
                    </span>
                  </div>
                  <TransitSegments plan={transit.plan} />
                </div>
              )}
              {driving.kind === 'plan' && (
                <div className="connection-detail">
                  <div>
                    <strong>打车</strong>
                    <span className="muted">
                      {' '}
                      {durationLabel(driving.plan.durationMinutes)} · {kmLabel(driving.plan.distanceMeters)}
                      {driving.plan.fare != null && <> · {priceLabel(driving.plan.fare)}（路况估算）</>}
                    </span>
                  </div>
                  {driving.plan.tollYuan > 0 && (
                    <div className="muted">过路费 {priceLabel(driving.plan.tollYuan)}</div>
                  )}
                </div>
              )}
              <div className="muted">两站直线 {kmLabel(km * 1000)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
