/**
 * Worker 入口单测（路由 / CORS / 口令 / 缓存）
 * 运行：node --test
 *
 * 真 workerd 运行时测试（T20）留待部署验证阶段；此处用注入依赖覆盖分支逻辑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from './index.js';

/** 假缓存：记录 put，可预置命中 */
function fakeCache(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async match(req) {
      return store.get(req.url) ?? null;
    },
    async put(req, res) {
      store.set(req.url, res);
    },
  };
}

/** mock fetch：任何请求返回合法 JSON，并记录调用 */
function okFetch(body = '{"data":{"middleList":[]}}') {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, text: async () => body, headers: { get: () => null, getSetCookie: () => [] } };
  };
  fn.calls = calls;
  return fn;
}

const req = (path, opts = {}) => new Request(`https://proxy.example${path}`, opts);

// ── 路由 ─────────────────────────────────────────────────
test('未知端点 → 404', async () => {
  const res = await handleRequest(req('/api/nope'), {}, {});
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /未知端点/);
});

test('OPTIONS → 204 且带 CORS 头', async () => {
  const res = await handleRequest(req('/api/transfer', { method: 'OPTIONS' }), {}, {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /X-Access-Token/);
});

test('非 GET → 405', async () => {
  const res = await handleRequest(req('/api/transfer', { method: 'POST' }), {}, {});
  assert.equal(res.status, 405);
});

// ── 口令（T15/T16）───────────────────────────────────────
test('未配置 ACCESS_TOKEN → 不校验（本地开发）', async () => {
  const res = await handleRequest(req('/api/transfer?from=A&to=B&date=2026-10-07&hubs=NKH'), {}, { fetchImpl: okFetch() });
  assert.notEqual(res.status, 401);
});

test('配置了 ACCESS_TOKEN 且口令错误 → 401', async () => {
  const res = await handleRequest(
    req('/api/transfer?from=A&to=B&date=2026-10-07&hubs=NKH', { headers: { 'X-Access-Token': 'bad' } }),
    { ACCESS_TOKEN: 'good' },
    { fetchImpl: okFetch() },
  );
  assert.equal(res.status, 401);
});

test('配置了 ACCESS_TOKEN 且口令正确 → 放行', async () => {
  const res = await handleRequest(
    req('/api/transfer?from=A&to=B&date=2026-10-07&hubs=NKH', { headers: { 'X-Access-Token': 'good' } }),
    { ACCESS_TOKEN: 'good' },
    { fetchImpl: okFetch() },
  );
  assert.equal(res.status, 200);
});

// ── /api/transfer 扇出 ───────────────────────────────────
test('/api/transfer：hubs 扇出为多项结果', async () => {
  const f = okFetch();
  const res = await handleRequest(
    req('/api/transfer?from=VNP&to=AOH&date=2026-10-07&hubs=NKH,UUH,OHH'),
    {},
    { fetchImpl: f, cache: fakeCache() },
  );
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 3);
  assert.deepEqual(body.items.map((x) => x.key), ['NKH', 'UUH', 'OHH']);
  assert.equal(f.calls.length, 3);
});

// ── 缓存（T9/T10）────────────────────────────────────────
test('缓存未命中 → 转发并写入，带显式 Cache-Control', async () => {
  const f = okFetch();
  const cache = fakeCache();
  await handleRequest(req('/api/transfer?from=VNP&to=AOH&date=2026-10-07&hubs=NKH'), {}, { fetchImpl: f, cache });
  assert.equal(f.calls.length, 1);
  const stored = [...cache.store.values()][0];
  assert.match(stored.headers.get('Cache-Control'), /max-age=300/);
});

test('缓存命中 → 不再转发', async () => {
  const url = 'https://proxy.example/api/transfer?from=VNP&to=AOH&date=2026-10-07&hubs=NKH';
  const cached = new Response(JSON.stringify({ ok: true, items: [] }), {
    headers: { 'content-type': 'application/json' },
  });
  const f = okFetch();
  const res = await handleRequest(req('/api/transfer?from=VNP&to=AOH&date=2026-10-07&hubs=NKH'), {}, {
    fetchImpl: f,
    cache: fakeCache({ [url]: cached }),
  });
  assert.equal(f.calls.length, 0);
  assert.equal((await res.json()).ok, true);
});

test('失败响应不写缓存', async () => {
  const f = async () => ({ status: 302, text: async () => '', headers: { get: (k) => (k === 'location' ? 'x/error.html' : null), getSetCookie: () => [] } });
  f.calls = [];
  const cache = fakeCache();
  await handleRequest(req('/api/left-ticket?from=VNP&to=AOH&date=2026-10-07'), {}, { fetchImpl: f, cache });
  assert.equal(cache.store.size, 0);
});
