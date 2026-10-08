/**
 * 自研取数适配层（T42）——把 api.ts + parse.ts 包成 `SelfBuiltDeps`
 *
 * 让自研编排（selfbuilt.ts）只依赖纯接口：真实运行时注入本适配层，
 * 单测注入假实现。Worker 零改动——复用既有 `/api/left-ticket` 与 `/api/stopover`。
 */

import * as api from './api.ts';
import type { ApiOpts } from './api.ts';
import { parseLeftTicket } from './parse.ts';
import type { SelfBuiltDeps, SelfBuiltParams } from './selfbuilt.ts';
import type { RawStopoverStation, Train } from '../../shared/types.ts';

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
      return parseLeftTicket(r.data).trains;
    },

    async stopsOf(train: Train): Promise<string[]> {
      const r = await api.stopover(
        {
          trainNo: train.trainNo,
          fromStationNo: train.fromStationNo,
          toStationNo: train.toStationNo,
          date: p.date,
        },
        apiOpts,
      );
      if (!r.ok) return [train.fromStation, train.toStation];
      const stops: RawStopoverStation[] = r.data.data?.data ?? [];
      if (!stops.length) return [train.fromStation, train.toStation];
      return stops.map((s) => s.station_name);
    },
  };
}
