/**
 * TransferList 组件渲染测试（jsdom）
 */

import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import TransferList from './TransferList.tsx';
import { annotatePlans, mergePlans } from '../lib/plans.ts';
import type { TransferPlan } from '../../shared/types.ts';

function plan(over: Partial<TransferPlan> = {}): TransferPlan {
  return {
    fromStation: '北京南',
    middleStation: '南京南',
    endStation: '上海虹桥',
    firstTrainCode: 'G1',
    secondTrainCode: 'G2',
    firstTrainNo: '1',
    secondTrainNo: '2',
    startTime: '06:00',
    arriveTime: '12:00',
    waitMinutes: 30,
    totalMinutes: 360,
    sameStation: true,
    sameTrain: false,
    score: 0,
    legs: [
      { trainCode: 'G1', trainNo: '1', startStation: '北京南', endStation: '南京南', fromStation: '北京南', toStation: '南京南', startTime: '06:00', arriveTime: '09:00', duration: '03:00', fromStationNo: '01', toStationNo: '05', seats: { ZE: '有' } },
      { trainCode: 'G2', trainNo: '2', startStation: '南京南', endStation: '上海虹桥', fromStation: '南京南', toStation: '上海虹桥', startTime: '09:30', arriveTime: '12:00', duration: '02:30', fromStationNo: '01', toStationNo: '04', seats: { ZE: '无' } },
    ],
    ...over,
  };
}

const groups = (plans: TransferPlan[]) => mergePlans(annotatePlans(plans));

/** 价格相关 props 的默认值 */
const priceProps = {
  date: '2026-10-07',
  seat: 'ZE',
  prices: {} as Record<string, Record<string, number>>,
  loadingPrice: new Set<string>(),
  onQueryPrice: vi.fn(),
};

test('TransferList：空列表显示提示', () => {
  render(<TransferList groups={[]} {...priceProps} />);
  expect(screen.getByText('没有中转方案')).toBeTruthy();
});

test('TransferList：按枢纽分组并展示起终点与总耗时', () => {
  render(<TransferList groups={groups([plan()])} {...priceProps} />);
  // 枢纽名同时出现在折叠标题与换乘行，故用 getAllByText
  expect(screen.getAllByText(/南京南/).length).toBeGreaterThan(0);
  expect(screen.getByText('北京南 → 上海虹桥')).toBeTruthy();
  expect(screen.getByText('总耗时 6时')).toBeTruthy();
});

test('TransferList：展示两程车次与换乘等待', () => {
  render(<TransferList groups={groups([plan()])} {...priceProps} />);
  expect(screen.getByText('G1')).toBeTruthy();
  expect(screen.getByText('G2')).toBeTruthy();
  expect(screen.getByText(/换乘 南京南/)).toBeTruthy();
  expect(screen.getByText('同站')).toBeTruthy();
});

test('TransferList：同城异站标签', () => {
  render(<TransferList groups={groups([plan({ sameStation: false })])} {...priceProps} />);
  expect(screen.getByText('同城异站')).toBeTruthy();
});

test('TransferList：低于下限 / 超长等待标记', () => {
  render(<TransferList groups={groups([plan({ waitMinutes: 5, sameStation: true })])} {...priceProps} />);
  expect(screen.getByText('低于换乘下限')).toBeTruthy();
});

test('TransferList：超长等待标记', () => {
  render(<TransferList groups={groups([plan({ waitMinutes: 200 })])} {...priceProps} />);
  expect(screen.getByText('超长等待')).toBeTruthy();
});

// ── 价格 ─────────────────────────────────────────────────
test('TransferList：两程价格都查到时显示合计参考价', () => {
  render(
    <TransferList
      groups={groups([plan()])}
      {...priceProps}
      prices={{ '1|01|05': { ZE: 300 }, '2|01|04': { ZE: 280 } }}
    />,
  );
  expect(screen.getByText('参考价 ¥580')).toBeTruthy();
});

test('TransferList：只查到一程时不显示合计', () => {
  render(
    <TransferList groups={groups([plan()])} {...priceProps} prices={{ '1|01|05': { ZE: 300 } }} />,
  );
  expect(screen.queryByText(/参考价/)).toBeNull();
});

test('TransferList：未查价的程显示「查价」按钮', () => {
  render(<TransferList groups={groups([plan()])} {...priceProps} />);
  expect(screen.getAllByRole('button', { name: '查价' })).toHaveLength(2);
});

test('TransferList：点「查价」触发回调', () => {
  const onQueryPrice = vi.fn();
  render(<TransferList groups={groups([plan()])} {...priceProps} onQueryPrice={onQueryPrice} />);
  screen.getAllByRole('button', { name: '查价' })[0]!.click();
  expect(onQueryPrice).toHaveBeenCalledWith('1', '01', '05', '2026-10-07');
});
