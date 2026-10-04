/**
 * 运行时配置
 *
 * API_BASE 为空 = 同源（本地开发用，由 tools/dev-server.mjs 提供 /api）。
 *
 * 部署到 GitHub Pages 后，静态页没有 /api，需把这里改成你的 Worker 地址，例如：
 *   export const API_BASE = 'https://rail-transfer-proxy.<你的子域>.workers.dev';
 *
 * ⚠️ 只填地址，不要在此写口令（T16：口令由界面输入，随请求头发送）。
 */

export const API_BASE = '';
