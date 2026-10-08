/**
 * QueryForm 组件测试（jsdom）
 *
 * 覆盖：城市联想、起终点对调、未填必填项时不触发查询。
 */

import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import QueryForm from './QueryForm.tsx';

test('QueryForm：渲染城市、日期、口令与两个按钮', () => {
  render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={vi.fn()} onSelfBuilt={vi.fn()} />);
  expect(screen.getByText('出发城市')).toBeTruthy();
  expect(screen.getByText('到达城市')).toBeTruthy();
  expect(screen.getByText('日期')).toBeTruthy();
  expect(screen.getByRole('button', { name: '查直达' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查中转' })).toBeTruthy();
});

test('QueryForm：无席别筛选框', () => {
  render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={vi.fn()} onSelfBuilt={vi.fn()} />);
  expect(screen.queryByText('席别')).toBeNull();
});

test('QueryForm：对调按钮交换出发与到达城市', async () => {
  const { container } = render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={vi.fn()} onSelfBuilt={vi.fn()} />);
  // AutoComplete 的 placeholder 不在 input 上，故用 id 定位
  const from = container.querySelector<HTMLInputElement>('#from')!;
  const to = container.querySelector<HTMLInputElement>('#to')!;
  fireEvent.change(from, { target: { value: '北京' } });
  fireEvent.change(to, { target: { value: '上海' } });

  fireEvent.click(screen.getByRole('button', { name: '对调出发与到达城市' }));

  await waitFor(() => {
    expect(from.value).toBe('上海');
    expect(to.value).toBe('北京');
  });
});

test('QueryForm：未填城市时点查直达不触发查询', async () => {
  const onDirect = vi.fn();
  render(<QueryForm querying={false} onDirect={onDirect} onTransfer={vi.fn()} onSelfBuilt={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '查直达' }));
  await waitFor(() => expect(screen.getByText('请输入出发城市')).toBeTruthy());
  expect(onDirect).not.toHaveBeenCalled();
});

test('QueryForm：querying 时两个按钮进入 loading 态', () => {
  render(<QueryForm querying onDirect={vi.fn()} onTransfer={vi.fn()} onSelfBuilt={vi.fn()} />);
  // antd 6 的 loading 按钮不设 disabled 属性，而是加 ant-btn-loading 类
  const direct = screen.getByRole('button', { name: /查直达/ });
  const transfer = screen.getByRole('button', { name: /查中转/ });
  expect(direct.className).toContain('ant-btn-loading');
  expect(transfer.className).toContain('ant-btn-loading');
});

test('QueryForm：口令默认显示，保留原输入方式和查询参数', async () => {
  const onTransfer = vi.fn();
  const { container } = render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={onTransfer} onSelfBuilt={vi.fn()} />);
  const token = screen.getByRole('textbox', { name: '口令' }) as HTMLInputElement;
  expect(token.closest('details')).toBeNull();
  expect(token.type).toBe('text');
  fireEvent.change(token, { target: { value: 'sample-token' } });
  fireEvent.change(container.querySelector('#from')!, { target: { value: '北京' } });
  fireEvent.change(container.querySelector('#to')!, { target: { value: '上海' } });
  fireEvent.click(screen.getByRole('button', { name: '对调出发与到达城市' }));
  fireEvent.click(screen.getByRole('button', { name: '查中转' }));
  await waitFor(() => expect(onTransfer).toHaveBeenCalledWith(expect.objectContaining({
    from: expect.objectContaining({ code: 'SHH' }),
    to: expect.objectContaining({ code: 'BJP' }),
    token: 'sample-token',
  })));
});

// ── D58：最多换乘次数选择器 ───────────────────────────────
test('QueryForm：默认「最多换乘 1 次」，可切到 2 次并随查询上报', async () => {
  const onTransfer = vi.fn();
  const { container } = render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={onTransfer} onSelfBuilt={vi.fn()} />);
  expect(screen.getByText('最多换乘')).toBeTruthy();

  fireEvent.change(container.querySelector('#from')!, { target: { value: '广州' } });
  fireEvent.change(container.querySelector('#to')!, { target: { value: '十堰' } });
  // 打开选择器并选「2 次」
  fireEvent.mouseDown(container.querySelector('#transfers')!);
  fireEvent.click(await screen.findByTitle('2 次'));
  fireEvent.click(screen.getByRole('button', { name: '查中转' }));

  await waitFor(() => expect(onTransfer).toHaveBeenCalledWith(expect.objectContaining({ maxTransfers: 2 })));
});

test('QueryForm：不选时默认 maxTransfers = 1', async () => {
  const onTransfer = vi.fn();
  const { container } = render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={onTransfer} onSelfBuilt={vi.fn()} />);
  fireEvent.change(container.querySelector('#from')!, { target: { value: '广州' } });
  fireEvent.change(container.querySelector('#to')!, { target: { value: '十堰' } });
  fireEvent.click(screen.getByRole('button', { name: '查中转' }));
  await waitFor(() => expect(onTransfer).toHaveBeenCalledWith(expect.objectContaining({ maxTransfers: 1 })));
});

test('QueryForm：点「自研中转」触发 onSelfBuilt 并带上换乘次数', async () => {
  const onSelfBuilt = vi.fn();
  const { container } = render(
    <QueryForm querying={false} onDirect={vi.fn()} onTransfer={vi.fn()} onSelfBuilt={onSelfBuilt} />,
  );
  expect(screen.getByRole('button', { name: '自研中转' })).toBeTruthy();
  fireEvent.change(container.querySelector('#from')!, { target: { value: '广州' } });
  fireEvent.change(container.querySelector('#to')!, { target: { value: '十堰' } });
  fireEvent.click(screen.getByRole('button', { name: '自研中转' }));
  await waitFor(() => expect(onSelfBuilt).toHaveBeenCalledWith(expect.objectContaining({ maxTransfers: 1 })));
});
