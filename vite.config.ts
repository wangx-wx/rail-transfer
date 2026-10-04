import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * 前端构建配置（T18）。
 *
 * base 必须是 Pages 仓库路径，否则产物里的资源引用会 404、页面白屏。
 * 仓库为 wangx-wx/rail-transfer → Pages 地址 https://wangx-wx.github.io/rail-transfer/
 */
export default defineConfig({
  base: '/rail-transfer/',

  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 入口在仓库根，产物进 dist/
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },

  server: {
    // 本地开发：/api 代理到 Worker（wrangler dev 或自建 dev-server）
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
