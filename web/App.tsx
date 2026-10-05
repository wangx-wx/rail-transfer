/**
 * 顶层组件 —— 唯一持有查询状态的地方
 *
 * 查询流程（D39）：直达与中转分开查，结果共用一个面板，
 * 点哪个按钮显示哪种结果。
 */

import { useCallback, useRef, useState } from 'react';
import { Layout, Typography } from 'antd';

import { API_BASE } from './config.ts';
import * as api from './lib/api.ts';
import { runQuery } from './lib/orchestrate.ts';
import { parseLeftTicket, parsePrice, parseTransfer } from './lib/parse.ts';
import { processPlans } from './lib/plans.ts';
import { priceKey } from './lib/view.ts';
import { PRICE_SEAT_TYPES } from '../shared/constants.ts';
import type { QueryContext } from './components/QueryForm.tsx';
import QueryForm from './components/QueryForm.tsx';
import StatusBar from './components/StatusBar.tsx';
import type { StatusKind } from './components/StatusBar.tsx';
import TrainList from './components/TrainList.tsx';
import TransferList from './components/TransferList.tsx';
import type { PlanGroup, Train, TransferPlan } from '../shared/types.ts';
import { STATION_NAMES } from './data/stations.ts';

/** 当前展示的结果类型 */
type View = 'idle' | 'direct' | 'transfer';

/** 直达结果 */
interface DirectResult {
  trains: Train[];
  stationMap: Record<string, string>;
  seat: string;
  /** 查询日期（YYYY-MM-DD，查价用） */
  date: string;
}

