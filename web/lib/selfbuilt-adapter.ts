/**
 * 自研取数适配层（T42）——把 api.ts + parse.ts 包成 `SelfBuiltDeps`
 *
 * 让自研编排（selfbuilt.ts）只依赖纯接口：真实运行时注入本适配层，
 * 单测注入假实现。Worker 零改动——复用既有 `/api/left-ticket`。
 *
 * ⚠️ **2026-10-15（T56）**：`stopsOf`（经停补查）已移除——见 selfbuilt.ts 顶部说明。
 */

import * as api from './api.ts';
import type { ApiOpts } from './api.ts';
import { parseLeftTicket } from './parse.ts';
import type { SelfBuiltDeps, SelfBuiltParams } from './selfbuilt.ts';
import type { Train } from '../../shared/types.ts';

/** 适配层可注入依赖 */
export interface AdapterOptions {
  token?: string;
  base?: string;
  fetchImpl?: typeof globalThis.fetch;
}

/** 创建自研取数适配层 */
export function createSelfBuiltDeps(p: SelfBuiltParams, opts: AdapterOptions = {}): SelfBuiltDeps {
  const apiOpts: ApiOpts = {};
  if (opts.token) apiOpts.token = opts.token;
  if (opts.base !== undefined) apiOpts.base = opts.base;
  if (opts.fetchImpl) apiOpts.fetchImpl = opts.fetchImpl;

  return {
    async directTrains(from, to): Promise<Train[]> {
      const r = await api.leftTicket({ from, to, date: p.date }, apiOpts);
      if (!r.ok) return [];
      // D77：卡片要展示每程余票，必须走完整解析。实测单次查询最多 55 趟车、
      // 自研一次约 1650 趟，构造席别对象为毫秒级，不值得为此加懒加载。
      return parseLeftTicket(r.data).trains;
    },
  };
}
