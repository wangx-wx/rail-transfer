/**
 * 请求网关单测（T41：并发闸门 ≤3、相邻请求间隔 ≥300ms）
 *
 * 用注入的时钟，不真的等待。
 */

import { test, expect } from 'vitest';

import { createGateway } from './gateway.ts';

/** 可控时钟 */
function fakeClock(): { sleep: (ms: number) => Promise<void>; times: number[]; now: () => number } {
  const times: number[] = [];
  let t = 0;
  return {
    times,
    now: () => t,
    async sleep(ms: number) {
      times.push(ms);
      t += ms;
    },
  };
}

test('并发闸门：同时最多 3 个任务在跑', async () => {
  const clock = fakeClock();
  const gw = createGateway({ concurrency: 3, intervalMs: 0, sleep: clock.sleep, now: clock.now });
  let running = 0;
  let peak = 0;
  const task = () => async (): Promise<void> => {
    running++;
    peak = Math.max(peak, running);
    await Promise.resolve();
    running--;
  };
  await Promise.all(Array.from({ length: 10 }, () => gw.run(task())));
  expect(peak).toBeLessThanOrEqual(3);
});

test('相邻请求间隔：第二次请求前 sleep ≥300ms', async () => {
  const clock = fakeClock();
  const gw = createGateway({ concurrency: 1, intervalMs: 300, sleep: clock.sleep, now: clock.now });
  await gw.run(async () => {});
  await gw.run(async () => {});
  expect(clock.times).toEqual([300]);
});

test('首个请求不等待', async () => {
  const clock = fakeClock();
  const gw = createGateway({ concurrency: 2, intervalMs: 300, sleep: clock.sleep, now: clock.now });
  await gw.run(async () => {});
  expect(clock.times).toEqual([]);
});

test('任务抛错不阻塞后续，且错误向上抛', async () => {
  const clock = fakeClock();
  const gw = createGateway({ concurrency: 1, intervalMs: 0, sleep: clock.sleep, now: clock.now });
  await expect(gw.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  await expect(gw.run(async () => 1)).resolves.toBe(1);
});

test('run 返回任务结果', async () => {
  const clock = fakeClock();
  const gw = createGateway({ concurrency: 1, intervalMs: 0, sleep: clock.sleep, now: clock.now });
  await expect(gw.run(async () => 'ok')).resolves.toBe('ok');
});

/** 排空微任务 + 一个宏任务，确保在飞请求已就位 */
const drain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test('无 0ms 突发：相邻发车之间至少间隔 intervalMs', async () => {
  const clock = fakeClock();
  const gw = createGateway({ concurrency: 3, intervalMs: 100, sleep: clock.sleep, now: clock.now });
  const starts: number[] = [];
  await Promise.all(
    Array.from({ length: 9 }, () =>
      gw.run(async () => {
        starts.push(clock.now());
      }),
    ),
  );
  starts.sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) {
    expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(100);
  }
});

test('并发真正生效：3 个请求可同时在飞（不退化为串行）', async () => {
  const gw = createGateway({ concurrency: 3, intervalMs: 0 });
  let running = 0;
  let peak = 0;
  const gates: Array<() => void> = [];
  const task = () => async (): Promise<void> => {
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>((r) => gates.push(r)); // 模拟在飞请求，挂起直到手动放行
    running--;
  };
  const all = Promise.all(Array.from({ length: 6 }, () => gw.run(task())));

  await drain();
  expect(peak).toBe(3); // 恰好 3 个在飞
  expect(running).toBe(3);

  for (const g of gates.splice(0)) g(); // 放行第一批
  await drain();
  expect(peak).toBe(3); // 后续进来也不超过 3

  for (const g of gates.splice(0)) g();
  await drain();
  for (const g of gates.splice(0)) g();
  await all;
  expect(running).toBe(0);
});

test('intervalMs=0：不 sleep（纯并发闸门）', async () => {
  const clock = fakeClock();
  const gw = createGateway({ concurrency: 3, intervalMs: 0, sleep: clock.sleep, now: clock.now });
  await Promise.all(Array.from({ length: 6 }, () => gw.run(async () => {})));
  expect(clock.times).toEqual([]);
});
