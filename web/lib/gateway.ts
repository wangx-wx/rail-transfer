/**
 * 请求网关（T41）——并发闸门 + 相邻请求最小间隔（节拍器）
 *
 * 12306 定位为个人低频查询（合规要求），且 Workers 同时出站连接有限。
 * 本模块把「并发 ≤N」与「相邻请求 ≥间隔」两条约束收敛到一个可注入时钟的实现里，
 * 便于单测（T21）。
 *
 * ⚠️ 两条约束**必须分别用两个机制**，不能合一：
 * - 并发闸门（`active` + 等待队列）限制**同时在跑**的请求数；
 * - 节拍器（`pacer`）保证**任意相邻两次发车**间隔 ≥ `intervalMs`，消除 0ms 突发。
 * 若只用一个 `lastStart` 变量，被唤醒的多个任务会一起读到同一时刻、同时发车
 * （突发），或在完成后才补一个（退化串行）。
 */

/** 网关配置 */
export interface GatewayOptions {
  /** 最大并发 */
  concurrency: number;
  /** 相邻两次请求的最小间隔（毫秒）；0 = 不限（仅并发闸门） */
  intervalMs: number;
  /** 睡眠实现（测试注入） */
  sleep?: (ms: number) => Promise<void>;
  /** 当前时刻（毫秒，测试注入） */
  now?: () => number;
}

/** 网关实例 */
export interface Gateway {
  /** 排队执行一个任务，返回其结果（错误向上抛） */
  run<T>(task: () => Promise<T>): Promise<T>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 创建一个请求网关 */
export function createGateway(opts: GatewayOptions): Gateway {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());
  const slots: Array<() => void> = [];
  let active = 0;
  /** 下一次可发车时刻（毫秒）；`-Infinity` = 尚未发过，立即可发 */
  let nextSlot = Number.NEGATIVE_INFINITY;
  /** 取号的临界区尾（promise 链）；仅在**纯计算**期间互斥，不含任何等待 */
  let ticketTail: Promise<unknown> = Promise.resolve();

  async function acquire(): Promise<void> {
    if (active < opts.concurrency) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => slots.push(resolve));
    // 唤醒即已由 release 计入 active，此处不再自增
  }

  /** 释放一个槽位，并**补满**空闲并发（否则并发上限形同虚设） */
  function release(): void {
    active--;
    while (active < opts.concurrency && slots.length > 0) {
      active++;
      slots.shift()!();
    }
  }

  /**
   * 取一个发车号：在临界区里**预约**发车时刻，返回还需等待的毫秒数。
   *
   * ⚠️ 关键：`sleep` 必须在临界区**之外**执行。若把等待放进临界区，任务会被逐个
   * 串行放行（并发上限失效）；此处只原子地预约时刻号，等待由调用方并行进行。
   * 号与号之间恰好间隔 `intervalMs` → 发车均匀、无 0ms 突发。
   * `intervalMs <= 0` 时恒返回 0（纯并发闸门）。
   */
  function takeTicket(): Promise<number> {
    const p = ticketTail.then(() => {
      if (opts.intervalMs <= 0) return 0;
      const at = Math.max(now(), nextSlot);
      nextSlot = at + opts.intervalMs;
      return at - now();
    });
    // 单号计算不得断链；错误不应传播（纯计算，不会错，防御性）
    ticketTail = p.then(
      () => {},
      () => {},
    );
    return p;
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        const wait = await takeTicket();
        if (wait > 0 && Number.isFinite(wait)) await sleep(wait);
        return await task();
      } finally {
        release();
      }
    },
  };
}
