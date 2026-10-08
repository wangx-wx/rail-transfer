/**
 * 城市坐标表生成器（T40 走行方向过滤用）—— build-time 手动重跑，产物 checked in
 *
 * 用法：node tools/build-coords.mjs
 *
 * 数据来源：12306 小程序「车站地址」接口
 *   POST https://mobile.12306.cn/wxxcx/wechat/bigScreen/getStationAddress
 *   参数：stationCode=<站电报码> → { latitude, longitute, cityName, ... }
 *
 * ⚠️ 非官方小程序接口，仅本地手动低频运行；产物入库，runtime 零网络。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://mobile.12306.cn/wxxcx/wechat/bigScreen/getStationAddress';

/** 枢纽主站电报码（与 build-reachability.mjs 一致，城市代表站取具体主站） */
const CODES = [
  'VNP', 'AOH', 'IZQ', 'IOQ', 'TJP', 'CUW', 'ICW', 'HZH',
  'NJH', 'WHN', 'XAY', 'CSQ', 'ZZF', 'JNK', 'QDK', 'SYT',
  'DLT', 'HBB', 'CCT', 'SJP', 'TYV', 'HFH', 'FZS', 'XMS',
  'NCG', 'KMM', 'GIW', 'NNZ', 'LZJ', 'XNO', 'YIJ', 'WAR',
  'HHC', 'SZH', 'WXH', 'CZH', 'NGH', 'RZH',
  // 用户常见 OD 端（非枢纽）：保证方向过滤的起点/终点有坐标
  'GZQ', 'SNN', 'ZGE', 'LSO', 'YTM', 'QHX', 'MDB', 'FOC', 'WKK', 'YAK',
];

/** 读 station_name.js：电报码 → 城市名 */
function loadCityOf() {
  const file = fileURLToPath(new URL('../spike/station_name.js', import.meta.url));
  const raw = readFileSync(file, 'utf8');
  const rows = raw.slice(raw.indexOf('@')).split('@').filter(Boolean).map((r) => r.split('|'));
  const map = {};
  for (const r of rows) {
    const [, , code, , , , , city] = r;
    if (code && city) map[code] = city;
  }
  return map;
}

async function address(code) {
  const res = await fetch(`${API}?stationCode=${code}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return j.data ?? null;
}

async function main() {
  const cityOf = loadCityOf();
  /** 城市 → [经度, 纬度]（同城取第一个站点，差异可忽略） */
  const coords = {};
  for (const code of CODES) {
    let d;
    try {
      d = await address(code);
    } catch (e) {
      console.error(`⚠️  ${code} 失败：${e}`);
      continue;
    }
    if (!d || !d.latitude || !d.longitute) continue;
    const city = cityOf[code] ?? d.cityName ?? code;
    if (!coords[city]) coords[city] = [Number(d.longitute), Number(d.latitude)];
    await new Promise((r) => setTimeout(r, 250));
  }

  const outPath = fileURLToPath(new URL('../web/data/coords.ts', import.meta.url));
  const header = `/**
 * 城市坐标表（自动生成，勿手改）
 *
 * 生成：node tools/build-coords.mjs（build-time，手动重跑）
 * 来源：12306 小程序「车站地址」接口（GCJ-02）
 * 覆盖：${Object.keys(coords).length} 个城市
 *
 * 用途：T40 走行方向过滤（砍掉明显反方向的枢纽）。见 spec/技术方案.md T40。
 */

`;
  writeFileSync(outPath, header + `export const CITY_COORDS: Record<string, [number, number]> = ${JSON.stringify(coords)};\n`);
  console.log(`✅ 已写入 ${outPath}（${Object.keys(coords).length} 个城市）`);
}

main();
