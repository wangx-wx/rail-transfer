/**
 * 顶层组件 —— 唯一持有查询状态的地方
 *
 * 查询流程（D39）：直达与中转分开查，结果共用一个面板，
 * 点哪个按钮显示哪种结果。
 */

import { useCallback, useRef, useState } from 'react';
import { Button, Modal } from 'antd';

import { API_BASE } from './config.ts';
import * as api from './lib/api.ts';
import { runQuery } from './lib/orchestrate.ts';
import { runSelfBuiltQuery, estimateSelfBuiltRequests, selectHubCodes, selectHubCandidates } from './lib/selfbuilt-query.ts';
import type { HubCandidate, SelfBuiltQueryParams } from './lib/selfbuilt-query.ts';
import { createSelfBuiltDeps } from './lib/selfbuilt-adapter.ts';
import { buildHubPool } from './lib/hubs.ts';
import { parseReachability, type ReachGraph } from './lib/reach.ts';
import { MAX_HUB_DETOUR_RATIO, MAX_HUBS, MIN_HUBS } from '../shared/constants.ts';
import { REACHABILITY_EDGES } from './data/reachability.ts';
import { CITY_COORDS } from './data/coords.ts';
import { cityOfStation } from './lib/city.ts';
import SelfBuiltList from './components/SelfBuiltList.tsx';
import HubPicker from './components/HubPicker.tsx';
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

/** 当前展示的结果类型（`hubs` = D68 中转换乘枢纽选择中间态） */
type View = 'idle' | 'direct' | 'transfer' | 'selfbuilt' | 'hubs';

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
  // D68 枢纽选择：候选（离线算出）+ 已选站码
  const [candidates, setCandidates] = useState<HubCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  // 阶段一（选枢纽）暂存的查询参数，供阶段二（查询）复用；不进 state，避免多余渲染
  const stageRef = useRef<SelfBuiltQueryParams | null>(null);
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
    // 丢弃 D68 阶段的候选，避免切回时看到陈旧选择
    setCandidates([]);
    setSelected([]);
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
    // 丢弃 D68 阶段的候选，避免切回时看到陈旧选择
    setCandidates([]);
    setSelected([]);
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

  /**
   * 阶段一（D68）：算候选中转枢纽，**零请求**、瞬时。
   *
   * 只做纯离线计算（可达图 + 坐标），切到 `'hubs'` 让用户挑 1~2 个；
   * 参数暂存 `stageRef` 供阶段二复用。
   */
  function onSelfBuilt(ctx: QueryContext): void {
    ctxRef.current = ctx;
    setQueryDate(ctx.date);
    if (!reachRef.current) reachRef.current = parseReachability(REACHABILITY_EDGES);
    const params: SelfBuiltQueryParams = {
      from: ctx.from.code,
      to: ctx.to.code,
      date: ctx.date,
      hubs: buildHubPool(cityOfStation(ctx.from.code), cityOfStation(ctx.to.code)),
      maxTransfers: 1, // 占位；阶段二按选中数定
      graph: reachRef.current,
      coords: CITY_COORDS,
      cityOf: cityOfStation,
      maxHubRatio: MAX_HUB_DETOUR_RATIO,
      maxHubs: MAX_HUBS,
      minHubs: MIN_HUBS,
      maxDetourChecks: 20,
      beamPerStation: 24,
      beamSize: 480,
    };
    stageRef.current = params;
    setCandidates(selectHubCandidates(params));
    setSelected([]);
    setJourneys([]);
    setPrices({});
    setView('hubs');
    setStatus({ text: '候选枢纽（离线计算，未发起任何请求）', kind: 'info' });
  }

  /** 用户点选 / 取消一个候选枢纽（最多 2 个；顺序无关） */
  function toggleHub(code: string): void {
    setSelected((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= 2) return prev;
      return [...prev, code];
    });
  }

  /** 阶段二（D68）：按用户选中的枢纽跑查询 */
  async function runSelfBuilt(): Promise<void> {
    const params = stageRef.current;
    if (!params || !selected.length || runningRef.current) return;
    runningRef.current = true;
    setQuerying(true);
    setView('selfbuilt');
    setJourneys([]);
    setStatus({ text: '正在自研枚举中转…', kind: 'info' });

    try {
      const rateLimit = { concurrency: 3, intervalMs: 300 } as const;
      const maxTransfers = selected.length === 2 ? 2 : 1;
      // 枢纽锁定（D68）：跳过过滤，原序查询用户所选；边预算留余量（d²+2d 恰好打满偏脆）
      const d = selected.length;
      const maxEdges = d === 1 ? 2 : d * d + 2 * d + 2;
      const runParams: SelfBuiltQueryParams = {
        ...params,
        hubs: selected,
        hubsLocked: true,
        maxTransfers,
      };

      // 请求量预估 + 超限确认（T50/D65）——发起前先算
      const est = estimateSelfBuiltRequests(runParams, { intervalMs: rateLimit.intervalMs });
      if (est.seconds >= 15) {
        const ok = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '请求量较大，确认发起？',
            content: `预计向 12306 发起约 ${est.requests} 次请求（${est.hubs} 个枢纽），约需 ${est.seconds} 秒。不含后续查价。`,
            okText: '继续',
            cancelText: '取消',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!ok) {
          setStatus({ text: '已取消自研查询', kind: 'info' });
          return;
        }
      }

      const ctx = ctxRef.current!;
      const buildDeps = createSelfBuiltDeps(
        { from: params.from, to: params.to, date: params.date, hubs: [], maxTransfers: 1 },
        { token: ctx.token, base: API_BASE },
      );
      const r = await runSelfBuiltQuery({ ...runParams, maxEdges, rateLimit }, buildDeps);
      setJourneys(r.journeys);
      setStatus({
        text: `自研中转 ${r.journeys.length} 条方案（经 ${r.hubs.length} 个枢纽，扩展 ${r.edges} 条边${r.removed ? `，剔除回头 ${r.removed} 条` : ''}）`,
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
            {view === 'direct'
              ? '直达车次'
              : view === 'selfbuilt'
                ? '自研中转方案'
                : view === 'hubs'
                  ? '选择中转枢纽'
                  : '中转方案'}
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
        {view === 'hubs' && (
          <HubPicker
            candidates={candidates}
            selected={selected}
            onChange={setSelected}
            onRun={runSelfBuilt}
            onCancel={() => {
              setView('idle');
              setCandidates([]);
              setSelected([]);
            }}
            running={querying}
          />
        )}
        {view === 'selfbuilt' && (
          <>
            <div className="results-toolbar">
              <Button
                type="link"
                onClick={() => {
                  // 回到枢纽选择，清空旧结果避免误以为已更新
                  setJourneys([]);
                  setView('hubs');
                }}
              >
                重新选择枢纽
              </Button>
            </div>
            <SelfBuiltList
              journeys={journeys}
              date={queryDate}
              stationNames={STATION_NAMES}
              prices={prices}
              loadingPrice={loadingPrice}
              onQueryPrice={fetchPrice}
            />
          </>
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
