/**
 * 取数层单测（T21 精神：mock fetch 测纯逻辑，不联网）
 *
 * 真实 workerd 运行时测试（T20）留待 Workers 部署验证阶段；
 * 本层逻辑环境无关（全局 fetch + getSetCookie），Node 下 mock 即可覆盖分支。
 *
 * 运行：node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractCookies,
  classify,
  initCookie,
  fetchLeftTicket,
  fetchTransfer,
  fetchTransferBatch,
} from './source.js';

/** 构造一个假 Response（含默认 text()，可用 body 覆盖） */
function fakeRes({ status = 200, body = '', location = '', cookies = [] } = {}) {
  return {
    status,
    text: async () => body,
    headers: {
      get: (k) => (k.toLowerCase() === 'location' ? location : null),
      getSetCookie: () => cookies,
    },
  };
}

/** 记录调用的 fetch mock */
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts, calls.length);
  };
  fn.calls = calls;
  return fn;
}

// ── extractCookies ───────────────────────────────────────
test('extractCookies：优先 getSetCookie', () => {
  const r = fakeRes({ cookies: ['a=1; Path=/', 'b=2; Path=/'] });
  assert.deepEqual(extractCookies(r), ['a=1; Path=/', 'b=2; Path=/']);
});

test('extractCookies：回退合并 set-cookie 头', () => {
  const r = { headers: { get: (k) => (k === 'set-cookie' ? 'a=1; Path=/' : null) } };
  assert.deepEqual(extractCookies(r), ['a=1; Path=/']);
});

// ── classify（T14：真错误 vs 正常空结果）──────────────────
test('classify：200 + JSON → ok', () => {
  assert.equal(classify(fakeRes({ status: 200 }), '{"data":""}').ok, true);
});

test('classify：空 data 不算错误', () => {
  const c = classify(fakeRes({ status: 200 }), '{"status":true,"data":"","errorMsg":"没有查询到中转方案"}');
  assert.equal(c.ok, true);
});

test('classify：302 → error.html 是真错误', () => {
  const c = classify(fakeRes({ status: 302, location: 'https://kyfw.12306.cn/otn/error.html' }), '');
  assert.equal(c.ok, false);
  assert.match(c.error, /error\.html/);
});

test('classify：网络失败 → retriable', () => {
  const c = classify({ error: 'fetch failed' }, '');
  assert.equal(c.ok, false);
  assert.equal(c.retriable, true);
});

test('classify：HTTP 500 → retriable，404 → 不可重试', () => {
  assert.equal(classify(fakeRes({ status: 500 }), '').retriable, true);
  assert.equal(classify(fakeRes({ status: 404 }), '').retriable, false);
});

test('classify：非 JSON → 真错误', () => {
  assert.equal(classify(fakeRes({ status: 200 }), '<html>').ok, false);
});

// ── initCookie（T8）──────────────────────────────────────
test('initCookie：拼出 Cookie 头', async () => {
  const f = mockFetch(async () =>
    fakeRes({ body: '{"ok":true}', cookies: ['JSESSIONID=abc; Path=/', 'RAIL_EXPIRATION=1; Path=/'] }),
  );
  const cookie = await initCookie({ fetchImpl: f });
  assert.equal(cookie, 'JSESSIONID=abc; RAIL_EXPIRATION=1');
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/otn\/leftTicket\/init$/);
});

// ── fetchLeftTicket ──────────────────────────────────────
test('fetchLeftTicket：先 init 再 query，且带 Cookie', async () => {
  const withText = mockFetch(async (url) =>
    url.includes('/init')
      ? fakeRes({ body: '{"ok":true}', cookies: ['JSESSIONID=xyz; Path=/'] })
      : fakeRes({ body: '{"data":{"result":[]}}' }),
  );
  const out = await fetchLeftTicket({ from: 'VNP', to: 'AOH', date: '2026-10-07', fetchImpl: withText });
  assert.equal(out.ok, true);
  assert.equal(withText.calls.length, 2);
  assert.match(withText.calls[0].url, /\/init$/);
  assert.match(withText.calls[1].url, /queryG\?leftTicketDTO\.train_date=2026-10-07/);
  assert.match(withText.calls[1].opts.headers.Cookie, /JSESSIONID=xyz/);
});

// ── fetchTransfer ────────────────────────────────────────
test('fetchTransfer：hub 参数进入 URL，且不需要 cookie', async () => {
  const f = mockFetch(async () => {
    const r = fakeRes({ status: 200 });
    r.text = async () => '{"data":{"middleList":[]}}';
    return r;
  });
  const out = await fetchTransfer({ from: 'VNP', to: 'AOH', date: '2026-10-07', hub: 'NKH', fetchImpl: f });
  assert.equal(out.ok, true);
  assert.equal(f.calls.length, 1); // 中转不需要 init
  assert.match(f.calls[0].url, /middle_station=NKH/);
  assert.equal(f.calls[0].opts.headers.Cookie, undefined);
});

// ── fetchTransferBatch（T12 串行 / T13 单项失败不中断）────
test('fetchTransferBatch：串行查多个枢纽，单项失败不影响其余', async () => {
  const f = mockFetch(async (url) => {
    if (url.includes('middle_station=BAD')) {
      const r = fakeRes({ status: 302, location: 'https://kyfw.12306.cn/otn/error.html' });
      r.text = async () => '';
      return r;
    }
    const r = fakeRes({ status: 200 });
    r.text = async () => '{"data":{"middleList":[]}}';
    return r;
  });
  const out = await fetchTransferBatch({
    from: 'VNP',
    to: 'AOH',
    date: '2026-10-07',
    hubs: ['NKH', 'BAD', 'UUH'],
    fetchImpl: f,
  });
  assert.equal(out.length, 3);
  assert.equal(out[0].ok, true);
  assert.equal(out[1].ok, false);
  assert.match(out[1].error, /error\.html/);
  assert.equal(out[2].ok, true);
  assert.deepEqual(out.map((x) => x.key), ['NKH', 'BAD', 'UUH']);
});
