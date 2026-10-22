import { expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import JourneyTimes from '../components/JourneyTimes.tsx';

test('时刻表保留完整长站名与发到时刻，历时单独标识', () => {
  render(<JourneyTimes fromStation="上海浦东国际机场" toStation="呼和浩特东" startTime="23:50" arriveTime="07:15" duration="7时25分" />);
  const journey = screen.getByRole('group', { name: '行程时间' });
  expect(within(journey).getByText('上海浦东国际机场')).toBeTruthy();
  expect(within(journey).getByText('呼和浩特东')).toBeTruthy();
  expect(within(journey).getByText('23:50')).toBeTruthy();
  expect(within(journey).getByText('07:15')).toBeTruthy();
  expect(within(journey).getByLabelText('历时')).toHaveProperty('textContent', '7时25分');
});

test('跨天：到达时刻标 +N 上标（历时反推，T44）', () => {
  render(<JourneyTimes fromStation="北京南" toStation="杭州东" startTime="19:10" arriveTime="07:31" duration="12时21分" />);
  const badge = screen.getByLabelText('跨1天');
  expect(badge.textContent).toBe('+1');
});

test('同日：不出现跨天标识', () => {
  render(<JourneyTimes fromStation="北京南" toStation="上海虹桥" startTime="08:00" arriveTime="12:30" duration="4时30分" />);
  expect(screen.queryByLabelText(/跨\d+天/)).toBeNull();
});

// ── D79：跨 2 天以上必须正确标 +2，不能一律退化成 +1 ──────
test('跨 2 天：显示 +2 而不是 +1（D79）', () => {
  // 20:00 发 + 50 小时 = 第 3 天 22:00 到；到达时刻数值大于发车，旧的
  // 「到达 < 发车」回退判断会漏判
  render(<JourneyTimes fromStation="广州" toStation="拉萨" startTime="20:00" arriveTime="22:00" duration="50:00" />);
  expect(screen.getByLabelText('跨2天').textContent).toBe('+2');
});

test('跨天：接受分钟数入参也能算对（D79）', () => {
  render(<JourneyTimes fromStation="广州" toStation="拉萨" startTime="20:00" arriveTime="22:00" durationMinutes={50 * 60} />);
  expect(screen.getByLabelText('跨2天').textContent).toBe('+2');
});

// ── D79：一条腿一行——车次压在轨道线上，历时在线下方 ──────
test('车次属于同一行程段，与发到时刻、站名同组（D79）', () => {
  render(
    <JourneyTimes
      trainCode="G547"
      fromStation="北京南"
      toStation="上海虹桥"
      startTime="06:18"
      arriveTime="12:11"
      duration="05:53"
    />,
  );
  const leg = screen.getByRole('group', { name: '行程时间' });
  expect(within(leg).getByText('G547')).toBeTruthy();
  expect(within(leg).getByText('06:18')).toBeTruthy();
  expect(within(leg).getByText('12:11')).toBeTruthy();
  expect(within(leg).getByText('北京南')).toBeTruthy();
  expect(within(leg).getByText('上海虹桥')).toBeTruthy();
  expect(within(leg).getByLabelText('历时').textContent).toBe('05:53');
});

test('车次压在轨道线上，与历时同处中列（D79）', () => {
  const { container } = render(
    <JourneyTimes trainCode="G547" fromStation="北京南" toStation="上海虹桥" startTime="06:18" arriveTime="12:11" duration="05:53" />,
  );
  const track = container.querySelector('.leg__trk');
  expect(track?.textContent).toContain('G547');
  expect(track?.textContent).toContain('05:53');
});

// ── D79：一程一行后，跨天要按「整条行程」累计，不能只看本程 ──
// 反例：北京 20:00 发 → 武汉 06:00 到（+1），武汉 07:00 发 → 广州 14:00 到。
// 第二程自身只跨 0 天，但它落在行程的第二天，必须仍标 +1。
test('第二程的跨天标识按整条行程累计（D79）', () => {
  render(
    <JourneyTimes
      trainCode="G2"
      fromStation="武汉"
      toStation="广州"
      startTime="07:00"
      arriveTime="14:00"
      duration="07:00"
      dayOffset={1}
    />,
  );
  expect(screen.getByLabelText('跨1天').textContent).toBe('+1');
});

test('显式 dayOffset 覆盖按本程历时算出的值（D79）', () => {
  render(
    <JourneyTimes fromStation="武汉" toStation="广州" startTime="07:00" arriveTime="14:00" duration="07:00" dayOffset={0} />,
  );
  expect(screen.queryByLabelText(/跨\d+天/)).toBeNull();
});
