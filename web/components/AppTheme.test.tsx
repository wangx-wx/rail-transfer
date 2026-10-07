import { afterEach, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AppTheme from './AppTheme.tsx';

afterEach(() => vi.restoreAllMocks());

test('主题跟随系统切换，保留用户输入并移除监听', () => {
  let dark = false;
  const listeners = new Set<() => void>();
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
    get matches() { return dark; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }) as unknown as MediaQueryList);
  const { container, unmount } = render(<AppTheme><input aria-label="输入内容" /></AppTheme>);
  fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '北京' } });
  expect(container.querySelector('[data-theme]')?.getAttribute('data-theme')).toBe('light');
  act(() => { dark = true; listeners.forEach((listener) => listener()); });
  expect(container.querySelector('[data-theme]')?.getAttribute('data-theme')).toBe('dark');
  expect((screen.getByLabelText('输入内容') as HTMLInputElement).value).toBe('北京');
  unmount();
  expect(listeners.size).toBe(0);
});
