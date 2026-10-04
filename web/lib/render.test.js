/**
 * 渲染层单测（T21：只测纯函数）
 * 运行：node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esc, toMinutes, filterByPeriod, renderTrains, renderTransfers } from './render.js';
import { annotatePlans, mergePlans } from './plans.js';

test('esc：转义 HTML 特殊字符', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('toMinutes：解析 HH:MM', () => {
  assert.equal(toMinutes('06:08'), 368);
  assert.equal(toMinutes('23:59'), 1439);
  assert.equal(toMinutes('bad'), -1);
});

test('filterByPeriod：按时段过滤', () => {
  const trains = [{ startTime: '05:00' }, { startTime: '09:00' }, { startTime: '20:00' }];
  assert.deepEqual(filterByPeriod(trains, 'morning').map((t) => t.startTime), ['09:00']);
  assert.deepEqual(filterByPeriod(trains, 'evening').map((t) => t.startTime), ['20:00']);
  assert.equal(filterByPeriod(trains, '').length, 3);
});

test('renderTrains：无车次提示', () => {
  assert.match(renderTrains([], {}), /没有直达车次/);
});

test('renderTrains：展示席别有票/无票', () => {
  const html = renderTrains(
    [
      {
        trainCode: 'G1',
        startTime: '06:00',
        arriveTime: '12:00',
        duration: '06:00',
        fromStation: 'VNP',
        toStation: 'AOH',
        seats: [{ code: 'ZE', name: '二等座', available: true, count: 5 }],
      },
    ],
    { VNP: '北京南', AOH: '上海虹桥' },
    'ZE',
  );
  assert.match(html, /G1/);
  assert.match(html, /北京南/);
  assert.match(html, /二等座 5 张/);
});

test('renderTransfers：按换乘枢纽分组', () => {
  const groups = mergePlans(
    annotatePlans([
      {
        fromStation: '北京南',
        middleStation: '南京南',
        endStation: '上海虹桥',
        firstTrainNo: 'G1',
        secondTrainNo: 'G2',
        startTime: '06:00',
        arriveTime: '12:00',
        waitMinutes: 30,
        totalMinutes: 360,
        sameStation: true,
        sameTrain: false,
        score: 0,
      },
    ]),
  );
  const html = renderTransfers(groups);
  assert.match(html, /南京南/);
  assert.match(html, /G1 → G2/);
});

test('renderTransfers：空提示', () => {
  assert.match(renderTransfers([]), /没有中转方案/);
});
