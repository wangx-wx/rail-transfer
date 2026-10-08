/**
 * 顶层组件 —— 唯一持有查询状态的地方
 *
 * 查询流程（D39）：直达与中转分开查，结果共用一个面板，
 * 点哪个按钮显示哪种结果。
 */

import { useCallback, useRef, useState } from 'react';

import { API_BASE } from './config.ts';
import * as api from './lib/api.ts';
import { runQuery } from './lib/orchestrate.ts';
import { runSelfBuiltQuery } from './lib/selfbuilt-query.ts';
import { createSelfBuiltDeps } from './lib/selfbuilt-adapter.ts';
import { buildHubPool } from './lib/hubs.ts';
import { parseReachability, type ReachGraph } from './lib/reach.ts';
import { REACHABILITY_EDGES } from './data/reachability.ts';
import { cityOfStation } from './lib/city.ts';
import SelfBuiltList from './components/SelfBuiltList.tsx';
import type { ScoredJourney } from './lib/selfbuilt.ts';
import { findShortTicket } from './lib/buyshort.ts';
import type { BuyShortResult } from './lib/buyshort.ts';
import { parseLeftTicket, parsePrice, parseTransfer } from './lib/parse.ts';
import { processPlans } from './lib/plans.ts';
import { priceKey } from './lib/view.ts';
import type { QueryContext } from './components/QueryForm.tsx';
import QueryForm from './components/QueryForm.tsx';
import StatusBar from './components/StatusBar.tsx';
import type { StatusKind } from './components/StatusBar.tsx';
import TrainList from './components/TrainList.tsx';
import TransferList from './components/TransferList.tsx';
import type { PlanGroup, Train, TransferPlan } from '../shared/types.ts';
import { STATION_NAMES } from './data/stations.ts';

/** 当前展示的结果类型 */
type View = 'idle' | 'direct' | 'transfer' | 'selfbuilt';

/** 直达结果 */
interface DirectResult {
  trains: Train[];
  stationMap: Record<string, string>;
  /** 查询日期（YYYY-MM-DD，查价用） */
  date: string;
}

