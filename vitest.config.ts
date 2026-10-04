import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * 测试分两组（T20 + T21）：
 *
 *   1. worker —— 跑在**真实 workerd 运行时**（Miniflare）。能测到
 *      `getSetCookie()`、isolate 复用等 Workers 专有行为，mock 测不出这些。
 *   2. web —— 普通 Node 环境。前端代码是纯函数（解析/合并/排序/渲染），
 *      且测试要读 `test/fixtures/` 文件，workerd 无 node:fs。
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ main: './worker/index.ts' })],
        test: {
          name: 'worker',
          include: ['worker/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          include: ['web/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
