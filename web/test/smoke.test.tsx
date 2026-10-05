/**
 * 冒烟测试：验证 jsdom + antd + setup 打通（步骤 1）
 *
 * 这个文件在组件写完后会被真实组件测试取代，先用来确认测试基建可用。
 */

import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from 'antd';

test('冒烟：antd Button 能在 jsdom 中渲染', () => {
  render(<Button type="primary">查直达</Button>);
  expect(screen.getByText('查直达')).toBeTruthy();
});
