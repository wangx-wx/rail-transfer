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
      // 中转算法不读席别，走 lite 跳过 8 个席别对象构造（单次查询解析数万趟车）
      return parseLeftTicket(r.data, { lite: true }).trains;
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
      const all: RawStopoverStation[] = r.data.data?.data ?? [];
      if (!all.length) return [train.fromStation, train.toStation];
      // ⚠️ 经停接口返回的是**列车全程**（始发→终到），可能远宽于本次乘车段
      // （实测 K7731 全程「冠县→秦皇岛」，而我们坐的是「北京丰台(10)→天津(11)」）。
      // 必须按 station_no 裁到本次乘车段，否则回头看判定会把越界站（如天津之后的
      // 唐山/秦皇岛）当作「已过站」，导致几乎全部方案被误删（实测 19/20）。
      const from = Number(train.fromStationNo);
      const to = Number(train.toStationNo);
      const seg =
        Number.isFinite(from) && Number.isFinite(to)
          ? all.filter((s) => {
              const no = Number(s.station_no);
              return Number.isFinite(no) && no >= from && no <= to;
            })
          : all;
      const use = seg.length >= 2 ? seg : all;
      return use.map((s) => s.station_name);
    },
  };
}
