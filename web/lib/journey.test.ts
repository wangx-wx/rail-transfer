/**
 * 自研中转：行程装配（时间扩展图 + 分层扩展）单测
 *
 * 纯函数 + 注入式 API（不访问真实 12306）。
 * 骨架见技术方案 T37；数据源 leftTicket（T38）。
 */

import { test, expect } from 'vitest';

import { planJourneys, timeToMinutes } from './journey.ts';
import type { JourneyApi } from './journey.ts';
import type { Train } from '../../shared/types.ts';

/** 造一趟直达车（默认同站、无跨天） */
function train(over: Partial<Train> = {}): Train {
  return {
    trainNo: 'X',
    trainCode: 'X',
    fromStation: 'O',
    toStation: 'D',
    startStation: 'O',
    endStation: 'D',
    startTime: '08:00',
    arriveTime: '09:00',
    duration: '01:00',
    trainDate: '20261008',
    fromStationNo: '01',
    toStationNo: '02',
    secretStr: '',
    seats: [],
    seatTypes: '',
    ...over,
  };
}

/** O→H 的一程（08:00 发，09:00 到） */
const legOH = train({ trainNo: '1', trainCode: 'G1', fromStation: 'O', toStation: 'H', startTime: '08:00', arriveTime: '09:00', duration: '01:00' });
/** H→D 的一程（09:30 发，11:00 到） */
const legHD = train({ trainNo: '2', trainCode: 'G2', fromStation: 'H', toStation: 'D', startTime: '09:30', arriveTime: '11:00', duration: '01:30' });

/** 可编程 API：'O>H' → 车次列表 */
function fakeApi(routes: Record<string, Train[]>): JourneyApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async directTrains(from, to) {
      calls.push(`${from}>${to}`);
      return routes[`${from}>${to}`] ?? [];
    },
  };
}

const DATE = '2026-10-08';

// ── timeToMinutes ───────────────────────────────────────
test('timeToMinutes：HH:MM → 分钟，非法输入返回 null', () => {
  expect(timeToMinutes('08:30')).toBe(510);
  expect(timeToMinutes('00:00')).toBe(0);
  expect(timeToMinutes('23:59')).toBe(1439);
  expect(timeToMinutes('----')).toBeNull();
  expect(timeToMinutes('')).toBeNull();
});

// ── 一次换乘 ────────────────────────────────────────────
test('一次换乘：中转站接得上 → 1 条行程，等待 30 分', async () => {
  const api = fakeApi({ 'O>H': [legOH], 'H>D': [legHD] });
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1 }, api);

  expect(js).toHaveLength(1);
  expect(js[0]!.legs.map((l) => l.trainCode)).toEqual(['G1', 'G2']);
  expect(js[0]!.transfers[0]!.waitMinutes).toBe(30);
  expect(js[0]!.transfers[0]!.sameStation).toBe(true);
});

test('一次换乘：换乘等待低于同站下限（15 分）→ 不产出', async () => {
  const tight = train({ trainNo: '2', trainCode: 'G2', fromStation: 'H', toStation: 'D', startTime: '09:10', arriveTime: '11:00', duration: '01:50' });
  const api = fakeApi({ 'O>H': [legOH], 'H>D': [tight] });
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1 }, api);
  expect(js).toHaveLength(0);
});

test('一次换乘：首程到达晚于次程发车 → 不产出', async () => {
  const early = train({ trainNo: '2', trainCode: 'G2', fromStation: 'H', toStation: 'D', startTime: '08:30', arriveTime: '10:00', duration: '01:30' });
  const api = fakeApi({ 'O>H': [legOH], 'H>D': [early] });
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1 }, api);
  expect(js).toHaveLength(0);
});

test('一次换乘：同城异站（不同站码）用 60 分下限', async () => {
  // 第一程 09:00 到 H；第二程 09:30 从同城的 H2 发车（30 分 < 60 分）
  const crossD = train({ trainNo: '2', trainCode: 'G2', fromStation: 'H2', toStation: 'D', startTime: '09:30', arriveTime: '11:00', duration: '01:30' });
  const api = fakeApi({ 'O>H': [legOH], 'H>D': [crossD] });
  const cityOf = (c: string): string => (c === 'H' || c === 'H2' ? 'H' : c);
  const js = await planJourneys(
    { from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1, cityOf },
    api,
  );
  expect(js).toHaveLength(0); // 30 分 < 60 分下限
});

