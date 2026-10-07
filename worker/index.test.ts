/**
 * Worker 入口单测（路由 / CORS / 口令 / 缓存）
 * 运行：npm test
 *
 * 跑在真实 workerd 运行时（T20）。此处用注入依赖覆盖分支逻辑；
 * 上游 fetch 全部 mock，不访问真实 12306。
 */

import { test, expect } from 'vitest';

import { handleRequest } from './index.ts';
import type { HandlerDeps } from './index.ts';
import type { FetchLike } from './source.ts';

/** 最小可用 fetch mock 的返回形态 */
interface MockRes {
  status: number;
  text(): Promise<string>;
  headers: { get(k: string): string | null; getSetCookie(): string[] };
}

/** 造一个假 Response（只含 source.ts 用到的字段） */
function fakeRes({ status = 200, body = '', location = '' }: { status?: number; body?: string; location?: string } = {}): MockRes {
  return {
    status,
    text: async () => body,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'location' ? location || null : null),
      getSetCookie: () => [],
    },
  };
}

/** mock fetch：返回合法 JSON，并记录调用 */
interface MockFetch extends FetchLike {
  calls: Array<{ url: string }>;
}

function okFetch(body = '{"data":{"middleList":[]}}'): MockFetch {
  const calls: Array<{ url: string }> = [];
  const fn = (async (input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    return fakeRes({ body }) as unknown as Response;
  }) as MockFetch;
  fn.calls = calls;
  return fn;
}

/** 假缓存：记录 put，可预置命中 */
function fakeCache(seed: Record<string, Response> = {}): Cache & { store: Map<string, Response> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async match(req: Request) {
      return store.get(req.url) ?? null;
    },
    async put(req: Request, res: Response) {
      // ⚠️ 真 cache.put 会**消费**响应 body 流。若这里只是存引用，
      // 就测不出「返回的响应与缓存响应共享 body 流」这类 bug（见下方回归测试）。
      // 故此处读空 body 再存，忠实模拟真实行为。
      await res.arrayBuffer();
      store.set(req.url, res);
    },
  } as unknown as Cache & { store: Map<string, Response> };
}

const req = (path: string, opts: RequestInit = {}): Request => new Request(`https://proxy.example${path}`, opts);

// ── 路由 ─────────────────────────────────────────────────
test('未知端点 → 404', async () => {
  const res = await handleRequest(req('/api/nope'));
  expect(res.status).toBe(404);
  expect((await res.json()).error).toMatch(/未知端点/);
});

test('OPTIONS → 204 且带 CORS 头', async () => {
  const res = await handleRequest(req('/api/transfer', { method: 'OPTIONS' }));
  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/X-Access-Token/);
});

test('非 GET → 405', async () => {
  const res = await handleRequest(req('/api/transfer', { method: 'POST' }));
  expect(res.status).toBe(405);
});

// ── 口令（T15/T16）───────────────────────────────────────
test('未配置 ACCESS_TOKEN → 不校验（本地开发）', async () => {
  const res = await handleRequest(req('/api/transfer?from=A&to=B&date=2026-10-07&hubs=NKH'), {}, {
    fetchImpl: okFetch(),
  });
  expect(res.status).not.toBe(401);
});

test('配置了 ACCESS_TOKEN 且口令错误 → 401', async () => {
  const res = await handleRequest(
    req('/api/transfer?from=A&to=B&date=2026-10-07&hubs=NKH', { headers: { 'X-Access-Token': 'bad' } }),
    { ACCESS_TOKEN: 'good' },
    { fetchImpl: okFetch() },
  );
  expect(res.status).toBe(401);
});

test('配置了 ACCESS_TOKEN 且口令正确 → 放行', async () => {
  const res = await handleRequest(
    req('/api/transfer?from=A&to=B&date=2026-10-07&hubs=NKH', { headers: { 'X-Access-Token': 'good' } }),
    { ACCESS_TOKEN: 'good' },
    { fetchImpl: okFetch() },
  );
  expect(res.status).toBe(200);
});

// ── /api/transfer 扇出 ───────────────────────────────────
test.each(['', '&hubs='])('/api/transfer：未指定枢纽 %s 时查询一次官方基线', async (hubs) => {
  const f = okFetch();
  const res = await handleRequest(
    req(`/api/transfer?from=VNP&to=AOH&date=2026-10-07${hubs}`),
    {},
    { fetchImpl: f, cache: fakeCache() },
  );
  const body = await res.json() as { items: Array<{ key: string; ok: boolean }> };
  expect(f.calls).toHaveLength(1);
  expect(new URL(f.calls[0]!.url).searchParams.get('middle_station')).toBe('');
  expect(body.items).toEqual([expect.objectContaining({ key: '', ok: true })]);
});

test('/api/transfer：hubs 扇出为多项结果', async () => {
  const f = okFetch();
  const res = await handleRequest(
    req('/api/transfer?from=VNP&to=AOH&date=2026-10-07&hubs=NKH,UUH,OHH'),
    {},
    { fetchImpl: f, cache: fakeCache() } satisfies HandlerDeps,
  );
  const body = (await res.json()) as { ok: boolean; items: Array<{ key: string }> };
  expect(body.ok).toBe(true);
  expect(body.items).toHaveLength(3);
  expect(body.items.map((x) => x.key)).toEqual(['NKH', 'UUH', 'OHH']);
  expect(f.calls).toHaveLength(3);
});

// ── 缓存（T9/T10）────────────────────────────────────────
test('缓存未命中 → 转发并写入，带显式 Cache-Control', async () => {
  const f = okFetch();
  const cache = fakeCache();
  await handleRequest(req('/api/transfer?from=VNP&to=AOH&date=2026-10-07&hubs=NKH'), {}, { fetchImpl: f, cache });
  expect(f.calls).toHaveLength(1);
  const stored = [...cache.store.values()][0]!;
  expect(stored.headers.get('Cache-Control')).toMatch(/max-age=300/);
});

// 回归：写缓存曾让返回响应与缓存响应共享 body 流，读空后返回时抛
// `TypeError: Body has already been used`（只在注入 cache 的环境复现，线上 1101）。
test('缓存写入后，返回的响应仍可读取 body', async () => {
  const cache = fakeCache();
  const res = await handleRequest(
    req('/api/transfer?from=VNP&to=AOH&date=2026-10-07&hubs=NKH'),
    {},
    { fetchImpl: okFetch(), cache },
  );
  expect(res.status).toBe(200);
  // 关键：cache.put 之后仍能读出 body，且内容完整
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
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
  expect(f.calls).toHaveLength(0);
  expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
});

test('失败响应不写缓存', async () => {
  const f = (async () => fakeRes({ status: 302, location: 'x/error.html' }) as unknown as Response) as unknown as MockFetch;
  f.calls = [];
  const cache = fakeCache();
  await handleRequest(req('/api/left-ticket?from=VNP&to=AOH&date=2026-10-07'), {}, { fetchImpl: f, cache });
  expect(cache.store.size).toBe(0);
});
