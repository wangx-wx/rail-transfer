/**
 * 站点坐标表（自动生成，勿手改）
 *
 * 生成：node tools/build-station-coords.mjs（build-time，手动重跑、可断点续跑）
 * 来源：12306 小程序「车站地址」接口（GCJ-02，与腾讯坐标系一致）
 *
 * ⚠️ 本文件是全量产物的**占位**，正在由生成脚本补齐；重跑脚本会整体覆盖。
 *
 * 用途：同城异站换乘接驳（D75 跨城判定、T60 编排）。见 spec/技术方案.md T59。
 * ⚠️ 与 coords.ts 的区别：那是**城市级**（同城只取首站），本表是**站点级**。
 */

export const STATION_COORDS: Record<string, [number, number]> = {
  VNP: [39.86526, 116.378525],
  BXP: [39.894986, 116.321198],
};
