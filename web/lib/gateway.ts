/**
 * 请求网关（T41）——并发闸门 + 相邻请求最小间隔
 *
 * 12306 定位为个人低频查询（合规要求），且 Workers 同时出站连接有限。
 * 本模块把「并发 ≤N」与「相邻请求 ≥间隔」两条约束收敛到一个可注入时钟的实现里，
 * 便于单测（T21）。
 */

/** 网关配置 */
export interface GatewayOptions {
  /** 最大并发 */
  concurrency: number;
  /** 相邻两次请求的最小间隔（毫秒） */
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
  /** 上一次发车时刻（毫秒）；-Infinity 表示尚未发过 */
  let lastStart = Number.NEGATIVE_INFINITY;

  async function acquire(): Promise<void> {
    if (active < opts.concurrency) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => slots.push(resolve));
    active++;
  }

  function release(): void {
    active--;
    const next = slots.shift();
    if (next) next();
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        if (opts.intervalMs > 0) {
          const wait = lastStart + opts.intervalMs - now();
          if (wait > 0 && Number.isFinite(wait)) await sleep(wait);
        }
        lastStart = now();
        return await task();
      } finally {
        release();
      }
    },
  };
}
