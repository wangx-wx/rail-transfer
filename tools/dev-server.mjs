/**
 * 本地开发服务器（零依赖）
 *
 * 用法：node tools/dev-server.mjs [端口，默认 8765]
 *
 * 同时承担两件事：
 *   1. 静态托管 web/ 与 shared/（前端零构建，原生 ESM 直接加载）
 *   2. /api/* 直接调用 worker/index.ts 的 handleRequest（进程内）
 *
 * 因为取数层环境无关（全局 fetch + getSetCookie），本地无需 wrangler、
 * 无需安装任何依赖即可跑通完整链路（满足「不安装其他应用」的要求）。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

import { handleRequest } from '../worker/index.ts';

const PORT = Number(process.argv[2]) || 8765;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 把 URL 路径映射到磁盘文件 */
function resolveFile(pathname) {
  // 入口在仓库根；/web/* 与 /shared/* 都是根下的真实目录
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.slice(1);
  const full = normalize(join(ROOT, rel));
  // 防目录穿越
  if (!full.startsWith(ROOT)) return null;
  return full;
}

/** 把 Node 的请求转成 Web Request，交给 Worker */
async function handleApi(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = `http://localhost:${PORT}${req.url}`;
  const request = new Request(url, { method: req.method, headers: req.headers, body });
  const response = await handleRequest(request, { ACCESS_TOKEN: process.env.ACCESS_TOKEN }, {});
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await handleApi(req, res);

    const pathname = decodeURIComponent(new URL(req.url, `http://localhost`).pathname);
    const file = resolveFile(pathname);
    if (!file) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(`500 ${e}`);
  }
});

server.listen(PORT, () => {
  console.log(`rail-transfer 开发服务器： http://localhost:${PORT}`);
  console.log(`  静态：web/ 与 shared/（零构建）`);
  console.log(`  接口：/api/* → worker/index.ts（进程内调用）`);
});
