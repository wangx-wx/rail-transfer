/**
 * 同城异站接驳：纯函数编排测试（D69~D76 / T60）
 *
 * 只断言外部可见结果：给定坐标 / 上游响应 → 展示模型。
 * 期望值来自独立事实（几何常量、腾讯真实响应样本、规格里写死的规则），不由被测代码反推。
 */

import { test, expect } from 'vitest';

import {
  CROSS_CITY_KM,
  classifyTencentStatus,
  connectionFlags,
  distanceKm,
  gateConnection,
  loadConnection,
  parseDrivingRoute,
  parseTransitRoutes,
  pickFastestTransit,
} from '../lib/connection.ts';
import type {
  ConnectionResult,
  DrivingPlan,
  TencentDrivingRoute,
  TencentTransitResult,
  TencentTransitLine,
  TencentTransitRoute,
  TencentTransitTransit,
  TransitPlan,
} from '../lib/connection.ts';

// ── 直线距离 ─────────────────────────────────────────────
test('distanceKm：同一点为 0', () => {
  expect(distanceKm({ lat: 30, lng: 120 }, { lat: 30, lng: 120 })).toBe(0);
});

test('distanceKm：纬度相差 1 度约 111 公里（子午线弧长）', () => {
  // 独立事实：地球子午线 1 度 ≈ 111.1~111.3 km，与实现无关
  const d = distanceKm({ lat: 30, lng: 120 }, { lat: 31, lng: 120 });
  expect(d).toBeGreaterThan(110.5);
  expect(d).toBeLessThan(111.8);
});

test('distanceKm：北京南 → 北京西 约 5.9 公里（打车 11 公里、地铁 8 公里）', () => {
  // 两站真实坐标（腾讯公交实测：地铁方案 8056 米、驾车 11057 米）
  const d = distanceKm(
    { lat: 39.865022, lng: 116.378999 },
    { lat: 39.894712, lng: 116.321193 },
  );
  expect(d).toBeGreaterThan(5.5);
  expect(d).toBeLessThan(6.5);
});

test('distanceKm：与方向无关（对称）', () => {
  const a = { lat: 39.865022, lng: 116.378999 };
  const b = { lat: 31.2304, lng: 121.4737 };
  expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
});

// ── 跨城判定（D75）──────────────────────────────────────
const BJS = { lat: 39.865022, lng: 116.378999 }; // 北京南
const BXX = { lat: 39.894712, lng: 116.321193 }; // 北京西

test('gateConnection：同城两站（直线 5.9 km）→ 可查接驳', () => {
  expect(gateConnection(BJS, BXX)).toEqual({ kind: 'ok', km: expect.closeTo(5.9, 0) });
});

test('gateConnection：直线超过 50 km → 跨城，只给事实不给方案', () => {
  // 纬度差 1 度 ≈ 111 km，远超 50 km 阈值
  const far = { lat: 38.865022, lng: 116.378999 };
  const g = gateConnection(BJS, far);
  expect(g.kind).toBe('crossCity');
  expect(g.kind === 'crossCity' && g.km).toBeGreaterThan(110);
  expect(g.kind === 'crossCity' && g.km).toBeLessThan(112);
});

test('gateConnection：阈值是 50 km（D75 字面量），两侧留余量各判一边', () => {
  expect(CROSS_CITY_KM).toBe(50);
  // 1 度纬度 ≈ 111.19 km；取 49.5 / 50.5 km 避开浮点边界本身
  const near = { lat: 39.865022 + 49.5 / 111.195, lng: 116.378999 };
  expect(gateConnection(BJS, near).kind).toBe('ok');
  const over = { lat: 39.865022 + 50.5 / 111.195, lng: 116.378999 };
  expect(gateConnection(BJS, over).kind).toBe('crossCity');
});

test('gateConnection：缺任一坐标 → noCoord（不查、不猜）', () => {
  expect(gateConnection(undefined, BXX)).toEqual({ kind: 'noCoord' });
  expect(gateConnection(BJS, undefined)).toEqual({ kind: 'noCoord' });
  expect(gateConnection(undefined, undefined)).toEqual({ kind: 'noCoord' });
});

// ── 公交方案解析（T57：无步行汇总、无换乘次数字段）──────────
/**
 * 腾讯真实响应（北京南 → 北京西，price_unit=1）的形状。
 * 真实值：3 段步行 49+257+74 = 380 米；2 段乘车即换乘 1 次；票价 400 分 = ¥4。
 */
