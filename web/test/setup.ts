/**
 * vitest 的 jsdom 环境补丁（web 组）
 *
 * jsdom 不实现若干浏览器 API，而 antd / rc-* 组件在渲染时依赖它们。
 * 缺任一项，组件测试会抛 `TypeError: xxx is not a function`。
 * 内容取自 antd 官方 vitest.setup，按本项目裁剪。
 */

import util from 'node:util';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

function fillWindowEnv(win: Window): void {
  const w = win as Writeable<Window> & typeof globalThis;

  // antd 的响应式断点（Grid 等）依赖 matchMedia，jsdom 完全没有
  if (!w.matchMedia) {
    Object.defineProperty(w, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: vi.fn(), // 旧 API，rc-* 可能调
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  // @rc-component/motion / css-animation 依赖
  w.AnimationEvent = w.AnimationEvent || (w.Event as unknown as typeof w.AnimationEvent);
  w.TransitionEvent = w.TransitionEvent || (w.Event as unknown as typeof w.TransitionEvent);

  // jsdom 缺 TextEncoder/Decoder
  Object.defineProperty(w, 'TextEncoder', { writable: true, value: util.TextEncoder });
  Object.defineProperty(w, 'TextDecoder', { writable: true, value: util.TextDecoder });

  // antd 的 wave / motion 会带伪元素调用 getComputedStyle，jsdom 返回不全
  const orig = w.getComputedStyle;
  w.getComputedStyle = ((elt: Element, pseudoElt?: string | null) => {
    if (pseudoElt) {
      const stub: Record<string, string> = {
        width: '0px',
        height: '0px',
        padding: '0px',
        margin: '0px',
        border: '0px',
        'background-color': 'transparent',
        color: 'rgb(0,0,0)',
        'font-size': '16px',
        'line-height': 'normal',
        display: 'block',
        position: 'static',
        overflow: 'visible',
        'overflow-x': 'visible',
        'overflow-y': 'visible',
      };
      return {
        getPropertyValue: (prop: string) => stub[prop] ?? '',
      } as unknown as CSSStyleDeclaration;
    }
    return orig.call(w, elt, pseudoElt);
  }) as typeof w.getComputedStyle;

  w.scrollTo = () => {};
}

if (typeof window !== 'undefined') fillWindowEnv(window);

// antd 动画 / 虚拟滚动用
globalThis.requestAnimationFrame =
  globalThis.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0) as unknown as number);
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));

// rc-resize-observer（Select / Collapse 等）硬依赖
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

// rc-select 打开下拉时调
if (globalThis.HTMLElement) globalThis.HTMLElement.prototype.scrollIntoView = () => {};

// 本项目 vitest 未开 globals，RTL 拿不到全局 afterEach，不会自动清理
afterEach(() => cleanup());
