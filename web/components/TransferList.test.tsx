/**
 * TransferList 组件渲染测试（jsdom）
 */

import { test, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
      { trainCode: 'G1', trainNo: '1', startStation: '北京南', endStation: '南京南', fromStation: '北京南', toStation: '南京南', startTime: '06:00', arriveTime: '09:00', duration: '03:00', fromStationNo: '01', toStationNo: '05', seatTypes: 'POMO', seats: { ZE: '有' } },
      { trainCode: 'G2', trainNo: '2', startStation: '南京南', endStation: '上海虹桥', fromStation: '南京南', toStation: '上海虹桥', startTime: '09:30', arriveTime: '12:00', duration: '02:30', fromStationNo: '01', toStationNo: '04', seatTypes: 'POMO', seats: { ZE: '无' } },
    ],
    ...over,
  };
}

const groups = (plans: TransferPlan[]) => mergePlans(annotatePlans(plans));

/** 价格相关 props 的默认值 */
const priceProps = {
  date: '2026-10-07',
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

test('TransferList：同车次在不同枢纽展示对应行程、余票、风险和查价站序', () => {
  const nanjing = plan({ totalMinutes: 400 });
  const hangzhou = plan({
    middleStation: '杭州东', totalMinutes: 380, waitMinutes: 10,
    legs: [
      { ...nanjing.legs[0]!, toStation: '杭州东', toStationNo: '06', arriveTime: '09:50', seats: { ZE: '2' } },
      { ...nanjing.legs[1]!, fromStation: '杭州东', fromStationNo: '02', startTime: '10:00' },
    ],
  });
  const onQueryPrice = vi.fn();
  render(<TransferList groups={groups([nanjing, hangzhou])} {...priceProps} onQueryPrice={onQueryPrice} />);
  expect(screen.getByText(/换乘 南京南.*等待 30分/)).toBeTruthy();
  expect(screen.getByText(/换乘 杭州东.*等待 10分/)).toBeTruthy();
  expect(screen.getByText('总耗时 6时40分')).toBeTruthy();
  expect(screen.getByText('总耗时 6时20分')).toBeTruthy();
  expect(screen.getByText('二等座 2 张')).toBeTruthy();
  expect(screen.getAllByText('低于换乘下限')).toHaveLength(1);
  const buttons = screen.getAllByRole('button', { name: '查价' });
  buttons.forEach((button) => fireEvent.click(button));
  expect(onQueryPrice.mock.calls).toEqual([
    ['1', '01', '05', '2026-10-07', 'POMO'],
    ['2', '01', '04', '2026-10-07', 'POMO'],
    ['1', '01', '06', '2026-10-07', 'POMO'],
    ['2', '02', '04', '2026-10-07', 'POMO'],
  ]);
});

test('TransferList：同枢纽同车次的其他行程可展开，重复响应不生成额外详情', () => {
  const original = plan();
  const alternative = plan({
    fromStation: '北京', totalMinutes: 400,
    legs: [{ ...original.legs[0]!, fromStation: '北京', fromStationNo: '00' }, original.legs[1]!],
  });
  render(<TransferList groups={groups([original, alternative, structuredClone(original)])} {...priceProps} />);
  expect(screen.getByText('北京南 → 上海虹桥')).toBeTruthy();
  expect(screen.queryByText('北京 → 上海虹桥')).toBeNull();
  fireEvent.click(screen.getByText('同车次其他方案（1）'));
  expect(screen.getByText('北京 → 上海虹桥')).toBeTruthy();
  expect(screen.getAllByText('北京南 → 上海虹桥')).toHaveLength(1);
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
      prices={{ '1|01|05': { O: 300 }, '2|01|04': { O: 280 } }}
    />,
  );
  expect(screen.getByText('参考价 ¥580')).toBeTruthy();
});

test('TransferList：只查到一程时不显示合计', () => {
  render(
    <TransferList groups={groups([plan()])} {...priceProps} prices={{ '1|01|05': { O: 300 } }} />,
  );
  expect(screen.queryByText(/参考价/)).toBeNull();
});

// 回归：流式到达的新枢纽面板必须自动展开（defaultActiveKey 只在挂载时生效，
// 会让后到的枢纽默认折叠，用户看不到自动查好的参考价）。
test('TransferList：流式新增枢纽自动展开', async () => {
  const { rerender } = render(<TransferList groups={groups([plan()])} {...priceProps} />);
  expect(screen.getByText('G1')).toBeTruthy(); // 首个枢纽已展开，卡片可见

  const second = plan({
    middleStation: '郑州东',
    firstTrainCode: 'G5',
    secondTrainCode: 'G6',
    legs: [
      { trainCode: 'G5', trainNo: '5', startStation: '北京南', endStation: '郑州东', fromStation: '北京南', toStation: '郑州东', startTime: '07:00', arriveTime: '10:00', duration: '03:00', fromStationNo: '01', toStationNo: '04', seatTypes: 'POMO', seats: { ZE: '有' } },
      { trainCode: 'G6', trainNo: '6', startStation: '郑州东', endStation: '上海虹桥', fromStation: '郑州东', toStation: '上海虹桥', startTime: '10:40', arriveTime: '13:00', duration: '02:20', fromStationNo: '01', toStationNo: '03', seatTypes: 'POMO', seats: { ZE: '有' } },
    ],
  });
  rerender(<TransferList groups={groups([plan(), second])} {...priceProps} />);
  // 后到的郑州东面板也自动展开
  await waitFor(() => expect(screen.getByText('G5')).toBeTruthy());
});

test('TransferList：未查价的程显示「查价」按钮', () => {
  render(<TransferList groups={groups([plan()])} {...priceProps} />);
  expect(screen.getAllByRole('button', { name: '查价' })).toHaveLength(2);
});

test('TransferList：点「查价」触发回调', () => {
  const onQueryPrice = vi.fn();
  render(<TransferList groups={groups([plan()])} {...priceProps} onQueryPrice={onQueryPrice} />);
  screen.getAllByRole('button', { name: '查价' })[0]!.click();
  expect(onQueryPrice).toHaveBeenCalledWith('1', '01', '05', '2026-10-07', 'POMO');
});