export default function App() {
  const [querying, setQuerying] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: StatusKind }>({ text: '', kind: 'info' });
  const [view, setView] = useState<View>('idle');
  const [direct, setDirect] = useState<DirectResult | null>(null);
  const [groups, setGroups] = useState<PlanGroup[]>([]);

  // 重入锁：state 更新是异步的，同 tick 双击时 querying 尚未变化，必须用 ref
  const runningRef = useRef(false);
  // 流式累积的中转方案（避免每段拷贝大数组进 state）
  const plansRef = useRef<TransferPlan[]>([]);

  // 价格缓存（键 = priceKey → 各席别价格表），直达与中转每程共用
  const [prices, setPrices] = useState<Record<string, Record<string, number>>>({});
  // 正在查价的车次键，用于按钮 loading 态
  const [loadingPrice, setLoadingPrice] = useState<Set<string>>(new Set());
  // 查价用的查询上下文（口令），查价时复用
  const ctxRef = useRef<QueryContext | null>(null);
  // 当前查询日期（传给列表用于查价）
  const [queryDate, setQueryDate] = useState('');
  // 当前查询席别（合计参考价按它求和）
  const [ctxSeat, setCtxSeat] = useState('ZE');

  /**
   * 查一段行程的各席别价格（1 次请求，传全部席别码）。
   * 已在缓存或查过则跳过。直达车次与中转每程共用。
   */
  const fetchPrice = useCallback(
    async (trainNo: string, fromStationNo: string | undefined, toStationNo: string | undefined, date: string) => {
      const ctx = ctxRef.current;
      const key = priceKey(trainNo, fromStationNo, toStationNo);
      if (!ctx || !key || !fromStationNo || !toStationNo) return;
      if (key in prices || loadingPrice.has(key)) return;

      setLoadingPrice((prev) => new Set(prev).add(key));
      try {
        const r = await api.price(
          { trainNo, fromStationNo, toStationNo, seatTypes: PRICE_SEAT_TYPES, date },
          { token: ctx.token, base: API_BASE },
        );
        const map = r.ok ? parsePrice(r.data) : {};
        if (Object.keys(map).length) setPrices((prev) => ({ ...prev, [key]: map }));
      } finally {
        setLoadingPrice((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [prices, loadingPrice],
  );

  /** 查直达 */
  async function onDirect(ctx: QueryContext): Promise<void> {
    if (runningRef.current) return;
    runningRef.current = true;
    ctxRef.current = ctx;
    setQueryDate(ctx.date);
    setCtxSeat(ctx.seat);
    setQuerying(true);
    setView('direct');
    setDirect(null);
    setPrices({});
    setStatus({ text: '正在查询直达…', kind: 'info' });

    try {
      const r = await api.leftTicket(
        { from: ctx.from.code, to: ctx.to.code, date: ctx.date },
        { token: ctx.token, base: API_BASE },
      );
      if (!r.ok) {
        setStatus({ text: `直达查询失败：${r.error}`, kind: 'error' });
        return;
      }
      const { trains, stationMap } = parseLeftTicket(r.data);
      // 合并全量站名表（直达响应自带的 map 只覆盖少数站）
      setDirect({ trains, stationMap: { ...STATION_NAMES, ...stationMap }, seat: ctx.seat, date: ctx.date });
      setStatus({ text: `直达 ${trains.length} 趟`, kind: 'info' });
    } catch (e) {
      setStatus({ text: `查询出错：${e}`, kind: 'error' });
    } finally {
      runningRef.current = false;
      setQuerying(false);
    }
  }

  /** 查中转 */
  async function onTransfer(ctx: QueryContext): Promise<void> {
    if (runningRef.current) return;
    runningRef.current = true;
    ctxRef.current = ctx;
    setQueryDate(ctx.date);
    setCtxSeat(ctx.seat);
    setQuerying(true);
    setView('transfer');
    plansRef.current = [];
    setGroups([]);
    setPrices({});
    setStatus({ text: '正在查询官方基线…', kind: 'info' });

    /** 把累积的方案重新分组排序后写进 state（传新数组引用） */
    const refresh = (): void => setGroups(processPlans(plansRef.current));

    try {
      await runQuery(
        { from: ctx.from.code, to: ctx.to.code, date: ctx.date, exclude: [...ctx.from.stations, ...ctx.to.stations] },
        {
          leftTicket: (p) => api.leftTicket(p, { token: ctx.token, base: API_BASE }),
          transfer: (p) => api.transfer(p, { token: ctx.token, base: API_BASE }),
        },
        {
          onDirect: () => {}, // 中转查询不展示直达
          onBaseline: (r) => {
            if (!r.ok) {
              setStatus({ text: '官方基线查询失败，改用内置枢纽兜底…', kind: 'warn' });
              return;
            }
            for (const item of r.items) {
              if (item.ok && item.data) plansRef.current.push(...parseTransfer(item.data).plans);
            }
            refresh();
          },
          onSegment: (s) => {
            for (const item of s.items) {
              if (item.ok && item.data) plansRef.current.push(...parseTransfer(item.data).plans);
            }
            const failed = s.items.filter((i) => !i.ok).length;
            refresh();
            setStatus({
              text:
                `已查 ${s.index + 1}/${s.total} 段，累计 ${plansRef.current.length} 条方案` +
                (failed ? `（${failed} 个枢纽失败）` : ''),
              kind: failed ? 'warn' : 'info',
            });
          },
          onDone: () => {
            setStatus({ text: `完成：中转 ${plansRef.current.length} 条方案`, kind: 'info' });
            // 自动查最优一条的两程价格（D21）
            const best = processPlans(plansRef.current)[0]?.best;
            for (const leg of best?.legs ?? []) {
              void fetchPrice(leg.trainNo, leg.fromStationNo, leg.toStationNo, ctx.date);
            }
          },
        },
      );
    } catch (e) {
      setStatus({ text: `查询出错：${e}`, kind: 'error' });
    } finally {
      runningRef.current = false;
      setQuerying(false);
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ background: 'linear-gradient(135deg, #1e3a8a, #2563eb)' }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0, lineHeight: '64px' }}>
          12306 中转换乘查询{' '}
          <Typography.Text style={{ color: 'rgba(255,255,255,.8)', fontSize: 13, fontWeight: 400 }}>
            比官方网页给出更多中转方案
          </Typography.Text>
        </Typography.Title>
      </Layout.Header>

      <Layout.Content style={{ maxWidth: 980, width: '100%', margin: '0 auto', padding: 18 }}>
        <QueryForm querying={querying} onDirect={onDirect} onTransfer={onTransfer} />
        <StatusBar text={status.text} kind={status.kind} />
        {view === 'direct' && (
          <TrainList result={direct} prices={prices} loadingPrice={loadingPrice} onQueryPrice={fetchPrice} />
        )}
        {view === 'transfer' && (
          <TransferList
            groups={groups}
            date={queryDate}
            seat={ctxSeat}
            prices={prices}
            loadingPrice={loadingPrice}
            onQueryPrice={fetchPrice}
          />
        )}
      </Layout.Content>
    </Layout>
  );
}