function transitRoute(over: Partial<TencentTransitRoute> = {}): TencentTransitRoute {
  return {
    distance: 8056,
    duration: 30,
    price: 400,
    steps: [
      { mode: 'WALKING', distance: 49, duration: 1 },
      {
        mode: 'TRANSIT',
        lines: [
          {
            vehicle: 'SUBWAY', title: '地铁4号线大兴线', station_count: 2, running_status: 300,
            price: -1, distance: 2790, duration: 8,
            geton: { title: '北京南站' }, getoff: { title: '菜市口' },
          },
        ],
      },
      { mode: 'WALKING', distance: 257, duration: 4 },
      {
        mode: 'TRANSIT',
        lines: [
          {
            vehicle: 'SUBWAY', title: '地铁7号线', station_count: 4, running_status: 300,
            price: -1, distance: 4886, duration: 12,
            geton: { title: '菜市口' }, getoff: { title: '北京西站' },
          },
        ],
      },
      { mode: 'WALKING', distance: 74, duration: 1 },
    ],
    ...over,
  };
}

/** 造一段乘车（默认是第一条地铁线；可改车型与线路名） */
function ride(over: Partial<TencentTransitLine> = {}): TencentTransitTransit {
  return {
    mode: 'TRANSIT',
    lines: [
      {
        vehicle: 'SUBWAY', title: '地铁4号线大兴线', station_count: 2, running_status: 300,
        price: -1, distance: 2790, duration: 8,
        geton: { title: '北京南站' }, getoff: { title: '菜市口' },
        ...over,
      },
    ],
  };
}

test('parseTransitRoutes：步行距离是各步行段之和（上游无汇总字段）', () => {
  const [p] = parseTransitRoutes({ routes: [transitRoute()] });
  expect(p!.walkMeters).toBe(380);
});

// ── D78：逐段时长——用户要看到「每一段各需多久」 ──────────
test('parseTransitRoutes：保留逐段明细，含步行段与乘车段（D78）', () => {
  const [p] = parseTransitRoutes({ routes: [transitRoute()] });

  // 样本：步行1分 → 地铁8分 → 步行4分 → 地铁12分 → 步行1分
  expect(p!.segments!).toHaveLength(5);
  expect(p!.segments!.map((s) => s.mode)).toEqual([
    'WALKING', 'TRANSIT', 'WALKING', 'TRANSIT', 'WALKING',
  ]);
  expect(p!.segments!.map((s) => s.durationMinutes)).toEqual([1, 8, 4, 12, 1]);
});

test('parseTransitRoutes：步行段只给距离与时长，没有起止站名（D78）', () => {
  const [p] = parseTransitRoutes({ routes: [transitRoute()] });
  const walk = p!.segments![0]!;
  expect(walk.mode).toBe('WALKING');
  expect(walk.distanceMeters).toBe(49);
  // 上游 WALKING 步骤不含 geton/getoff，不能编造
  expect(walk.title).toBeUndefined();
  expect(walk.geton).toBeUndefined();
  expect(walk.getoff).toBeUndefined();
});

test('parseTransitRoutes：乘车段带线路名、上下车站、站数与时长（D78）', () => {
  const [p] = parseTransitRoutes({ routes: [transitRoute()] });
  const ride = p!.segments![1]!;
  expect(ride.mode).toBe('TRANSIT');
  expect(ride.title).toBe('地铁4号线大兴线');
  expect(ride.geton).toBe('北京南站');
  expect(ride.getoff).toBe('菜市口');
  expect(ride.stationCount).toBe(2);
  expect(ride.durationMinutes).toBe(8);
});

test('parseTransitRoutes：换乘次数 = 乘车段数 − 1', () => {
  const [p] = parseTransitRoutes({ routes: [transitRoute()] });
  expect(p!.transfers).toBe(1);
  // 单段直达（只坐一趟车）→ 0 次换乘
  const direct = transitRoute({ steps: [ride()] });
  expect(parseTransitRoutes({ routes: [direct] })[0]!.transfers).toBe(0);
});

test('parseTransitRoutes：直达方案无步行段 → 步行 0（不报错）', () => {
  const p = parseTransitRoutes({ routes: [transitRoute({ steps: [ride()] })] })[0]!;
  expect(p.walkMeters).toBe(0);
});

