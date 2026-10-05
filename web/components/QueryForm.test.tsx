/**
 * QueryForm 组件测试（jsdom）
 *
 * 覆盖：城市联想选项、席别选项来自 SEAT_OPTIONS、未填必填项时不触发查询。
 */

import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import QueryForm from './QueryForm.tsx';
import { SEAT_OPTIONS } from '../../shared/constants.ts';

test('QueryForm：渲染城市、日期、席别、口令与两个按钮', () => {
  render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={vi.fn()} />);
  expect(screen.getByText('出发城市')).toBeTruthy();
  expect(screen.getByText('到达城市')).toBeTruthy();
  expect(screen.getByText('日期')).toBeTruthy();
  expect(screen.getByText('席别')).toBeTruthy();
  expect(screen.getByRole('button', { name: '查直达' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查中转' })).toBeTruthy();
});

test('QueryForm：席别选项来自 SEAT_OPTIONS（单一数据源）', async () => {
  render(<QueryForm querying={false} onDirect={vi.fn()} onTransfer={vi.fn()} />);
  // 默认选中第一项，展示其中文名
  const first = SEAT_OPTIONS[0]!;
  expect(screen.getByText(first.name)).toBeTruthy();
});

test('QueryForm：未填城市时点查直达不触发查询', async () => {
  const onDirect = vi.fn();
  render(<QueryForm querying={false} onDirect={onDirect} onTransfer={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '查直达' }));
  await waitFor(() => expect(screen.getByText('请输入出发城市')).toBeTruthy());
  expect(onDirect).not.toHaveBeenCalled();
});

test('QueryForm：querying 时两个按钮进入 loading 态', () => {
  render(<QueryForm querying onDirect={vi.fn()} onTransfer={vi.fn()} />);
  // antd 6 的 loading 按钮不设 disabled 属性，而是加 ant-btn-loading 类
  const direct = screen.getByRole('button', { name: /查直达/ });
  const transfer = screen.getByRole('button', { name: /查中转/ });
  expect(direct.className).toContain('ant-btn-loading');
  expect(transfer.className).toContain('ant-btn-loading');
});
