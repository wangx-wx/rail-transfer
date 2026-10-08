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
