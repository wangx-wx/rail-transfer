/**
 * 渲染层单测（T21：只测纯函数）
 * 运行：node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esc, seatTag, renderTrains, renderTransfers } from './render.js';
import { annotatePlans, mergePlans } from './plans.js';

test('esc：转义 HTML 特殊字符', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

// ── seatTag ──────────────────────────────────────────────
test('seatTag：无票 / 数字 / 有 / 不适用', () => {
  assert.match(seatTag('二等座', '无'), /off/);
  assert.match(seatTag('二等座', '12'), /12 张/);
  assert.match(seatTag('二等座', '有'), /有/);
  assert.equal(seatTag('二等座', '--'), '');
  assert.equal(seatTag('二等座', ''), '');
});

test('seatTag：高亮席别加 hl 类', () => {
  assert.match(seatTag('二等座', '有', true), /hl/);
  assert.doesNotMatch(seatTag('二等座', '有', false), /hl/);
});

// ── renderTrains ─────────────────────────────────────────
const train = (over = {}) => ({
  trainCode: 'G1',
  startTime: '06:00',
  arriveTime: '12:00',
  duration: '06:00',
  fromStation: 'VNP',
  toStation: 'AOH',
  startStation: 'VNP',
  endStation: 'AOH',
  seats: [{ code: 'ZE', name: '二等座', raw: '有' }],
  ...over,
});

test('renderTrains：无车次提示', () => {
  assert.match(renderTrains([], {}), /没有直达车次/);
});

test('renderTrains：展示车次、上/下车站、时刻', () => {
  const html = renderTrains([train()], { VNP: '北京南', AOH: '上海虹桥' }, 'ZE');
  assert.match(html, /G1/);
  assert.match(html, /北京南/);
  assert.match(html, /上海虹桥/);
  assert.match(html, /06:00/);
});

test('renderTrains：始发/终到与上下车不同时，标注「始发/终到」', () => {
  const html = renderTrains(
    [train({ fromStation: 'VNP', toStation: 'AOH', startStation: 'BJP', endStation: 'HGH' })],
    { VNP: '北京南', AOH: '上海虹桥', BJP: '北京', HGH: '杭州东' },
    'ZE',
  );
  assert.match(html, /始发 北京/);
  assert.match(html, /终到 杭州东/);
});

test('renderTrains：始发/终到与上下车相同时，不标注', () => {
  const html = renderTrains([train()], { VNP: '北京南', AOH: '上海虹桥' }, 'ZE');
  assert.doesNotMatch(html, /始发/);
  assert.doesNotMatch(html, /终到/);
});

// ── renderTransfers ──────────────────────────────────────
const plan = (over = {}) => ({
  fromStation: '北京南',
  middleStation: '南京南',
  endStation: '上海虹桥',
  firstTrainCode: 'G1',
  secondTrainCode: 'G2',
  firstTrainNo: '1',
  secondTrainNo: '2',
  startTime: '06:00',
  arriveTime: '12:00',
  waitMinutes: 30,
  totalMinutes: 360,
  sameStation: true,
  sameTrain: false,
  score: 0,
  legs: [
    { trainCode: 'G1', startStation: '北京南', endStation: '南京南', fromStation: '北京南', toStation: '南京南', startTime: '06:00', arriveTime: '09:00', duration: '03:00', seats: { ZE: '有' } },
    { trainCode: 'G2', startStation: '南京南', endStation: '上海虹桥', fromStation: '南京南', toStation: '上海虹桥', startTime: '09:30', arriveTime: '12:00', duration: '02:30', seats: { ZE: '无' } },
  ],
  ...over,
});

test('renderTransfers：空提示', () => {
  assert.match(renderTransfers([]), /没有中转方案/);
});

test('renderTransfers：按换乘枢纽分组，展示起终点与总耗时', () => {
  const html = renderTransfers(mergePlans(annotatePlans([plan()])));
  assert.match(html, /南京南/);
  assert.match(html, /北京南 → 上海虹桥/);
  assert.match(html, /总耗时 360 分/);
});

test('renderTransfers：展示每一程的车次与上下车站', () => {
  const html = renderTransfers(mergePlans(annotatePlans([plan()])));
  assert.match(html, /G1/);
  assert.match(html, /G2/);
  assert.match(html, /06:00/);
  assert.match(html, /09:30/);
  assert.match(html, /换乘 <b>南京南<\/b>/);
});

test('renderTransfers：同站/同城异站标签', () => {
  const same = renderTransfers(mergePlans(annotatePlans([plan({ sameStation: true })])));
  assert.match(same, />同站</);
  const cross = renderTransfers(mergePlans(annotatePlans([plan({ sameStation: false })])));
  assert.match(cross, />同城异站</);
});

test('renderTransfers：低于下限 / 超长等待标记', () => {
  const bad = renderTransfers(mergePlans(annotatePlans([plan({ waitMinutes: 5, sameStation: true })])));
  assert.match(bad, /低于换乘下限/);
  const long = renderTransfers(mergePlans(annotatePlans([plan({ waitMinutes: 200 })])));
  assert.match(long, /超长等待/);
});
