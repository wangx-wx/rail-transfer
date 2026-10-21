/**
 * 中转枢纽选择组件测试（jsdom）
 *
 * 覆盖：候选卡片渲染、选 1/2、上限 2（第 3 个禁用）、取消重选、空态、查询按钮。
 */

import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import HubPicker from '../components/HubPicker.tsx';
import type { HubCandidate } from '../lib/selfbuilt-query.ts';

const CANDIDATES: HubCandidate[] = [
  { code: 'TJP', city: '天津', ratio: 1.007 },
  { code: 'JNK', city: '济南', ratio: 1.025 },
  { code: 'SZH', city: '苏州', ratio: 1.027 },
  { code: 'LSA', city: '拉萨', ratio: null }, // 缺坐标
];

const noop = (): void => {};

function renderPicker(over: Partial<Parameters<typeof HubPicker>[0]> = {}) {
  return render(
    <HubPicker
      candidates={CANDIDATES}
      selected={[]}
      onChange={noop}
      onRun={noop}
      onCancel={noop}
      running={false}
      {...over}
    />,
  );
}

test('HubPicker：渲染候选城市与绕行比值（缺坐标为「—」）', () => {
  renderPicker();
  expect(screen.getByText('天津')).toBeTruthy();
  expect(screen.getByText('1.01')).toBeTruthy();
  expect(screen.getByText('—')).toBeTruthy(); // 拉萨缺坐标
  expect(screen.queryByText('NaN')).toBeNull();
});

test('HubPicker：点第 1 个 → onChange 收到该码', () => {
  const onChange = vi.fn();
  renderPicker({ onChange });
  fireEvent.click(screen.getByRole('button', { name: /天津/ }));
  expect(onChange).toHaveBeenCalledWith(['TJP']);
});

test('HubPicker：已选 2 个后第 3 个禁用（最多 2）', () => {
  const onChange = vi.fn();
  renderPicker({ selected: ['TJP', 'JNK'], onChange });
  const third = screen.getByRole('button', { name: /苏州/ }) as HTMLButtonElement;
  expect(third.disabled).toBe(true);
  fireEvent.click(third);
  expect(onChange).not.toHaveBeenCalled();
});

test('HubPicker：点已选中的可取消', () => {
  const onChange = vi.fn();
  renderPicker({ selected: ['TJP', 'JNK'], onChange });
  fireEvent.click(screen.getByRole('button', { name: /天津/ }));
  expect(onChange).toHaveBeenCalledWith(['JNK']);
});

// antd 会给两字按钮插入空格（`查 询`），故用正则匹配
const QUERY_BTN = /查\s*询/;

test('HubPicker：未选时查询禁用，选中后可查', () => {
  const onRun = vi.fn();
  const { rerender } = renderPicker({ onRun });
  expect((screen.getByRole('button', { name: QUERY_BTN }) as HTMLButtonElement).disabled).toBe(true);

  rerender(
    <HubPicker candidates={CANDIDATES} selected={['TJP']} onChange={noop} onRun={onRun} onCancel={noop} running={false} />,
  );
  fireEvent.click(screen.getByRole('button', { name: QUERY_BTN }));
  expect(onRun).toHaveBeenCalled();
});

test('HubPicker：候选为空 → 空态且无查询按钮', () => {
  renderPicker({ candidates: [] });
  expect(screen.getByText(/没有合适的候选枢纽/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: QUERY_BTN })).toBeNull();
});

test('HubPicker：显示已选计数', () => {
  renderPicker({ selected: ['TJP', 'JNK'] });
  expect(screen.getByText('2/2')).toBeTruthy();
});
