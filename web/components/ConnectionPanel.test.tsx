/**
 * 共用接驳面板组件测试（jsdom）
 *
 * 覆盖 D70~D74 的可见行为：按钮、加载态、摘要文案、展开详情、降级口径。
 * 组件只接收「换乘点 + 已加载结果」，取数由父层注入——测试不碰网络。
 */

import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ConnectionPanel from './ConnectionPanel.tsx';
import type { ConnectionResult } from '../lib/connection.ts';

/** 一次可查的换乘点 */
const POINT = {
  fromName: '北京南',
  toName: '北京西',
  fromCode: 'VNP',
  toCode: 'BXP',
  waitMinutes: 90,
};

/** 公交 + 打车都拿到的结果（等待 90 分，公交 30 分、打车 16 分） */
function okResult(over: Partial<Extract<ConnectionResult, { kind: 'ok' }>> = {}) {
  return {
    kind: 'ok' as const,
    km: 5.9,
    transit: {
      kind: 'plan' as const,
      plan: {
        durationMinutes: 30,
        distanceMeters: 8056,
        walkMeters: 380,
        fareFen: 400,
        transfers: 1,
        hasSubway: true,
        lines: [
          { vehicle: 'SUBWAY' as const, title: '地铁4号线大兴线', geton: '北京南站', getoff: '菜市口', stationCount: 2, runningStatus: 300 },
          { vehicle: 'SUBWAY' as const, title: '地铁7号线', geton: '菜市口', getoff: '北京西站', stationCount: 4, runningStatus: 300 },
        ],
      },
    },
    driving: {
      kind: 'plan' as const,
      plan: { durationMinutes: 16, distanceMeters: 11057, fare: 33, tollYuan: 0 },
    },
    flags: [],
    ...over,
  };
}

const noop = vi.fn();

test('ConnectionPanel：未查询时只有「查接驳」按钮，无方案内容', () => {
  render(<ConnectionPanel point={POINT} result={null} loading={false} onQuery={noop} />);
  expect(screen.getByRole('button', { name: /查接驳/ })).toBeTruthy();
  expect(screen.queryByText(/公交/)).toBeNull();
});

test('ConnectionPanel：显示「到达站 → 下一程出发站」而非只有到达站（D69/T61）', () => {
  render(<ConnectionPanel point={POINT} result={null} loading={false} onQuery={noop} />);
  expect(screen.getByText(/北京南\s*→\s*北京西/)).toBeTruthy();
});

test('ConnectionPanel：点击按钮触发一次查询', () => {
  const onQuery = vi.fn();
  render(<ConnectionPanel point={POINT} result={null} loading={false} onQuery={onQuery} />);
  fireEvent.click(screen.getByRole('button', { name: /查接驳/ }));
  expect(onQuery).toHaveBeenCalledTimes(1);
});

test('ConnectionPanel：加载中按钮显示 loading 且不可重复点击', () => {
  render(<ConnectionPanel point={POINT} result={null} loading onQuery={noop} />);
  const btn = screen.getByRole('button', { name: /查接驳/ });
  expect(btn.className).toContain('ant-btn-loading');
});

test('ConnectionPanel：摘要给出公交与打车的时间与余量（D72）', () => {
  const { container } = render(<ConnectionPanel point={POINT} result={okResult()} loading={false} onQuery={noop} />);
  const rows = [...container.querySelectorAll('.connection-mode')].map((n) => n.textContent?.replace(/\s+/g, ''));
  // 等待 90 分：公交 30 分 → 余 60 分；打车 16 分 → 余 74 分
  expect(rows).toEqual(['公交30分·余1时', '打车16分·余1时14分']);
});

test('ConnectionPanel：展开后给出线路名、上下车站、步行距离、里程、直线距离（D72）', () => {
  render(<ConnectionPanel point={POINT} result={okResult()} loading={false} onQuery={noop} />);
  fireEvent.click(screen.getByText(/展开详情/));
  expect(screen.getByText(/地铁4号线大兴线/)).toBeTruthy();
  // 「菜市口」既是第一段下车站、也是第二段上车站，故两处都在
  expect(screen.getAllByText(/菜市口/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/步行\s*380\s*米/)).toBeTruthy();
  expect(screen.getByText(/8\.1\s*公里/)).toBeTruthy(); // 8056 米
  expect(screen.getByText(/直线\s*5\.9\s*公里/)).toBeTruthy();
});

test('ConnectionPanel：上游给了车费就展示并标「路况估算」（D76）', () => {
  render(<ConnectionPanel point={POINT} result={okResult()} loading={false} onQuery={noop} />);
  fireEvent.click(screen.getByText(/展开详情/));
  expect(screen.getByText(/¥4/)).toBeTruthy();
  expect(screen.getByText(/¥33/)).toBeTruthy();
  expect(screen.getByText(/路况估算/)).toBeTruthy();
});