test('parseTransitRoutes：票价按分保留（-1 = 无票价信息 → null）', () => {
  expect(parseTransitRoutes({ routes: [transitRoute()] })[0]!.fareFen).toBe(400);
  expect(parseTransitRoutes({ routes: [transitRoute({ price: -1 })] })[0]!.fareFen).toBeNull();
});

test('parseTransitRoutes：hasSubway 认 SUBWAY 与 RAIL，纯 BUS 为 false', () => {
  expect(parseTransitRoutes({ routes: [transitRoute()] })[0]!.hasSubway).toBe(true);
  const busOnly = transitRoute({ steps: [ride({ vehicle: 'BUS', title: '1路' })] });
  expect(parseTransitRoutes({ routes: [busOnly] })[0]!.hasSubway).toBe(false);
  const rail = transitRoute({ steps: [ride({ vehicle: 'RAIL', title: '京津城际' })] });
  expect(parseTransitRoutes({ routes: [rail] })[0]!.hasSubway).toBe(true);
});

test('parseTransitRoutes：线路按乘车顺序给出名称与上下车站', () => {
  const [p] = parseTransitRoutes({ routes: [transitRoute()] });
  expect(p!.lines.map((l) => l.title)).toEqual(['地铁4号线大兴线', '地铁7号线']);
  expect(p!.lines[0]!.geton).toBe('北京南站');
  expect(p!.lines[1]!.getoff).toBe('北京西站');
});

test('parseTransitRoutes：多方案取耗时最短（上游未承诺排序）', () => {
  const slow = transitRoute({ duration: 45, distance: 9000 });
  const fast = transitRoute({ duration: 22, distance: 7800 });
  // 故意把慢的放前面：若实现只取 routes[0] 就会错
  const routes = parseTransitRoutes({ routes: [slow, fast] });
  expect(pickFastestTransit(routes)!.durationMinutes).toBe(22);
});

test('parseTransitRoutes：空 routes → 空数组，pickFastest 得 null', () => {
  expect(parseTransitRoutes({ routes: [] })).toEqual([]);
  expect(pickFastestTransit([])).toBeNull();
  expect(parseTransitRoutes(undefined)).toEqual([]);
});

// ── 打车方案解析（D76）────────────────────────────────────
test('parseDrivingRoute：上游给了打车费就展示，标「路况估算」', () => {
  const p = parseDrivingRoute({
    distance: 11057,
    duration: 16,
    toll: 0,
    taxi_fare: { fare: 33 },
  })!;
  expect(p.durationMinutes).toBe(16);
  expect(p.distanceMeters).toBe(11057);
  expect(p.fare).toBe(33);
  expect(p.tollYuan).toBe(0);
});

test('parseDrivingRoute：上游没给车费 → 不给价，只给时间与里程（不做本地估价）', () => {
  // 实测：短途（≤50 km）腾讯不返回 taxi_fare，本功能正落在这个区间
  const p = parseDrivingRoute({ distance: 11057, duration: 16, toll: 0 })!;
  expect(p.durationMinutes).toBe(16);
  expect(p.distanceMeters).toBe(11057);
  expect(p.fare).toBeNull();
});

test('parseDrivingRoute：taxi_fare 为 0 或负数视为无效，不给价', () => {
  expect(parseDrivingRoute({ distance: 11057, duration: 16, taxi_fare: { fare: 0 } })!.fare).toBeNull();
  expect(parseDrivingRoute({ distance: 11057, duration: 16, taxi_fare: { fare: -1 } })!.fare).toBeNull();
});

test('parseDrivingRoute：过路费单列（toll > 0）', () => {
  const p = parseDrivingRoute({ distance: 60000, duration: 50, toll: 25, taxi_fare: { fare: 150 } })!;
  expect(p.tollYuan).toBe(25);
});

test('parseDrivingRoute：无 routes / 空响应 → null（不是 0 分钟）', () => {
  expect(parseDrivingRoute(undefined)).toBeNull();
});

// ── 接驳标记（D73：三档判定沿用既有 20 分阈值）──────────────
function transit(minutes: number, over: Partial<TransitPlan> = {}): TransitPlan {
  return {
    durationMinutes: minutes,
    distanceMeters: 8000,
    walkMeters: 380,
    fareFen: 400,
    transfers: 1,
    hasSubway: true,
    lines: [],
    ...over,
  };
}