test('一次换乘：同城异站等待 >= 60 分 → 产出', async () => {
  const crossD = train({ trainNo: '2', trainCode: 'G2', fromStation: 'H2', toStation: 'D', startTime: '10:10', arriveTime: '11:40', duration: '01:30' });
  const api = fakeApi({ 'O>H': [legOH], 'H>D': [crossD] });
  const cityOf = (c: string): string => (c === 'H' || c === 'H2' ? 'H' : c);
  const js = await planJourneys(
    { from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1, cityOf },
    api,
  );
  expect(js).toHaveLength(1);
  expect(js[0]!.transfers[0]!.sameStation).toBe(false);
});

test('一次换乘：多个枢纽、部分无车次 → 只产出可行组合', async () => {
  const api = fakeApi({
    'O>H': [legOH],
    'H>D': [legHD],
    'O>K': [train({ trainNo: '3', trainCode: 'G3', fromStation: 'O', toStation: 'K', startTime: '07:00', arriveTime: '08:00', duration: '01:00' })],
    'K>D': [],
  });
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H', 'K'], maxTransfers: 1 }, api);
  expect(js).toHaveLength(1);
  expect(js[0]!.legs[0]!.trainCode).toBe('G1');
});

// ── 二次换乘（D57）───────────────────────────────────────
const legHK = train({ trainNo: '3', trainCode: 'G3', fromStation: 'H', toStation: 'K', startTime: '10:00', arriveTime: '11:30', duration: '01:30' });
const legKD = train({ trainNo: '4', trainCode: 'G4', fromStation: 'K', toStation: 'D', startTime: '12:30', arriveTime: '14:00', duration: '01:30' });

test('二次换乘：maxTransfers=2 时产出三段行程', async () => {
  const api = fakeApi({
    'O>H': [legOH],
    'H>K': [legHK],
    'K>D': [legKD],
    'H>D': [], // 该枢纽无法一段到终点
  });
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H', 'K'], maxTransfers: 2 }, api);
  const three = js.find((j) => j.legs.map((l) => l.trainCode).join('+') === 'G1+G3+G4');
  expect(three).toBeDefined();
  expect(three!.transfers).toHaveLength(2);
  expect(three!.transfers.map((t) => t.station)).toEqual(['H', 'K']);
});

test('二次换乘：maxTransfers=1 时不产出三段行程', async () => {
  const api = fakeApi({ 'O>H': [legOH], 'H>K': [legHK], 'K>D': [legKD] });
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H', 'K'], maxTransfers: 1 }, api);
  expect(js.every((j) => j.legs.length === 2)).toBe(true);
});

test('二次换乘：同一条边只查一次（内存去重）', async () => {
  const api = fakeApi({ 'O>H': [legOH], 'H>K': [legHK], 'K>D': [legKD], 'O>K': [legHK] });
  await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H', 'K'], maxTransfers: 2 }, api);
  // 'H>K' 由两条路径触发，只应查 1 次；'H>D' 类同理
  expect(api.calls.filter((c) => c === 'H>K')).toHaveLength(1);
});

test('硬上限：edges 超预算即停止扩展（T41）', async () => {
  const api = fakeApi({ 'O>H': [legOH], 'H>K': [legHK], 'K>D': [legKD] });
  await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H', 'K'], maxTransfers: 2, maxEdges: 1 }, api);
  expect(api.calls.length).toBeLessThanOrEqual(1);
});

// ── 分层扩展（BFS）：二次换乘模式下仍产出一次换乘结果 ──────
test('分层 BFS：maxTransfers=2 时，一次换乘结果不被二次扩展挤掉', async () => {
  // 枢纽 H 可一段到终点；枢纽 K 需要两段。二者都能到终点。
  const api = fakeApi({
    'O>H': [legOH],
    'H>D': [legHD],
    'O>K': [train({ trainNo: '5', trainCode: 'G5', fromStation: 'O', toStation: 'K', startTime: '07:00', arriveTime: '08:00', duration: '01:00' })],
    'K>H': [train({ trainNo: '6', trainCode: 'G6', fromStation: 'K', toStation: 'H', startTime: '08:30', arriveTime: '09:30', duration: '01:00' })],
    'H>K': [],
  });
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['K', 'H'], maxTransfers: 2 }, api);
  const oneTransfer = js.filter((j) => j.legs.length === 2);
  expect(oneTransfer.map((j) => j.legs.map((l) => l.trainCode).join('+'))).toContain('G1+G2');
});

test('分层 BFS：预算紧张时优先完成浅层（一次换乘）行程', async () => {
  const legHK2 = train({ trainNo: '7', trainCode: 'G7', fromStation: 'H', toStation: 'K', startTime: '10:00', arriveTime: '11:00', duration: '01:00' });
  const legKD2 = train({ trainNo: '8', trainCode: 'G8', fromStation: 'K', toStation: 'D', startTime: '11:30', arriveTime: '13:00', duration: '01:30' });
  const api = fakeApi({ 'O>H': [legOH], 'H>D': [legHD], 'H>K': [legHK2], 'K>D': [legKD2] });
  // 预算 2：O>H（1）+ H>D（2）即可完成一次换乘；向深扩展被预算挡住
  const js = await planJourneys({ from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 2, maxEdges: 2 }, api);
  expect(js.map((j) => j.legs.map((l) => l.trainCode).join('+'))).toContain('G1+G2');
  expect(js.every((j) => j.legs.length === 2)).toBe(true);
});

