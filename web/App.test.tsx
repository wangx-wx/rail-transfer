/** 中转查询状态回归：使用真实 API 封装、编排与解析，只替换网络和表单输入。 */
import { afterEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import App from './App.tsx';
import type { QueryContext } from './components/QueryForm.tsx';
import type { PlanGroup } from '../shared/types.ts';
import transferFixture from '../test/fixtures/transfer-10.json';

vi.mock('./components/QueryForm.tsx', () => ({
  default: ({ onTransfer, onSelfBuilt, querying }: { onTransfer: (ctx: QueryContext) => void; onSelfBuilt: (ctx: QueryContext) => void; querying: boolean }) => (
    <>
      <button disabled={querying} onClick={() => onTransfer({
        from: { code: 'ICW', stations: ['ICW'] },
        to: { code: 'ZGE', stations: ['ZGE'] },
        date: '2026-10-07',
        token: 'test-token',
      })}>查中转</button>
      <button disabled={querying} onClick={() => onSelfBuilt({
        from: { code: 'VNP', stations: ['VNP'] },
        to: { code: 'AOH', stations: ['AOH'] },
        date: '2026-10-20',
        token: '',
      })}>自研中转</button>
    </>
  ),
}));

vi.mock('./components/TransferList.tsx', () => ({
  default: ({ groups }: { groups: PlanGroup[] }) => (
    <div>{groups.map((group) => <span key={`${group.firstTrainNo}-${group.secondTrainNo}`}>{group.best.firstTrainCode}</span>)}</div>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

function mockTransfer(handler: (hubs: string[]) => Response | Promise<Response>) {
  const calls: string[][] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/transfer') {
      const hubs = url.searchParams.get('hubs')?.split(',') ?? [];
      calls.push(hubs);
      return handler(hubs);
    }
    return Response.json({ ok: true, data: { data: {} } });
  }));
  return calls;
}

function emptySuccess(hubs: string[]): Response {
  return Response.json({
    ok: true,
    items: (hubs.length ? hubs : ['']).map((key) => ({ key, ok: true, data: { data: {} } })),
  });
}

function queryTransfer(): void {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '查中转' }));
}

test('中转全部返回 HTTP 401 时最终显示查询失败与口令错误', async () => {
  mockTransfer(() => Response.json({ ok: false, error: '口令错误' }, { status: 401 }));
  queryTransfer();
  expect(await screen.findByText(/^中转查询失败：.*口令错误/)).toBeTruthy();
  expect(screen.queryByText(/^完成：/)).toBeNull();
});

test('基线单项失败、后续成功时最终保留部分完成警告', async () => {
  mockTransfer((hubs) => hubs.length === 0
    ? Response.json({ ok: true, items: [{ key: '', ok: false, error: 'HTTP 503' }] })
    : emptySuccess(hubs));
  queryTransfer();
  expect(await screen.findByText(/^查询部分完成：.*官方基线.*HTTP 503/)).toBeTruthy();
});

test('整段网络异常后继续查询，最终保留失败段和原因', async () => {
  let failed = false;
  const calls = mockTransfer((hubs) => {
    if (hubs.length && !failed) {
      failed = true;
      throw new Error('网络连接失败');
    }
    return emptySuccess(hubs);
  });
  queryTransfer();
  expect(await screen.findByText(/^查询部分完成：.*第 1 段.*网络连接失败/)).toBeTruthy();
  expect(calls.length).toBeGreaterThan(2);
});

test('单枢纽失败仍保留同段成功方案，后续成功段不覆盖最终警告', async () => {
  let firstSegment = true;
  mockTransfer((hubs) => {
    if (!hubs.length || !firstSegment) return emptySuccess(hubs);
    firstSegment = false;
    return Response.json({
      ok: true,
      items: hubs.map((key, index) => index === 0
        ? { key, ok: false, error: '枢纽上游失败' }
        : { key, ok: true, data: { data: { middleList: index === 1 ? [transferFixture.data.middleList[0]] : [] } } }),
    });
  });
  queryTransfer();
  expect(await screen.findByText(/^查询部分完成：中转 1 条方案；.*枢纽上游失败/)).toBeTruthy();
  expect(screen.getByText('G8735')).toBeTruthy();
});

test('所有单项失败时不把成功批次外壳当作查询成功', async () => {
  mockTransfer((hubs) => Response.json({
    ok: true,
    items: (hubs.length ? hubs : ['']).map((key) => ({ key, ok: false, error: '上游不可用' })),
  }));
  queryTransfer();
  expect(await screen.findByText(/^中转查询失败：.*上游不可用/)).toBeTruthy();
});

test('全部成功但无方案时正常完成，不显示失败警告', async () => {
  const calls = mockTransfer(emptySuccess);
  queryTransfer();
  expect(await screen.findByText('完成：中转 0 条方案')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(calls[0]).toEqual([]);
});

// ── D68：自研中转交互式选择枢纽 ──────────────────────────
test('自研中转：点按钮后瞬出候选枢纽，且 fetch 零调用（候选阶段零请求）', () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true, data: { data: {} } }));
  vi.stubGlobal('fetch', fetchMock);

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '自研中转' }));

  expect(screen.getByText('选择中转枢纽')).toBeTruthy();
  expect(screen.getByText('天津')).toBeTruthy();   // 候选卡片
  expect(fetchMock).not.toHaveBeenCalled();          // 核心卖点：零请求
});

test('自研中转：未选枢纽时查询禁用', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, data: { data: {} } })));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '自研中转' }));
  expect((screen.getByRole('button', { name: /查\s*询/ }) as HTMLButtonElement).disabled).toBe(true);
});

test('自研中转：选 1 个枢纽后点查询 → 只对该枢纽发请求（请求数在个位）', async () => {
  const leftTicketCalls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/left-ticket') {
      leftTicketCalls.push(`${url.searchParams.get('from')}>${url.searchParams.get('to')}`);
      return Response.json({ ok: true, data: { data: { result: [], map: {} } } });
    }
    if (url.pathname === '/api/stopover') return Response.json({ ok: true, data: { data: { data: [] } } });
    return Response.json({ ok: true, data: { data: {} } });
  }));

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '自研中转' }));
  fireEvent.click(screen.getByRole('button', { name: /天津/ }));  // 选 1 个
  fireEvent.click(screen.getByRole('button', { name: /查\s*询/ }));

  expect(await screen.findByText(/自研中转 .* 条方案/)).toBeTruthy();
  // 选 1 个枢纽：枚举 2 次（去+回），远小于全枚举的 24 次
  expect(leftTicketCalls.length).toBeLessThanOrEqual(4);
  expect(leftTicketCalls.length).toBeGreaterThan(0);
});
