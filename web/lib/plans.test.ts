/**
 * 方案处理单测（T21）
 * 运行：npm test
 */

import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { annotatePlan, annotatePlans, mergePlans, sortPlans, processPlans } from './plans.ts';
import { parseTransfer } from './parse.ts';
import type { TransferData, TransferPlan, UpstreamEnvelope } from '../../shared/types.ts';

/** 造一个最小方案 */
function mk(over: Partial<TransferPlan> = {}): TransferPlan {
  return {
    fromStation: '北京南',
    middleStation: '南京南',
    endStation: '上海虹桥',
    firstTrainNo: 'G1',
    secondTrainNo: 'G2',
    firstTrainCode: 'G1',
    secondTrainCode: 'G2',
    legs: [],
    startTime: '06:00',
    arriveTime: '12:00',
    waitMinutes: 30,
    totalMinutes: 360,
    sameStation: true,
    sameTrain: false,
    score: 0,
    ...over,
  };
}

// ── annotatePlan（D12/D13/D14/D17）───────────────────────
test('annotatePlan：同站等待低于 15 分 → belowMin', () => {
  expect(annotatePlan(mk({ waitMinutes: 10, sameStation: true })).flags.belowMin).toBe(true);
});

test('annotatePlan：同城异站下限是 60 分', () => {
  expect(annotatePlan(mk({ waitMinutes: 30, sameStation: false })).flags.belowMin).toBe(true);
  expect(annotatePlan(mk({ waitMinutes: 70, sameStation: false })).flags.belowMin).toBe(false);
});

test('annotatePlan：等待 15~19 分 → risky（不 belowMin）', () => {
  const f = annotatePlan(mk({ waitMinutes: 17, sameStation: true })).flags;
  expect(f.belowMin).toBe(false);
  expect(f.risky).toBe(true);
});

test('annotatePlan：超过 120 分 → longWait', () => {
  expect(annotatePlan(mk({ waitMinutes: 316 })).flags.longWait).toBe(true);
  expect(annotatePlan(mk({ waitMinutes: 120 })).flags.longWait).toBe(false);
});

test('annotatePlan：真实样本 G8735 同车接续停站 2 分钟不标换乘风险', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../../test/fixtures/transfer-10.json', import.meta.url), 'utf8'),
  ) as UpstreamEnvelope<TransferData>;
  const plan = parseTransfer(raw).plans.find((p) => p.firstTrainCode === 'G8735')!;
  expect(plan).toMatchObject({ sameTrain: true, sameStation: true, waitMinutes: 2 });
  expect(annotatePlan(plan).flags).toEqual({
    belowMin: false,
    risky: false,
    longWait: false,
    sameTrain: true,
  });
});

test('annotatePlan：同车接续停站 17 分钟不标换乘紧张', () => {
  const flags = annotatePlan(mk({ sameTrain: true, waitMinutes: 17 })).flags;
  expect(flags.belowMin).toBe(false);
  expect(flags.risky).toBe(false);
  expect(flags.sameTrain).toBe(true);
});

test('annotatePlan：同车接续仍保留超长等待标记', () => {
  const flags = annotatePlan(mk({ sameTrain: true, waitMinutes: 121 })).flags;
  expect(flags.longWait).toBe(true);
  expect(flags.sameTrain).toBe(true);
});

test('annotatePlans：不删除任何方案（D12）', () => {
  const plans = [mk({ waitMinutes: 5 }), mk({ waitMinutes: 500 }), mk()];
  expect(annotatePlans(plans)).toHaveLength(3);
});

// ── mergePlans（D16）─────────────────────────────────────
test('mergePlans：同一车次组合合并为一行，换乘站收进数组', () => {
  const merged = mergePlans(
    annotatePlans([
      mk({ firstTrainCode: 'A', secondTrainCode: 'B', middleStation: '南京南', totalMinutes: 400 }),
      mk({ firstTrainCode: 'A', secondTrainCode: 'B', middleStation: '杭州东', totalMinutes: 380 }),
      mk({ firstTrainCode: 'C', secondTrainCode: 'D', middleStation: '武汉', totalMinutes: 420 }),
    ]),
  );
  expect(merged).toHaveLength(2);
  const ab = merged.find((g) => g.firstTrainCode === 'A')!;
  expect(ab.count).toBe(2);
  expect(ab.middleStations.map((m) => m.name)).toEqual(['南京南', '杭州东']);
  expect(ab.best.totalMinutes).toBe(380); // 代表项取最快
});

test('mergePlans：重复换乘站不重复计入', () => {
  const merged = mergePlans(
    annotatePlans([
      mk({ firstTrainCode: 'A', secondTrainCode: 'B', middleStation: '南京南' }),
      mk({ firstTrainCode: 'A', secondTrainCode: 'B', middleStation: '南京南' }),
    ]),
  );
  expect(merged[0]!.count).toBe(2);
  expect(merged[0]!.middleStations).toHaveLength(1);
});

test('mergePlans：保留各换乘站的完整方案，重复响应不增加行程变体', () => {
  const nanjing = mk({ middleStation: '南京南', totalMinutes: 400 });
  const hangzhou = mk({ middleStation: '杭州东', totalMinutes: 380, waitMinutes: 10 });
  const annotated = annotatePlans([nanjing, hangzhou, structuredClone(nanjing)]);
  const [group] = mergePlans(annotated);
  expect(group!.count).toBe(3);
  expect(group!.plans).toEqual(annotated.slice(0, 2));
  expect(group!.best).toBe(annotated[1]);
});

// ── sortPlans（D17）──────────────────────────────────────
test('sortPlans：默认按总耗时升序', () => {
  const g = processPlans([
    mk({ totalMinutes: 500, firstTrainCode: 'X' }),
    mk({ totalMinutes: 300, firstTrainCode: 'Y' }),
  ]);
  expect(g.map((x) => x.firstTrainCode)).toEqual(['Y', 'X']);
});

test('sortPlans：可按换乘等待排序', () => {
  const g = sortPlans(
    mergePlans(
      annotatePlans([
        mk({ waitMinutes: 90, firstTrainCode: 'X' }),
        mk({ waitMinutes: 20, firstTrainCode: 'Y' }),
      ]),
    ),
    'wait',
  );
  expect(g.map((x) => x.firstTrainCode)).toEqual(['Y', 'X']);
});

test('sortPlans：未知排序键回退到总耗时', () => {
  const groups = mergePlans(annotatePlans([mk({ totalMinutes: 9, firstTrainCode: 'X' })]));
  // 运行时可能传入非法键（如来自 URL 参数），断言回退行为
  const g = sortPlans(groups, 'nope' as never);
  expect(g).toHaveLength(1);
});