function driving(minutes: number): DrivingPlan {
  return { durationMinutes: minutes, distanceMeters: 11000, fare: 33, tollYuan: 0 };
}

test('connectionFlags：打车都赶不上 → 接驳时间不足（不重复给「需打车」）', () => {
  const f = connectionFlags({ waitMinutes: 20, transit: transit(50), driving: driving(30), km: 6 });
  expect(f.map((x) => x.label)).toEqual(['接驳时间不足']);
});

test('connectionFlags：公交赶不上、打车赶得上 → 需打车', () => {
  const f = connectionFlags({ waitMinutes: 40, transit: transit(52), driving: driving(28), km: 6 });
  expect(f.map((x) => x.label)).toEqual(['需打车']);
});

test('connectionFlags：都赶得上但余量不足 20 分 → 接驳紧张', () => {
  // 较快是打车 28 分，余 40−28 = 12 分 < 20
  const f = connectionFlags({ waitMinutes: 40, transit: transit(35), driving: driving(28), km: 6 });
  expect(f.map((x) => x.label)).toEqual(['接驳紧张']);
});

test('connectionFlags：余量正好 20 分不标记（阈值是「小于」）', () => {
  const f = connectionFlags({ waitMinutes: 60, transit: transit(40), driving: driving(35), km: 6 });
  expect(f).toEqual([]);
});

test('connectionFlags：快慢都富余 → 无标记', () => {
  const f = connectionFlags({ waitMinutes: 120, transit: transit(52), driving: driving(28), km: 6 });
  expect(f).toEqual([]);
});

test('connectionFlags：公交无地铁 → 无地铁', () => {
  const f = connectionFlags({
    waitMinutes: 120, transit: transit(52, { hasSubway: false }), driving: driving(28), km: 6,
  });
  expect(f.map((x) => x.label)).toEqual(['无地铁']);
});

test('connectionFlags：缺少某类方案时只按有的一类判定', () => {
  // 只有打车：40 分等待、28 分车程 → 余 12 分紧张
  expect(connectionFlags({ waitMinutes: 40, transit: null, driving: driving(28), km: 6 }).map((x) => x.label))
    .toEqual(['接驳紧张']);
  // 只有公交且在 20 分内 → 紧张
  expect(connectionFlags({ waitMinutes: 30, transit: transit(15), driving: null, km: 6 }).map((x) => x.label))
    .toEqual(['接驳紧张']);
  // 两类都缺 → 无标记，也不报「不足」
  expect(connectionFlags({ waitMinutes: 40, transit: null, driving: null, km: 6 })).toEqual([]);
});

test('connectionFlags：公交 301/302/303 → 可能错过末班 / 首班未发 / 停运', () => {
  const run = (status: number): string[] =>
    connectionFlags({
      waitMinutes: 120,
      transit: transit(30, { lines: [{ vehicle: 'SUBWAY', title: '地铁7号线', geton: 'a', getoff: 'b', stationCount: 4, runningStatus: status }] }),
      driving: driving(20),
      km: 6,
    }).map((x) => x.label);
  expect(run(301)).toEqual(['可能错过末班']);
  expect(run(302)).toEqual(['首班未发']);
  expect(run(303)).toEqual(['停运']);
  expect(run(300)).toEqual([]);
});

test('connectionFlags：多个状态码取最严重的一个（停运 > 首班未发 > 末班）', () => {
  const lines = [
    { vehicle: 'SUBWAY' as const, title: 'a', geton: '', getoff: '', stationCount: 1, runningStatus: 301 },
    { vehicle: 'SUBWAY' as const, title: 'b', geton: '', getoff: '', stationCount: 1, runningStatus: 303 },
  ];
  const f = connectionFlags({ waitMinutes: 120, transit: transit(30, { lines }), driving: driving(20), km: 6 });
  expect(f.map((x) => x.label)).toEqual(['停运']);
});

test('connectionFlags：跨城只给「跨城接驳」，不再叠时间类标记', () => {
  const f = connectionFlags({ waitMinutes: 20, transit: transit(50), driving: driving(30), km: 110 });
  expect(f.map((x) => x.label)).toEqual(['跨城接驳']);
});

