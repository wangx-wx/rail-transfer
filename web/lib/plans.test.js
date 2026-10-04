/**
 * 方案处理单测（T21）
 * 运行：node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { annotatePlan, annotatePlans, mergePlans, sortPlans, processPlans } from './plans.js';

/** 造一个最小方案 */
const mk = (over = {}) => ({
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
  ...over,
});

// ── annotatePlan（D12/D13/D14/D17）───────────────────────
test('annotatePlan：同站等待低于 15 分 → belowMin', () => {
  assert.equal(annotatePlan(mk({ waitMinutes: 10, sameStation: true })).flags.belowMin, true);
});

test('annotatePlan：同城异站下限是 60 分', () => {
  assert.equal(annotatePlan(mk({ waitMinutes: 30, sameStation: false })).flags.belowMin, true);
  assert.equal(annotatePlan(mk({ waitMinutes: 70, sameStation: false })).flags.belowMin, false);
});

test('annotatePlan：等待 15~19 分 → risky（不 belowMin）', () => {
  const f = annotatePlan(mk({ waitMinutes: 17, sameStation: true })).flags;
  assert.equal(f.belowMin, false);
  assert.equal(f.risky, true);
});

test('annotatePlan：超过 120 分 → longWait', () => {
  assert.equal(annotatePlan(mk({ waitMinutes: 316 })).flags.longWait, true);
  assert.equal(annotatePlan(mk({ waitMinutes: 120 })).flags.longWait, false);
});

test('annotatePlan：同车接续透传标记', () => {
  assert.equal(annotatePlan(mk({ sameTrain: true })).flags.sameTrain, true);
});

test('annotatePlans：不删除任何方案（D12）', () => {
  const plans = [mk({ waitMinutes: 5 }), mk({ waitMinutes: 500 }), mk()];
  assert.equal(annotatePlans(plans).length, 3);
});

// ── mergePlans（D16）─────────────────────────────────────
test('mergePlans：同一车次组合合并为一行，换乘站收进数组', () => {
  const merged = mergePlans(
    annotatePlans([
      mk({ firstTrainNo: 'A', secondTrainNo: 'B', middleStation: '南京南', totalMinutes: 400 }),
      mk({ firstTrainNo: 'A', secondTrainNo: 'B', middleStation: '杭州东', totalMinutes: 380 }),
      mk({ firstTrainNo: 'C', secondTrainNo: 'D', middleStation: '武汉', totalMinutes: 420 }),
    ]),
  );
  assert.equal(merged.length, 2);
  const ab = merged.find((g) => g.firstTrainNo === 'A');
  assert.equal(ab.count, 2);
  assert.deepEqual(ab.middleStations.map((m) => m.name), ['南京南', '杭州东']);
  assert.equal(ab.best.totalMinutes, 380); // 代表项取最快
});

test('mergePlans：重复换乘站不重复计入', () => {
  const merged = mergePlans(
    annotatePlans([
      mk({ firstTrainNo: 'A', secondTrainNo: 'B', middleStation: '南京南' }),
      mk({ firstTrainNo: 'A', secondTrainNo: 'B', middleStation: '南京南' }),
    ]),
  );
  assert.equal(merged[0].count, 2);
  assert.equal(merged[0].middleStations.length, 1);
});

// ── sortPlans（D17）──────────────────────────────────────
test('sortPlans：默认按总耗时升序', () => {
  const g = processPlans([mk({ totalMinutes: 500, firstTrainNo: 'X' }), mk({ totalMinutes: 300, firstTrainNo: 'Y' })]);
  assert.deepEqual(g.map((x) => x.firstTrainNo), ['Y', 'X']);
});

test('sortPlans：可按换乘等待排序', () => {
  const g = sortPlans(
    mergePlans(annotatePlans([mk({ waitMinutes: 90, firstTrainNo: 'X' }), mk({ waitMinutes: 20, firstTrainNo: 'Y' })])),
    'wait',
  );
  assert.deepEqual(g.map((x) => x.firstTrainNo), ['Y', 'X']);
});

test('sortPlans：未知排序键回退到总耗时', () => {
  const g = sortPlans(mergePlans(annotatePlans([mk({ totalMinutes: 9, firstTrainNo: 'X' })])), 'nope');
  assert.equal(g.length, 1);
});
