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
    seatTypes: '9MOO',
    seats: [{ code: 'ZE', name: '二等座', available: true, count: null, raw: '有' }],
    ...over,
  };
}

/** 价格相关 props 的默认值 */
const priceProps = {
  prices: {} as Record<string, Record<string, number>>,
  loadingPrice: new Set<string>(),
  onQueryPrice: vi.fn(),
  buyShort: {} as Record<string, import('../lib/buyshort.ts').BuyShortResult>,
  buyShortLoading: new Set<string>(),
  buyShortProgress: {} as Record<string, number>,
  onQueryBuyShort: vi.fn(),
};

test('TrainList：空列表显示提示', () => {
  render(<TrainList result={{ trains: [], stationMap: {}, date: '2026-10-07' }} {...priceProps} />);
  expect(screen.getByText('没有直达车次')).toBeTruthy();
});

test('TrainList：result 为 null 时不渲染', () => {
  const { container } = render(<TrainList result={null} {...priceProps} />);
  expect(container.innerHTML).toBe('');
});

test('TrainList：展示车次、站名与时刻', () => {
  render(
    <TrainList
      result={{ trains: [train()], stationMap: { VNP: '北京南', AOH: '上海虹桥' }, date: '2026-10-07' }}
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
        date: '2026-10-07',
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
        date: '2026-10-07',
      }}
      {...priceProps}
    />,
  );
  expect(screen.getByText('二等座 12 张')).toBeTruthy();
});

// ── 价格（懒加载）────────────────────────────────────────
test('TrainList：未查价时显示「查价」按钮', () => {
  render(
    <TrainList result={{ trains: [train()], stationMap: {}, date: '2026-10-07' }} {...priceProps} />,
  );
  expect(screen.getByRole('button', { name: '查价' })).toBeTruthy();
});

test('TrainList：已查到价格时显示各席别金额', () => {
  render(
    <TrainList
      result={{ trains: [train()], stationMap: {}, date: '2026-10-07' }}
      {...priceProps}
      prices={{ '1|01|02': { O: 626, M: 1033, '9': 2315 } }}
    />,
  );
  expect(screen.getByText('二等座 ¥626')).toBeTruthy();
  expect(screen.getByText('一等座 ¥1033')).toBeTruthy();
  expect(screen.getByText('商务座 ¥2315')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查价' })).toBeNull();
});

test('TrainList：点「查价」触发回调（传车次与站序）', () => {
  const onQueryPrice = vi.fn();
  render(
    <TrainList
      result={{ trains: [train()], stationMap: {}, date: '2026-10-07' }}
      {...priceProps}
      onQueryPrice={onQueryPrice}
    />,
  );
  screen.getByRole('button', { name: '查价' }).click();
  expect(onQueryPrice).toHaveBeenCalledWith('1', '01', '02', '2026-10-07', '9MOO');
});

// ── 买短乘长（D45~D53）──────────────────────────────────
/** 二等座无票的车 */
function soldOutTrain(over: Partial<Train> = {}): Train {
  return train({
    seats: [
      { code: 'ZE', name: '二等座', available: false, count: null, raw: '无' },
      { code: 'ZY', name: '一等座', available: true, count: null, raw: '有' },
    ],
    ...over,
  });
}

test('TrainList：有票车不显示买短乘长入口', () => {
  render(<TrainList result={{ trains: [train()], stationMap: {}, date: '2026-10-07' }} {...priceProps} />);
  expect(screen.queryByRole('button', { name: '买短乘长' })).toBeNull();
});

test('TrainList：无票车显示「买短乘长」按钮', () => {
  render(
    <TrainList
      result={{ trains: [soldOutTrain()], stationMap: {}, date: '2026-10-07' }}
      {...priceProps}
    />,
  );
  expect(screen.getByRole('button', { name: '买短乘长' })).toBeTruthy();
});

test('TrainList：点「买短乘长」传车次与键', () => {
  const onQueryBuyShort = vi.fn();
  render(
    <TrainList
      result={{ trains: [soldOutTrain()], stationMap: {}, date: '2026-10-07' }}
      {...priceProps}
      onQueryBuyShort={onQueryBuyShort}
    />,
  );
  screen.getByRole('button', { name: '买短乘长' }).click();
  expect(onQueryBuyShort).toHaveBeenCalledWith(expect.objectContaining({ trainNo: '1' }), '1');
});

test('TrainList：查询中显示进度文案', () => {
  render(
    <TrainList
      result={{
        trains: [soldOutTrain()],
        stationMap: { VNP: '北京南', AOH: '上海虹桥' },
        date: '2026-10-07',
      }}
      {...priceProps}
      buyShortLoading={new Set(['1'])}
      buyShortProgress={{ '1': 3 }}
    />,
  );
  expect(screen.getByText(/已查 3 站，均无票/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '买短乘长' })).toBeNull();
});

test('TrainList：命中时显示完整句与风险提示', () => {
  render(
    <TrainList
      result={{
        trains: [soldOutTrain()],
        stationMap: { VNP: '北京南', AOH: '上海虹桥' },
        date: '2026-10-07',
      }}
      {...priceProps}
      buyShort={{ '1': { kind: 'found', stationName: '南京南', seatName: '二等座', price: 156 } }}
    />,
  );
  expect(screen.getByText(/买「北京南 → 南京南」二等座 ¥156/)).toBeTruthy();
  expect(screen.getByText('需车上补票，超员时可能被要求下车')).toBeTruthy();
});

test('TrainList：命中但无价格 → 显示「有票」', () => {
  render(
    <TrainList
      result={{ trains: [soldOutTrain()], stationMap: {}, date: '2026-10-07' }}
      {...priceProps}
      buyShort={{ '1': { kind: 'found', stationName: '南京南', seatName: '二等座', price: null } }}
    />,
  );
  expect(screen.getByText(/二等座 有票/)).toBeTruthy();
});

test('TrainList：沿途无票显示灰字', () => {
  render(
    <TrainList
      result={{ trains: [soldOutTrain()], stationMap: {}, date: '2026-10-07' }}
      {...priceProps}
      buyShort={{ '1': { kind: 'none' } }}
    />,
  );
  expect(screen.getByText('该车沿途各站均无票')).toBeTruthy();
});

test('TrainList：无中途站显示灰字', () => {
  render(
    <TrainList
      result={{ trains: [soldOutTrain()], stationMap: {}, date: '2026-10-07' }}
      {...priceProps}
      buyShort={{ '1': { kind: 'noCandidate' } }}
    />,
  );
  expect(screen.getByText('该车无中途可买站')).toBeTruthy();
});

test('TrainList：普速车硬座无票也显示买短乘长入口', () => {
  const t = soldOutTrain({
    seatTypes: '1341',
    seats: [
      { code: 'ZE', name: '二等座', available: false, count: null, raw: '' },
      { code: 'YZ', name: '硬座', available: false, count: null, raw: '无' },
    ],
  });
  render(<TrainList result={{ trains: [t], stationMap: {}, date: '2026-10-07' }} {...priceProps} />);
  expect(screen.getByRole('button', { name: '买短乘长' })).toBeTruthy();
});
