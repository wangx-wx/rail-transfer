/**
 * 解析层单测（T21：只测纯函数）
 * 运行：node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseTrainRow,
  parseLeftTicket,
  parseTransfer,
  parseTransferItem,
  extractHubCodes,
} from './parse.js';

const fixture = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)), 'utf8'));

test('parseTrainRow：解出车次基本字段与座位', () => {
  const raw = fixture('left-ticket-55.json');
  const row = raw.data.result[0];
  const t = parseTrainRow(row);

  assert.equal(t.trainCode, 'G531');
  assert.equal(t.trainNo, '240000G53108');
  assert.equal(t.fromStation, 'VNP');
  assert.equal(t.toStation, 'AOH');
  assert.equal(t.startTime, '06:08');
  assert.equal(t.arriveTime, '12:04');
  assert.equal(t.fromStationNo, '01');
  assert.equal(t.toStationNo, '13');

  const ze = t.seats.find((s) => s.code === 'ZE');
  assert.equal(ze.name, '二等座');
  assert.equal(ze.raw, '无');
  assert.equal(ze.available, false);
});

test('parseTrainRow：数字余票 → count，无票 → available=false', () => {
  const raw = fixture('left-ticket-55.json');
  const t = parseLeftTicket(raw).trains.find((x) => x.trainCode === 'G547');
  const ze = t.seats.find((s) => s.code === 'ZE');
  assert.equal(ze.available, true);
  assert.equal(ze.count, 1);
});

test('parseTrainRow：席别齐全且顺序稳定', () => {
  const raw = fixture('left-ticket-55.json');
  const t = parseTrainRow(raw.data.result[0]);
  assert.deepEqual(
    t.seats.map((s) => s.code),
    ['WZ', 'YZ', 'YW', 'GR', 'TZ', 'SWZ', 'ZY', 'ZE'],
  );
});

test('parseLeftTicket：55 趟车 + stationMap', () => {
  const raw = fixture('left-ticket-55.json');
  const { trains, stationMap } = parseLeftTicket(raw);
  assert.equal(trains.length, 55);
  assert.equal(stationMap.VNP, '北京南');
  assert.equal(stationMap.AOH, '上海虹桥');
});

test('parseLeftTicket：空 data 是正常结果，不抛错', () => {
  const { trains, stationMap } = parseLeftTicket({ status: true, data: '', errorMsg: '没有查询到' });
  assert.deepEqual(trains, []);
  assert.deepEqual(stationMap, {});
});

test('parseTransferItem：字段与布尔标记', () => {
  const raw = fixture('transfer-10.json');
  const plan = parseTransferItem(raw.data.middleList[0]);
  assert.equal(typeof plan.middleStation, 'string');
  assert.equal(typeof plan.waitMinutes, 'number');
  assert.equal(typeof plan.totalMinutes, 'number');
  assert.equal(typeof plan.sameStation, 'boolean');
  assert.equal(typeof plan.sameTrain, 'boolean');
});

test('parseTransfer：10 条方案 + 候选枢纽', () => {
  const raw = fixture('transfer-10.json');
  const { plans, middleStationList } = parseTransfer(raw);
  assert.equal(plans.length, 10);
  assert.ok(middleStationList.length > 0);
});

test('parseTransfer：空 data → 空方案', () => {
  const raw = fixture('transfer-empty.json');
  const { plans, middleStationList } = parseTransfer(raw);
  assert.deepEqual(plans, []);
  assert.deepEqual(middleStationList, []);
});

test('extractHubCodes：从 "码#站名" 抽码并去重', () => {
  assert.deepEqual(
    extractHubCodes(['BME#白马北', 'CNW#成都南', 'BME#白马北']),
    ['BME', 'CNW'],
  );
  assert.deepEqual(extractHubCodes([]), []);
  assert.deepEqual(extractHubCodes(undefined), []);
});
