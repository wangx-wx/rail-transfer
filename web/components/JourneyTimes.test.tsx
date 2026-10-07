import { expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import JourneyTimes from './JourneyTimes.tsx';

test('时刻表保留完整长站名与发到时刻，历时单独标识', () => {
  render(<JourneyTimes fromStation="上海浦东国际机场" toStation="呼和浩特东" startTime="23:50" arriveTime="07:15" duration="7时25分" />);
  const journey = screen.getByRole('group', { name: '行程时间' });
  expect(within(journey).getByText('上海浦东国际机场')).toBeTruthy();
  expect(within(journey).getByText('呼和浩特东')).toBeTruthy();
  expect(within(journey).getByText('23:50')).toBeTruthy();
  expect(within(journey).getByText('07:15')).toBeTruthy();
  expect(within(journey).getByLabelText('历时')).toHaveProperty('textContent', '7时25分');
});