// ── 束搜索剪枝（T49：控制每层规模）─────────────────────────
test('支配剪枝：只作用于中间层，首层不剪（晚到首程能接不同第二程）', async () => {
  const early = train({ trainNo: '1', trainCode: 'G1', fromStation: 'O', toStation: 'H', startTime: '08:00', arriveTime: '09:00', duration: '01:00' });
  const late = train({ trainNo: '9', trainCode: 'G9', fromStation: 'O', toStation: 'H', startTime: '10:00', arriveTime: '11:00', duration: '01:00' });
  const hd1 = train({ trainNo: '2', trainCode: 'G2', fromStation: 'H', toStation: 'D', startTime: '09:30', arriveTime: '10:30', duration: '01:00' });
  const hd2 = train({ trainNo: '3', trainCode: 'G3', fromStation: 'H', toStation: 'D', startTime: '11:30', arriveTime: '12:30', duration: '01:00' });
  const api = fakeApi({ 'O>H': [early, late], 'H>D': [hd1, hd2] });

  const js = await planJourneys(
    { from: 'O', to: 'D', date: DATE, hubs: ['H'], maxTransfers: 1, beamPerStation: 1 },
    api,
  );
  // 首层不剪：G1 与 G9 都在，各自能接上可行第二程
  expect(js.map((j) => j.legs.map((l) => l.trainCode).join('+')).sort())
    .toEqual(['G1+G2', 'G1+G3', 'G9+G3']);
});

test('支配剪枝：中间层同一到达站只保留最早到达（beamPerStation=1）', async () => {
  // 三段：O→H（两班，早/晚）→ K → D。第二轮扩展得到 H→K 的部分行程，
  // 同一到达站 K 的两条部分行程，早到者保留。
  const early = train({ trainNo: '1', trainCode: 'G1', fromStation: 'O', toStation: 'H', startTime: '08:00', arriveTime: '09:00', duration: '01:00' });
  const late = train({ trainNo: '9', trainCode: 'G9', fromStation: 'O', toStation: 'H', startTime: '09:05', arriveTime: '10:00', duration: '00:55' });
  const hk1 = train({ trainNo: '2', trainCode: 'G2', fromStation: 'H', toStation: 'K', startTime: '09:30', arriveTime: '10:30', duration: '01:00' });
  const hk2 = train({ trainNo: '3', trainCode: 'G3', fromStation: 'H', toStation: 'K', startTime: '10:30', arriveTime: '11:30', duration: '01:00' });
  const kd = train({ trainNo: '4', trainCode: 'G4', fromStation: 'K', toStation: 'D', startTime: '12:00', arriveTime: '14:00', duration: '02:00' });
  const api = fakeApi({ 'O>H': [early, late], 'H>K': [hk1, hk2], 'K>D': [kd] });

  const js = await planJourneys(
    { from: 'O', to: 'D', date: DATE, hubs: ['H', 'K'], maxTransfers: 2, beamPerStation: 1 },
    api,
  );
  // 到达 K 的两条部分行程只留最早（G1+G2 到 10:30），故只有 G1+G2+G4
  const viaK = js.filter((j) => j.legs.length === 3).map((j) => j.legs.map((l) => l.trainCode).join('+'));
  expect(viaK).toEqual(['G1+G2+G4']);
});

test('束搜索：每层部分行程总数受 beamSize 限制', async () => {
  const routes: Record<string, Train[]> = {};
  for (let i = 0; i < 6; i++) {
    routes[`O>H${i}`] = [train({ trainNo: `g${i}`, trainCode: `G${i}`, fromStation: 'O', toStation: `H${i}`, startTime: '08:00', arriveTime: '09:00', duration: '01:00' })];
    routes[`H${i}>D`] = [train({ trainNo: `d${i}`, trainCode: `D${i}`, fromStation: `H${i}`, toStation: 'D', startTime: '09:30', arriveTime: '11:00', duration: '01:30' })];
  }
  const hubs = Array.from({ length: 6 }, (_, i) => `H${i}`);
  const js = await planJourneys(
    { from: 'O', to: 'D', date: DATE, hubs, maxTransfers: 1, beamSize: 2 },
    fakeApi(routes),
  );
  expect(js).toHaveLength(2);
});
