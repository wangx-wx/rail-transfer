/**
 * 取数层单测（mock fetch 测纯逻辑，不联网）
 *
 * 跑在真实 workerd 运行时（T20）。上游 fetch 全部 mock，不访问真实 12306。
 *
 * 运行：npm test
 */

import { test, expect } from 'vitest';

import {
  extractCookies,
  classify,
  initCookie,
  fetchLeftTicket,
  fetchTransfer,
  fetchTransferBatch,
} from './source.ts';
import type { FetchLike } from './source.ts';

/** 假 Response 的形态（只含 source.ts 用到的字段） */
interface MockRes {
  status: number;
  text(): Promise<string>;
  headers: { get(k: string): string | null; getSetCookie(): string[] };
}

/** 构造一个假 Response */
function fakeRes(
  { status = 200, body = '', location = '', cookies = [] }: { status?: number; body?: string; location?: string; cookies?: string[] } = {},
): MockRes {
  return {
    status,
    text: async () => body,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'location' ? location || null : null),
      getSetCookie: () => cookies,
    },
  };
}

/** 记录调用的 fetch mock */
interface MockFetch extends FetchLike {
  calls: Array<{ url: string; opts: RequestInit }>;
}

function mockFetch(handler: (url: string, opts: RequestInit) => MockRes | { error: string } | Promise<MockRes | { error: string }>): MockFetch {
  const calls: Array<{ url: string; opts: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, opts?: RequestInit) => {
    const url = String(input);
    calls.push({ url, opts: opts ?? {} });
    return (await handler(url, opts ?? {})) as unknown as Response;
  }) as MockFetch;
  fn.calls = calls;
  return fn;
}

// ── extractCookies ───────────────────────────────────────
test('extractCookies：优先 getSetCookie', () => {
  const r = fakeRes({ cookies: ['a=1; Path=/', 'b=2; Path=/'] }) as unknown as Response;
  expect(extractCookies(r)).toEqual(['a=1; Path=/', 'b=2; Path=/']);
});

test('extractCookies：回退合并 set-cookie 头', () => {
  const r = {
    headers: { get: (k: string) => (k === 'set-cookie' ? 'a=1; Path=/' : null) },
  } as unknown as Response;
  expect(extractCookies(r)).toEqual(['a=1; Path=/']);
});

// ── classify（T14：真错误 vs 正常空结果）──────────────────
test('classify：200 + JSON → ok', () => {
  expect(classify(fakeRes({ status: 200 }) as unknown as Response, '{"data":""}').ok).toBe(true);
});

test('classify：空 data 不算错误', () => {
  const c = classify(
    fakeRes({ status: 200 }) as unknown as Response,
    '{"status":true,"data":"","errorMsg":"没有查询到中转方案"}',
  );
  expect(c.ok).toBe(true);
});

test('classify：302 → error.html 是真错误', () => {
  const c = classify(fakeRes({ status: 302, location: 'https://kyfw.12306.cn/otn/error.html' }) as unknown as Response, '');
  expect(c.ok).toBe(false);
  expect(c.error).toMatch(/error\.html/);
});

test('classify：网络失败 → retriable', () => {
  const c = classify({ error: 'fetch failed' }, '');
  expect(c.ok).toBe(false);
  expect(c.retriable).toBe(true);
});

test('classify：HTTP 500 → retriable，404 → 不可重试', () => {
  expect(classify(fakeRes({ status: 500 }) as unknown as Response, '').retriable).toBe(true);
  expect(classify(fakeRes({ status: 404 }) as unknown as Response, '').retriable).toBe(false);
});

test('classify：非 JSON → 真错误', () => {
  expect(classify(fakeRes({ status: 200 }) as unknown as Response, '<html>').ok).toBe(false);
});