test('connectionFlags：标记按固定顺序（不足 → 需打车 → 紧张 → 无地铁 → 跨城 → 公交状态）', () => {
  const f = connectionFlags({
    waitMinutes: 10,
    transit: transit(50, { hasSubway: false, lines: [{ vehicle: 'BUS', title: '1路', geton: '', getoff: '', stationCount: 2, runningStatus: 303 }] }),
    driving: driving(30),
    km: 6,
  });
  expect(f.map((x) => x.label)).toEqual(['接驳时间不足', '无地铁', '停运']);
});

// ── 错误分类（T58：配额/瞬时错误可重试，业务性无结果不可重试）──
test('classifyTencentStatus：0 = 成功', () => {
  expect(classifyTencentStatus(0)).toEqual({ kind: 'ok' });
});

test('classifyTencentStatus：配额与瞬时错误可重试', () => {
  // 120 每秒上限、121 每日上限、5xx 后端错误
  for (const code of [120, 121, 500, 510, 520, 531]) {
    expect(classifyTencentStatus(code).kind).toBe('retriable');
  }
});

test('classifyTencentStatus：不支持该城市 / 无可达路线不可重试，且带原因', () => {
  const noCity = classifyTencentStatus(335);
  expect(noCity.kind).toBe('unsupportedCity');
  expect(classifyTencentStatus(347).kind).toBe('noResult');
  expect(classifyTencentStatus(327).kind).toBe('noResult');
});

test('classifyTencentStatus：key 无效 / 未授权不可重试（重试也没用）', () => {
  for (const code of [110, 111, 112, 113, 190, 199, 311]) {
    expect(classifyTencentStatus(code).kind).toBe('config');
  }
});

test('classifyTencentStatus：未知码按不可重试错误处理', () => {
  expect(classifyTencentStatus(9999).kind).toBe('error');
});

// ── 编排入口（T60：并行取数 + 站对缓存）──────────────────
/** 可编程的腾讯取数 mock，记录被调次数 */
function mockConnApi(opts: {
  transit?: TencentTransitResult;
  driving?: TencentDrivingRoute;
  transitStatus?: number;
  drivingStatus?: number;
  throwTransit?: boolean;
  throwDriving?: boolean;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    api: {
      async transit() {
        calls.push('transit');
        if (opts.throwTransit) throw new Error('网络炸了');
        return {
          status: opts.transitStatus ?? 0,
          result: opts.transitStatus != null && opts.transitStatus !== 0 ? undefined : (opts.transit ?? { routes: [] }),
        };
      },
      async driving() {
        calls.push('driving');
        if (opts.throwDriving) throw new Error('网络炸了');
        return {
          status: opts.drivingStatus ?? 0,
          result:
            opts.drivingStatus != null && opts.drivingStatus !== 0
              ? undefined
              : opts.driving
                ? { routes: [opts.driving] }
                : undefined,
        };
      },
    },
  };
}

const PAIR = {
  from: BJS, to: BXX,
  fromCode: 'VNP', toCode: 'BXP',
  waitMinutes: 90,
  departureTime: '14:00',
  city: '北京',
};

test('loadConnection：公交与打车都取到 → 两类方案都在，带标记', async () => {
  const { api } = mockConnApi({
    transit: { routes: [transitRoute()] },
    driving: { distance: 11057, duration: 16, toll: 0, taxi_fare: { fare: 33 } },
  });
  const r = await loadConnection(PAIR, api);
  expect(r.kind).toBe('ok');
  if (r.kind !== 'ok') return;
  expect(r.transit.kind).toBe('plan');
  expect(r.driving.kind === 'plan' && r.driving.plan.durationMinutes).toBe(16);
  expect(r.km).toBeCloseTo(5.9, 1);
  expect(r.flags).toEqual([]);
});

test('loadConnection：一次点击并行发两类请求', async () => {
  const { api, calls } = mockConnApi({
    transit: { routes: [transitRoute()] },
    driving: { distance: 11057, duration: 16 },
  });
  await loadConnection(PAIR, api);
  expect(calls.sort()).toEqual(['driving', 'transit']);
});

test('loadConnection：公交侧业务失败不拖垮打车侧', async () => {
  const { api } = mockConnApi({
    transitStatus: 335,
    driving: { distance: 11057, duration: 16 },
  });
  const r = await loadConnection(PAIR, api);
  if (r.kind !== 'ok') throw new Error('应仍给出结果');
  expect(r.transit).toEqual({ kind: 'error', message: '腾讯不支持该城市的公交查询', retriable: false });
  expect(r.driving.kind).toBe('plan');
});

