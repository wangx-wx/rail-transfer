/**
 * 运行时配置
 *
 * 用 Vite 的环境常量区分（无需手改）：
 *   - 开发（`npm run dev`）：空串 = 同源，走 Vite proxy → 本地 Worker。
 *   - 构建（`npm run build`）：指向线上 Worker（GitHub Pages 静态页没有 /api）。
 *
 * ⚠️ 只填地址，不要在此写口令（T16：口令由界面输入，随请求头发送）。
 */

const WORKER_URL = 'https://rail-transfer-proxy.wangx-coding.workers.dev';

export const API_BASE = import.meta.env.PROD ? WORKER_URL : '';
