/**
 * 解析层单测（T21：只测纯函数）
 * 运行：npm test
 */

import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseTrainRow,
  parseLeftTicket,
  parseTransfer,
  parseTransferItem,
  extractHubCodes,
  parsePrice,
} from './parse.ts';
import type {
  LeftTicketData,
  RawMiddleItem,
  TransferData,
  UpstreamEnvelope,
} from '../../shared/types.ts';

/** 读固化样本 */
function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)), 'utf8'),
  ) as T;
}

type LeftTicketFixture = UpstreamEnvelope<LeftTicketData> & { data: LeftTicketData & { result: string[] } };
type TransferFixture = UpstreamEnvelope<TransferData> & { data: TransferData & { middleList: RawMiddleItem[] } };

const leftFixture = () => fixture<LeftTicketFixture>('left-ticket-55.json');
const transferFixture = () => fixture<TransferFixture>('transfer-10.json');

test('parseTrainRow：解出车次基本字段与座位', () => {
  const row = leftFixture().data.result[0]!;
  const t = parseTrainRow(row);

  expect(t.trainCode).toBe('G531');
  expect(t.trainNo).toBe('240000G53108');
  expect(t.fromStation).toBe('VNP');
  expect(t.toStation).toBe('AOH');
  expect(t.startTime).toBe('06:08');
  expect(t.arriveTime).toBe('12:04');
  expect(t.fromStationNo).toBe('01');
  expect(t.toStationNo).toBe('13');

  const ze = t.seats.find((s) => s.code === 'ZE')!;
  expect(ze.name).toBe('二等座');
  expect(ze.raw).toBe('无');
  expect(ze.available).toBe(false);
});

test('parseTrainRow：数字余票 → count，无票 → available=false', () => {
  const t = parseLeftTicket(leftFixture()).trains.find((x) => x.trainCode === 'G547')!;
  const ze = t.seats.find((s) => s.code === 'ZE')!;
  expect(ze.available).toBe(true);
  expect(ze.count).toBe(1);
});

test('parseTrainRow：席别齐全且顺序稳定', () => {
  const t = parseTrainRow(leftFixture().data.result[0]!);
  expect(t.seats.map((s) => s.code)).toEqual(['WZ', 'YZ', 'YW', 'GR', 'TZ', 'SWZ', 'ZY', 'ZE']);
});

test('parseLeftTicket：55 趟车 + stationMap', () => {
  const { trains, stationMap } = parseLeftTicket(leftFixture());
  expect(trains).toHaveLength(55);
  expect(stationMap['VNP']).toBe('北京南');
  expect(stationMap['AOH']).toBe('上海虹桥');
});

test('parseLeftTicket：空 data 是正常结果，不抛错', () => {
  const { trains, stationMap } = parseLeftTicket({ status: true, data: undefined, errorMsg: '没有查询到' });
  expect(trains).toEqual([]);
  expect(stationMap).toEqual({});
});

test('parseTransferItem：字段与布尔标记', () => {
  const plan = parseTransferItem(transferFixture().data.middleList[0]!);
  expect(typeof plan.middleStation).toBe('string');
  expect(typeof plan.waitMinutes).toBe('number');
  expect(typeof plan.totalMinutes).toBe('number');
  expect(typeof plan.sameStation).toBe('boolean');
  expect(typeof plan.sameTrain).toBe('boolean');
});

test('parseTransferItem：显示车次取自 fullList.station_train_code（非内部编号）', () => {
  const item = transferFixture().data.middleList[0]!;
  const plan = parseTransferItem(item);
  // first_train_no 是内部编号，形如 76000G873541；显示车次应形如 G8735
  expect(item.first_train_no).toMatch(/^\d/);
  expect(plan.firstTrainCode).toMatch(/^[GDCKTZ]\d+$/);
  expect(plan.firstTrainCode).toBe(item.fullList![0]!.station_train_code);
});

