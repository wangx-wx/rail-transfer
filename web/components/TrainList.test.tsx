/**
 * TrainList 组件渲染测试（jsdom）
 */

import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import TrainList from './TrainList.tsx';
import type { Train } from '../../shared/types.ts';

function train(over: Partial<Train> = {}): Train {
  return {
    trainCode: 'G1',
    trainNo: '1',
    startTime: '06:00',
    arriveTime: '12:00',
    duration: '06:00',
    trainDate: '20261007',
    fromStation: 'VNP',
    toStation: 'AOH',
    startStation: 'VNP',
    endStation: 'AOH',
    fromStationNo: '01',
    toStationNo: '02',
    secretStr: '',
    seats: [{ code: 'ZE', name: '二等座', available: true, count: null, raw: '有' }],
    ...over,
  };
}

/** 价格相关 props 的默认值 */
const priceProps = {
  prices: {} as Record<string, number>,
  loadingPrice: new Set<string>(),
  onQueryPrice: vi.fn(),
};

test('TrainList：空列表显示提示', () => {
  render(<TrainList result={{ trains: [], stationMap: {}, seat: 'ZE' }} {...priceProps} />);
  expect(screen.getByText('没有直达车次')).toBeTruthy();
});

test('TrainList：result 为 null 时不渲染', () => {
  const { container } = render(<TrainList result={null} {...priceProps} />);
  expect(container.innerHTML).toBe('');
});

test('TrainList：展示车次、站名与时刻', () => {
  render(
    <TrainList
      result={{ trains: [train()], stationMap: { VNP: '北京南', AOH: '上海虹桥' }, seat: 'ZE' }}
      {...priceProps}
    />,
  );
  expect(screen.getByText('G1')).toBeTruthy();
  expect(screen.getByText('北京南')).toBeTruthy();
  expect(screen.getByText('上海虹桥')).toBeTruthy();
  // 06:00 同时是发车时刻与历时，故用 getAllByText
  expect(screen.getAllByText('06:00').length).toBeGreaterThan(0);
});

test('TrainList：始发/终到与上下车不同时标注', () => {
  render(
    <TrainList
      result={{
        trains: [train({ startStation: 'BJP', endStation: 'HGH' })],
        stationMap: { VNP: '北京南', AOH: '上海虹桥', BJP: '北京', HGH: '杭州东' },
        seat: 'ZE',
      }}
      {...priceProps}
    />,
  );
  expect(screen.getByText('始发 北京 · 终到 杭州东')).toBeTruthy();
});

test('TrainList：席别余票展示为标签', () => {
  render(
    <TrainList
      result={{
        trains: [train({ seats: [{ code: 'ZE', name: '二等座', available: true, count: 12, raw: '12' }] })],
        stationMap: {},
        seat: 'ZE',
      }}
      {...priceProps}
    />,
  );
  expect(screen.getByText('二等座 12 张')).toBeTruthy();
});

// ── 价格（懒加载）────────────────────────────────────────
test('TrainList：未查价时显示「查价」按钮', () => {
  render(
    <TrainList result={{ trains: [train()], stationMap: {}, seat: 'ZE' }} {...priceProps} />,
  );
  expect(screen.getByRole('button', { name: '查价' })).toBeTruthy();
});

test('TrainList：已查到价格时显示金额', () => {
  render(
    <TrainList
      result={{ trains: [train()], stationMap: {}, seat: 'ZE' }}
      {...priceProps}
      prices={{ '1|01|02': 626 }}
    />,
  );
  expect(screen.getByText('¥626')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查价' })).toBeNull();
});

test('TrainList：点「查价」触发回调（传车次与站序）', () => {
  const onQueryPrice = vi.fn();
  render(
    <TrainList
      result={{ trains: [train()], stationMap: {}, seat: 'ZE' }}
      {...priceProps}
      onQueryPrice={onQueryPrice}
    />,
  );
  screen.getByRole('button', { name: '查价' }).click();
  expect(onQueryPrice).toHaveBeenCalledWith('1', '01', '02', '20261007');
});
