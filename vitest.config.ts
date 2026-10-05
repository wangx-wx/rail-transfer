import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * 测试分三组（T20 + T21）：
 *
 *   1. worker  —— 跑在**真实 workerd 运行时**（Miniflare）。能测到
 *      `getSetCookie()`、isolate 复用等 Workers 专有行为，mock 测不出这些。
 *   2. web-node —— Node 环境，纯函数（解析/合并/排序/视图模型）。要读
 *      `test/fixtures/` 文件（workerd 无 node:fs），且用 `import.meta.url`
 *      定位 fixture，故不能用 jsdom（其 url 是 http，会让 fileURLToPath 失准）。
 *   3. web-dom —— jsdom 环境，React 组件渲染测试（`.test.tsx`）。
 *
 * 用文件扩展名区分 2 / 3：纯函数写 `.test.ts`，组件测试写 `.test.tsx`。
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
          name: 'web-node',
          include: ['web/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web-dom',
          include: ['web/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./web/test/setup.ts'],
          server: {
            // antd 无 exports 字段、rc-* 为多包 CJS/ESM 混合，
            // 内联后才走 Vite 转换，避免 interop 报错（antd 官方测试配置同款）
            deps: { inline: [/antd/, /@ant-design/, /@rc-component/, /rc-/] },
          },
        },
      },
    ],
  },
});