export default function App() {
  const [querying, setQuerying] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: StatusKind }>({ text: '', kind: 'info' });
  const [view, setView] = useState<View>('idle');
  const [direct, setDirect] = useState<DirectResult | null>(null);
  const [groups, setGroups] = useState<PlanGroup[]>([]);
  // 自研中转结果（T46：与 lcquery 通路并存）
  const [journeys, setJourneys] = useState<ScoredJourney[]>([]);
  // 离线可达图（T39 产物，内存构建一次）
  const reachRef = useRef<ReachGraph | null>(null);

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

  // 买短乘长：车次键 → 结果；正在查的车次键；进行中的进度（已查站数）
  const [buyShort, setBuyShort] = useState<Record<string, BuyShortResult>>({});
  const [buyShortLoading, setBuyShortLoading] = useState<Set<string>>(new Set());
  const [buyShortProgress, setBuyShortProgress] = useState<Record<string, number>>({});


  /**
   * 查一段行程的各席别价格（1 次请求）。
   * 已在缓存或查过则跳过。直达车次与中转每程共用。
   *
   * ⚠️ `seatTypes` 必须用**该车次自己的席别码串**（余票第 35 列 / 中转
   * `fullList.seat_types`）——12306 从左到右解析该串，遇到车次不支持的码就截断。
   * 写死高铁码 `OM9WZ` 会让普速车返回空。
   */
  const fetchPrice = useCallback(
    async (
      trainNo: string,
      fromStationNo: string | undefined,
      toStationNo: string | undefined,
      date: string,
      seatTypes: string,
    ) => {
      const ctx = ctxRef.current;
      const key = priceKey(trainNo, fromStationNo, toStationNo);
      if (!ctx || !key || !fromStationNo || !toStationNo || !seatTypes) return;
      if (key in prices || loadingPrice.has(key)) return;

      setLoadingPrice((prev) => new Set(prev).add(key));
      try {
        const r = await api.price(
          { trainNo, fromStationNo, toStationNo, seatTypes, date },
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

  /**
   * 查一趟车的买短乘长（D45/D48 手动懒加载）。
   * 车次键 = 车次编号（同一查询内唯一标识一趟车），结果就地挂在该卡片上。
   */
  const fetchBuyShort = useCallback(
    async (train: Train, key: string) => {
      const ctx = ctxRef.current;
      if (!ctx || buyShortLoading.has(key)) return;

      setBuyShortLoading((prev) => new Set(prev).add(key));
      setBuyShortProgress((prev) => ({ ...prev, [key]: 0 }));
      try {
        const result = await findShortTicket(train, queryDate, {
          stopover: (p) => api.stopover(p, { token: ctx.token, base: API_BASE }),
          leftTicket: (p) => api.leftTicket(p, { token: ctx.token, base: API_BASE }),
          price: (p) => api.price(p, { token: ctx.token, base: API_BASE }),
        }, {
          onProgress: (checked) => setBuyShortProgress((prev) => ({ ...prev, [key]: checked })),
        });
        setBuyShort((prev) => ({ ...prev, [key]: result }));
      } finally {
        setBuyShortLoading((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [buyShortLoading, queryDate],
  );

  /** 查直达 */
  async function onDirect(ctx: QueryContext): Promise<void> {
    if (runningRef.current) return;
    runningRef.current = true;
    ctxRef.current = ctx;
    setQueryDate(ctx.date);
    setQuerying(true);
    setView('direct');
    setDirect(null);
    setPrices({});
    setBuyShort({});
    setBuyShortProgress({});
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
      setDirect({ trains, stationMap: { ...STATION_NAMES, ...stationMap }, date: ctx.date });
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
            for (const item of r.items) {
              if (item.ok && item.data) plansRef.current.push(...parseTransfer(item.data).plans);
            }
            refresh();
            if (!r.ok) {
              setStatus({ text: `官方基线查询失败：${r.error}，改用内置枢纽兜底…`, kind: 'warn' });
            }
          },
          onSegment: (s) => {
            for (const item of s.items) {
              if (item.ok && item.data) plansRef.current.push(...parseTransfer(item.data).plans);
            }
            refresh();
            setStatus({
              text:
                `已查 ${s.index + 1}/${s.total} 段，累计 ${plansRef.current.length} 条方案` +
                (s.error ? `（查询失败：${s.error}）` : ''),
              kind: s.error ? 'warn' : 'info',
            });
          },
          onDone: ({ baseline, segments }) => {
            const errors = [
              ...(!baseline.ok ? [`官方基线：${baseline.error}`] : []),
              ...segments.filter((s) => s.error).map((s) => `第 ${s.index + 1} 段：${s.error}`),
            ];
            const hasSuccess = baseline.items.some((item) => item.ok) ||
              segments.some((s) => s.items.some((item) => item.ok));
            setStatus(errors.length ? {
              text: `${hasSuccess ? '查询部分完成' : '中转查询失败'}：中转 ${plansRef.current.length} 条方案；${errors.join('；')}`,
              kind: hasSuccess ? 'warn' : 'error',
            } : { text: `完成：中转 ${plansRef.current.length} 条方案`, kind: 'info' });
            // 自动查最优一条的两程价格（D21）
            const best = processPlans(plansRef.current)[0]?.best;
            for (const leg of best?.legs ?? []) {
              void fetchPrice(leg.trainNo, leg.fromStationNo, leg.toStationNo, ctx.date, leg.seatTypes ?? '');
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

  /** 查自研中转（T37~T46，与 lcquery 通路并存） */
  async function onSelfBuilt(ctx: QueryContext): Promise<void> {
    if (runningRef.current) return;
    runningRef.current = true;
    ctxRef.current = ctx;
    setQueryDate(ctx.date);
    setQuerying(true);
    setView('selfbuilt');
    setJourneys([]);
    setPrices({});
    setStatus({ text: '正在自研枚举中转…', kind: 'info' });

    try {
      if (!reachRef.current) reachRef.current = parseReachability(REACHABILITY_EDGES);
      const buildDeps = createSelfBuiltDeps(
        { from: ctx.from.code, to: ctx.to.code, date: ctx.date, hubs: [], maxTransfers: 1 },
        { token: ctx.token, base: API_BASE },
      );
      const r = await runSelfBuiltQuery(
        {
          from: ctx.from.code,
          to: ctx.to.code,
          date: ctx.date,
          hubs: buildHubPool(cityOfStation(ctx.from.code), cityOfStation(ctx.to.code)),
          maxTransfers: ctx.maxTransfers ?? 1,
          graph: reachRef.current,
          cityOf: cityOfStation,
          maxEdges: 60,
          rateLimit: { concurrency: 3, intervalMs: 300 },
        },
        buildDeps,
      );
      setJourneys(r.journeys);
      setStatus({
        text: `自研中转 ${r.journeys.length} 条方案（扩展 ${r.edges} 条边${r.removed ? `，剔除回头 ${r.removed} 条` : ''}）`,
        kind: 'info',
      });
    } catch (e) {
      setStatus({ text: `自研查询出错：${e}`, kind: 'error' });
    } finally {
      runningRef.current = false;
      setQuerying(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>12306 查票助手</h1>
        <p>比官方网页给出更多选择方案</p>
      </header>

      <main>
        <QueryForm querying={querying} onDirect={onDirect} onTransfer={onTransfer} onSelfBuilt={onSelfBuilt} />
        {view !== 'idle' && (
          <h2 className="results-title">
            {view === 'direct' ? '直达车次' : view === 'selfbuilt' ? '自研中转方案' : '中转方案'}
          </h2>
        )}
        <StatusBar text={status.text} kind={status.kind} />
        {view === 'direct' && (
          <TrainList
            result={direct}
            prices={prices}
            loadingPrice={loadingPrice}
            onQueryPrice={fetchPrice}
            buyShort={buyShort}
            buyShortLoading={buyShortLoading}
            buyShortProgress={buyShortProgress}
            onQueryBuyShort={fetchBuyShort}
          />
        )}
        {view === 'selfbuilt' && (
          <SelfBuiltList
            journeys={journeys}
            date={queryDate}
            stationNames={STATION_NAMES}
            prices={prices}
            loadingPrice={loadingPrice}
            onQueryPrice={fetchPrice}
          />
        )}
        {view === 'transfer' && (
          <TransferList
            groups={groups}
            date={queryDate}
            prices={prices}
            loadingPrice={loadingPrice}
            onQueryPrice={fetchPrice}
          />
        )}
      </main>
    </div>
  );
}
