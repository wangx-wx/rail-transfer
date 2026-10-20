/**
 * 站点坐标读取（T59：组件不直接 import 产物）
 *
 * 产物 `web/data/station-coords.ts` 体积大，故**动态 import**，只在真正要查接驳时
 * 才加载，不增加主包体积。本模块把「异步加载 + 缺站返回 undefined」收敛在一处，
 * 让「缺坐标」分支可被单测覆盖（不依赖真实产物内容）。
 */

import type { LatLng } from './connection.ts';

/** 坐标表原始形态：站码 → [纬度, 经度]（产物里是数组，省体积） */
export type CoordTable = Record<string, [number, number] | undefined>;

/** 加载器：返回坐标表；生产实现是动态 import 产物 */
export type CoordLoader = () => Promise<CoordTable>;

/** 一个可查询的坐标源 */
export interface CoordSource {
  /** 站码 → 坐标；缺失返回 undefined */
  of(code: string): Promise<LatLng | undefined>;
}

/**
 * 创建一个坐标源（惰性加载 + 进程内缓存）。
 *
 * 加载失败（产物缺失 / 网络中断）不抛错，按「全部缺坐标」处理——
 * 接驳区降级为「未获取到站点位置」，不至于让整页崩掉（D74）。
 */
export function createCoordSource(load: CoordLoader): CoordSource {
  let table: Promise<CoordTable> | null = null;

  const ensure = (): Promise<CoordTable> => {
    table ??= load().catch(() => ({}));
    return table;
  };

  return {
    async of(code: string) {
      if (!code) return undefined;
      const t = await ensure();
      const v = t[code];
      return v ? toLatLng(v) : undefined;
    },
  };
}

/** 产物里的 `[纬度, 经度]` → 领域坐标 */
export function toLatLng(v: [number, number]): LatLng {
  return { lat: v[0], lng: v[1] };
}