// ── initCookie（T8）──────────────────────────────────────
test('initCookie：拼出 Cookie 头', async () => {
  const f = mockFetch(() =>
    fakeRes({ body: '{"ok":true}', cookies: ['JSESSIONID=abc; Path=/', 'RAIL_EXPIRATION=1; Path=/'] }),
  );
  const cookie = await initCookie({ fetchImpl: f });
  expect(cookie).toBe('JSESSIONID=abc; RAIL_EXPIRATION=1');
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.url).toMatch(/\/otn\/leftTicket\/init$/);
});

test('initCookie：init 返回 HTML（非 JSON）仍能取到 cookie', async () => {
  // 实测：init 的 content-type 是 text/html，不是 JSON。
  // 早期实现用 classify 判「非 JSON」为错误 → cookie 丢失 → 后续被 WAF 拦。
  const f = mockFetch(() => fakeRes({ body: '<!DOCTYPE html><html>...</html>', cookies: ['JSESSIONID=xyz; Path=/'] }));
  expect(await initCookie({ fetchImpl: f })).toBe('JSESSIONID=xyz');
});

test('initCookie：init 被拦（302 → error.html）→ 空 cookie', async () => {
  const f = mockFetch(() => fakeRes({ status: 302, location: 'https://kyfw.12306.cn/otn/error.html' }));
  expect(await initCookie({ fetchImpl: f })).toBe('');
});

test('initCookie：init 网络失败 → 空 cookie', async () => {
  const f = mockFetch(() => ({ error: 'boom' }));
  expect(await initCookie({ fetchImpl: f })).toBe('');
});

// ── fetchLeftTicket ──────────────────────────────────────
test('fetchLeftTicket：先 init 再 query，且带 Cookie', async () => {
  const f = mockFetch((url) =>
    url.includes('/init')
      ? fakeRes({ body: '{"ok":true}', cookies: ['JSESSIONID=xyz; Path=/'] })
      : fakeRes({ body: '{"data":{"result":[]}}' }),
  );
  const out = await fetchLeftTicket({ from: 'VNP', to: 'AOH', date: '2026-10-07', fetchImpl: f });
  expect(out.ok).toBe(true);
  expect(f.calls).toHaveLength(2);
  expect(f.calls[0]!.url).toMatch(/\/init$/);
  expect(f.calls[1]!.url).toMatch(/queryG\?leftTicketDTO\.train_date=2026-10-07/);
  expect((f.calls[1]!.opts.headers as Record<string, string>)['Cookie']).toMatch(/JSESSIONID=xyz/);
});

// ── fetchTransfer ────────────────────────────────────────
test('fetchTransfer：hub 参数进入 URL，且不需要 cookie', async () => {
  const f = mockFetch(() => fakeRes({ body: '{"data":{"middleList":[]}}' }));
  const out = await fetchTransfer({ from: 'VNP', to: 'AOH', date: '2026-10-07', hub: 'NKH', fetchImpl: f });
  expect(out.ok).toBe(true);
  expect(f.calls).toHaveLength(1); // 中转不需要 init
  expect(f.calls[0]!.url).toMatch(/middle_station=NKH/);
  expect((f.calls[0]!.opts.headers as Record<string, string>)['Cookie']).toBeUndefined();
});

// ── fetchTransferBatch（T12 串行 / T13 单项失败不中断）────
test('fetchTransferBatch：串行查多个枢纽，单项失败不影响其余', async () => {
  const f = mockFetch((url) =>
    url.includes('middle_station=BAD')
      ? fakeRes({ status: 302, location: 'https://kyfw.12306.cn/otn/error.html' })
      : fakeRes({ body: '{"data":{"middleList":[]}}' }),
  );
  const out = await fetchTransferBatch({
    from: 'VNP',
    to: 'AOH',
    date: '2026-10-07',
    hubs: ['NKH', 'BAD', 'UUH'],
    fetchImpl: f,
  });
  expect(out).toHaveLength(3);
  expect(out[0]!.ok).toBe(true);
  expect(out[1]!.ok).toBe(false);
  expect(out[1]!.error).toMatch(/error\.html/);
  expect(out[2]!.ok).toBe(true);
  expect(out.map((x) => x.key)).toEqual(['NKH', 'BAD', 'UUH']);
});
