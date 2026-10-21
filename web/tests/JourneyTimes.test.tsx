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