test('ConnectionPanel：上游没给车费 → 只给时间与里程，不显示任何价格或估价（D76）', () => {
  const r = okResult();
  r.driving = {
    kind: 'plan',
    plan: { durationMinutes: 16, distanceMeters: 11057, fare: null, tollYuan: 0 },
  };
  const { container } = render(<ConnectionPanel point={POINT} result={r} loading={false} onQuery={noop} />);
  fireEvent.click(screen.getByText(/展开详情/));
  const dr = container.querySelectorAll('.connection-detail')[1]!.textContent ?? '';
  expect(dr).toMatch(/16分/);
  expect(dr).toMatch(/11\.1 公里/);
  // 不打价格、不出现「估算」字样
  expect(dr).not.toMatch(/¥/);
  expect(dr).not.toMatch(/估算/);
});

test('ConnectionPanel：过路费 > 0 时单独一行（D76）', () => {
  const r = okResult();
  r.driving = { kind: 'plan', plan: { durationMinutes: 50, distanceMeters: 60000, fare: 150, tollYuan: 25 } };
  render(<ConnectionPanel point={POINT} result={r} loading={false} onQuery={noop} />);
  fireEvent.click(screen.getByText(/展开详情/));
  expect(screen.getByText(/过路费\s*¥25/)).toBeTruthy();
});

test('ConnectionPanel：无地铁时显示「无地铁」标签（D73）', () => {
  const r = okResult();
  if (r.transit.kind === 'plan') r.transit.plan = { ...r.transit.plan, hasSubway: false };
  r.flags = [{ label: '无地铁', kind: 'info' }];
  render(<ConnectionPanel point={POINT} result={r} loading={false} onQuery={noop} />);
  expect(screen.getByText('无地铁')).toBeTruthy();
});

test('ConnectionPanel：跨城只给一行事实、无按钮（D75）', () => {
  render(<ConnectionPanel point={POINT} result={{ kind: 'crossCity', km: 110 }} loading={false} onQuery={noop} />);
  expect(screen.getByText(/跨城接驳/)).toBeTruthy();
  expect(screen.getByText(/直线约\s*110\s*公里/)).toBeTruthy();
  expect(screen.getByText(/不提供市内交通方案/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /查接驳/ })).toBeNull();
});

test('ConnectionPanel：缺坐标 → 按钮禁用并说明原因（D74）', () => {
  render(<ConnectionPanel point={POINT} result={{ kind: 'noCoord' }} loading={false} onQuery={noop} />);
  const btn = screen.getByRole('button', { name: /查接驳/ }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(screen.getByText(/未获取到站点位置/)).toBeTruthy();
});

test('ConnectionPanel：网络失败显示原因与重试按钮（D74）', () => {
  const r = okResult();
  r.transit = { kind: 'error', message: '接驳查询失败', retriable: true };
  r.driving = { kind: 'empty' };
  render(<ConnectionPanel point={POINT} result={r} loading={false} onQuery={noop} />);
  expect(screen.getByText(/接驳查询失败/)).toBeTruthy();
  // antd 会在两个汉字之间插空格（「重 试」），故用宽松匹配
  expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy();
});

test('ConnectionPanel：业务性失败不给重试按钮（D74）', () => {
  const r = okResult();
  r.transit = { kind: 'error', message: '腾讯不支持该城市的公交查询', retriable: false };
  r.driving = { kind: 'empty' };
  render(<ConnectionPanel point={POINT} result={r} loading={false} onQuery={noop} />);
  expect(screen.getByText(/不支持该城市/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /重\s*试/ })).toBeNull();
});

test('ConnectionPanel：查不到方案 → 「暂未获取到接驳方案」，不显示 0 分钟（D74）', () => {
  render(
    <ConnectionPanel
      point={POINT}
      result={okResult({ transit: { kind: 'empty' }, driving: { kind: 'empty' } })}
      loading={false}
      onQuery={noop}
    />,
  );
  expect(screen.getByText(/暂未获取到接驳方案/)).toBeTruthy();
  expect(screen.queryByText(/0分/)).toBeNull();
});

test('ConnectionPanel：点击重试再次触发查询', () => {
  const onQuery = vi.fn();
  const r = okResult();
  r.transit = { kind: 'error', message: '接驳查询失败', retriable: true };
  r.driving = { kind: 'empty' };
  render(<ConnectionPanel point={POINT} result={r} loading={false} onQuery={onQuery} />);
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  expect(onQuery).toHaveBeenCalledTimes(1);
});

test('ConnectionPanel：key 未配置 → 显示原因且不给重试（D74）', () => {
  const r = okResult();
  r.transit = { kind: 'error', message: '接驳服务未配置（缺少 TENCENT_KEY）', retriable: false };
  r.driving = { kind: 'error', message: '接驳服务未配置（缺少 TENCENT_KEY）', retriable: false };
  render(<ConnectionPanel point={POINT} result={r} loading={false} onQuery={noop} />);
  expect(screen.getAllByText(/接驳服务未配置/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /重\s*试/ })).toBeNull();
});