test('parseTransferItem：same_station "0" → 同站，"1" → 异站', () => {
  const minimal = (over: Partial<RawMiddleItem>): RawMiddleItem => ({
    from_station_name: '',
    middle_station_name: '',
    end_station_name: '',
    first_train_no: '',
    second_train_no: '',
    start_time: '',
    arrive_time: '',
    wait_time_minutes: 0,
    all_lishi_minutes: 0,
    same_station: '0',
    same_train: 'N',
    ...over,
  });

  const same = parseTransferItem(minimal({ same_station: '0' }));
  expect(same.sameStation).toBe(true);
  expect(same.sameTrain).toBe(false);

  const cross = parseTransferItem(minimal({ same_station: '1' }));
  expect(cross.sameStation).toBe(false);
});

test('parseTransferItem：同城异站方案（站名带 -，same_station="1"）', () => {
  const raw = fixture<TransferFixture>('transfer-cross-station.json');
  const item = raw.data.middleList.find((x) => x.middle_station_name.includes('-'))!;
  const plan = parseTransferItem(item);
  expect(plan.sameStation).toBe(false);
  expect(plan.middleStation).toMatch(/-/);
});

test('parseTransferItem：same_train "Y" → 同车接续', () => {
  const item: RawMiddleItem = {
    from_station_name: '',
    middle_station_name: '',
    end_station_name: '',
    first_train_no: '',
    second_train_no: '',
    start_time: '',
    arrive_time: '',
    wait_time_minutes: 0,
    all_lishi_minutes: 0,
    same_station: '0',
    same_train: 'Y',
  };
  expect(parseTransferItem(item).sameTrain).toBe(true);
});

test('parseTransfer：10 条方案 + 候选枢纽', () => {
  const { plans, middleStationList } = parseTransfer(transferFixture());
  expect(plans).toHaveLength(10);
  expect(middleStationList.length).toBeGreaterThan(0);
});

test('parseTransfer：空 data → 空方案', () => {
  const raw = fixture<UpstreamEnvelope<TransferData>>('transfer-empty.json');
  const { plans, middleStationList } = parseTransfer(raw);
  expect(plans).toEqual([]);
  expect(middleStationList).toEqual([]);
});

test('extractHubCodes：从 "码#站名" 抽码并去重', () => {
  expect(extractHubCodes(['BME#白马北', 'CNW#成都南', 'BME#白马北'])).toEqual(['BME', 'CNW']);
  expect(extractHubCodes([])).toEqual([]);
  expect(extractHubCodes(undefined)).toEqual([]);
});

// ── parsePrice（按值取，键归一到界面席别码）──────────────
test('parsePrice：把各席别价格归一为界面席别码', () => {
  expect(parsePrice({ data: { O: '¥626.0', M: '¥1033.0', A9: '¥2315.0', WZ: '¥626.0', train_no: 'x' } })).toEqual({
    ZE: 626,
    ZY: 1033,
    SWZ: 2315,
    WZ: 626,
  });
});

test('parsePrice：忽略非价格值（train_no / 纯数字内部码 / 未知码）', () => {
  expect(parsePrice({ data: { '2': '6260', train_no: '240000G53108', XX: '¥99' } })).toEqual({});
});

test('parsePrice：保留一位小数', () => {
  expect(parsePrice({ data: { O: '¥177.5' } })).toEqual({ ZE: 177.5 });
});

test('parsePrice：空响应 / 无 data → 空对象', () => {
  expect(parsePrice(undefined)).toEqual({});
  expect(parsePrice({})).toEqual({});
  expect(parsePrice({ data: {} })).toEqual({});
});

test('parseTransferLeg：解析站序（票价接口需要）', () => {
  const raw = transferFixture();
  const item = raw.data!.middleList![0]!;
  const plan = parseTransferItem(item);
  const leg = plan.legs[0]!;
  expect(leg.fromStationNo).toBeDefined();
  expect(leg.toStationNo).toBeDefined();
});