test('loadConnection：网络异常 → 可重试错误', async () => {
  const { api } = mockConnApi({ throwTransit: true, driving: { distance: 11057, duration: 16 } });
  const r = await loadConnection(PAIR, api);
  if (r.kind !== 'ok') throw new Error('应仍给出结果');
  expect(r.transit.kind).toBe('error');
  expect(r.transit.kind === 'error' && r.transit.retriable).toBe(true);
});

test('loadConnection：配额超限可重试，无路线不可重试', async () => {
  const limited = await loadConnection(PAIR, mockConnApi({ transitStatus: 121 }).api);
  expect(limited.kind === 'ok' && limited.transit.kind === 'error' && limited.transit.retriable).toBe(true);
  const empty = await loadConnection(PAIR, mockConnApi({ transitStatus: 347 }).api);
  expect(empty.kind === 'ok' && empty.transit).toEqual({ kind: 'empty' });
});

test('loadConnection：同一站对只请求一次（并发去重）', async () => {
  const { api, calls } = mockConnApi({
    transit: { routes: [transitRoute()] },
    driving: { distance: 11057, duration: 16 },
  });
  const cache = new Map();
  await Promise.all([
    loadConnection(PAIR, api, cache),
    loadConnection(PAIR, api, cache),
    loadConnection(PAIR, api, cache),
  ]);
  expect(calls).toEqual(['transit', 'driving']);
});

test('loadConnection：跨查询复用缓存（乘车日期无关），反方向不串味', async () => {
  const { api, calls } = mockConnApi({
    transit: { routes: [transitRoute()] },
    driving: { distance: 11057, duration: 16 },
  });
  const cache = new Map();
  await loadConnection(PAIR, api, cache);
  await loadConnection(PAIR, api, cache); // 第二次查询同一方向
  await loadConnection({ ...PAIR, from: BXX, to: BJS, fromCode: 'BXP', toCode: 'VNP' }, api, cache);
  expect(calls).toEqual(['transit', 'driving', 'transit', 'driving']);
});

test('loadConnection：缺坐标 / 跨城直接返回，不发任何请求', async () => {
  const { api, calls } = mockConnApi({ transit: { routes: [] } });
  expect(await loadConnection({ ...PAIR, to: undefined }, api)).toEqual({ kind: 'noCoord' });
  const far = { lat: 38.865022, lng: 116.378999 };
  const r = await loadConnection({ ...PAIR, to: far }, api);
  expect(r.kind).toBe('crossCity');
  expect(calls).toEqual([]);
});

// ── 缓存正确性：时间相关的判定不能跨行程串味 ──────────────
test('loadConnection：同站对不同等待 → 标记各算各的（不被缓存串味）', async () => {
  const { api, calls } = mockConnApi({
    transit: { routes: [transitRoute()] },   // 30 分
    driving: { distance: 11057, duration: 16 },
  });
  const cache = new Map();
  // 等待 90 分：富余；等待 20 分：公交 30 分赶不上、打车 16 分赶得上 → 需打车
  const a = await loadConnection(PAIR, api, cache);
  const b = await loadConnection({ ...PAIR, waitMinutes: 20 }, api, cache);
  expect(a.kind === 'ok' && a.flags).toEqual([]);
  expect(b.kind === 'ok' && b.flags.map((f) => f.label)).toEqual(['需打车']);
  // 上游仍只请求一次（缓存的是取数结果，不是判定结果）
  expect(calls).toEqual(['transit', 'driving']);
});

// ── 乘车段内的多条线路是「并列可选」，不是顺序乘坐 ────────
test('parseTransitRoutes：同一乘车段的多条线路只取第一条，换乘次数不误增', () => {
  const twoAlternatives = transitRoute({
    steps: [
      { mode: 'TRANSIT', lines: [
        { ...ride().lines![0]!, title: '1路' },
        { ...ride().lines![0]!, title: '2路' },
      ] },
      ride({ title: '地铁7号线' }),
    ],
  });
  const p = parseTransitRoutes({ routes: [twoAlternatives] })[0]!;
  // 两段乘车 → 换乘 1 次（不是 2 次）
  expect(p.transfers).toBe(1);
  // 只把实际可照着走的一条列进线路表
  expect(p.lines.map((l) => l.title)).toEqual(['1路', '地铁7号线']);
});
