/**
 * 城市 → 站点表生成器（T22）—— 纯静态，零网络
 *
 * 用法：node tools/gen-stations.mjs
 *
 * 数据来源：
 *   1. spike/station_name.js —— 城市分组（字段 7 = 城市名），纯静态
 *   2. MAJOR_CITY_MAIN_STATIONS —— 主要城市主站清单（见下）
 *
 * ⚠️ 为什么不用联网采样：
 *   初版生成器曾对 12306 发约 200 次 leftTicket 采样（40 城 × 对端），
 *   结果**触发了 12306 风控**（后续请求全部 302 → error.html）。
 *   这违反 D31「个人低频」的合规边界，故改为纯静态。
 *   下方清单是一次性采样的**产物**，已固化；如需增补城市，手工维护。
 *
 * ⚠️ 局限（见 spec/技术方案.md §6.1）：主站随 OD 变化，本表只是
 *   「枢纽枚举的候选起点」，精确性交给下游换乘可行性筛选。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 主要城市 → 主站清单（含代表站，代表站排第一）。 */
const MAJOR_CITY_MAIN_STATIONS = {
  北京: ['BJP', 'VNP', 'BXP', 'FTP'],
  上海: ['SHH', 'AOH', 'SNH', 'IMH'],
  广州: ['GZQ', 'IZQ', 'GBA', 'GBQ'],
  深圳: ['SZQ', 'IOQ', 'NZQ', 'BJQ'],
  天津: ['TJP', 'TXP', 'TIP', 'WWP'],
  重庆: ['CQW', 'CUW', 'CXW', 'CYW'],
  成都: ['CDW', 'ICW', 'CMW', 'CNW'],
  杭州: ['HZH', 'HGH', 'HVU', 'XHH'],
  南京: ['NJH', 'NKH'],
  武汉: ['WHN', 'HKN', 'WCN', 'LFN'],
  西安: ['XAY', 'EAY', 'XDY', 'CAY'],
  长沙: ['CSQ', 'CWQ'],
  郑州: ['ZZF', 'ZAF', 'XPF', 'ZIF'],
  济南: ['JNK', 'JGK', 'MDK', 'JAK'],
  青岛: ['QDK', 'QHK', 'QUK', 'CEK'],
  沈阳: ['SYT', 'SBT', 'SOT'],
  大连: ['DLT', 'DFT'],
  哈尔滨: ['HBB', 'VAB', 'VBB'],
  长春: ['CCT', 'CRT'],
  石家庄: ['SJP', 'VVP', 'ZHP', 'GNP'],
  太原: ['TYV', 'TNV'],
  合肥: ['HFH', 'ENH', 'COH', 'HFU'],
  福州: ['FZS', 'FYS'],
  厦门: ['XMS', 'XKS'],
  南昌: ['NCG', 'NXG', 'NUG', 'HOG'],
  昆明: ['KMM', 'KOM'],
  贵阳: ['GIW', 'KQW', 'KEW', 'FVW'],
  南宁: ['NNZ', 'NFZ', 'NRZ'],
  兰州: ['LZJ', 'LAJ', 'ABJ', 'ZRJ'],
  西宁: ['XNO'],
  银川: ['YIJ', 'HFJ', 'UWJ', 'NOJ'],
  乌鲁木齐: ['WAR', 'WMR'],
  呼和浩特: ['HHC', 'NDC'],
  海口: ['VUQ'],
  三亚: ['SEQ'],
  苏州: ['SZH', 'OHH', 'ZAU', 'SMU'],
  无锡: ['WXH', 'WGH', 'KYH', 'IFH'],
  常州: ['CZH', 'ESH', 'JTU', 'WJU'],
  宁波: ['NGH'],
  温州: ['RZH', 'VRH', 'URH', 'NJU'],
};

// ── 读 station_name.js，按城市分组 ───────────────────────
const file = fileURLToPath(new URL('../spike/station_name.js', import.meta.url));
const raw = readFileSync(file, 'utf8');
const rows = raw
  .slice(raw.indexOf('@'))
  .split('@')
  .filter(Boolean)
  .map((r) => r.split('|'));

/** @type {Map<string, {name:string, code:string}[]>} */
const byCity = new Map();
for (const r of rows) {
  const [, name, code, , , , , city] = r;
  if (!city) continue;
  if (!byCity.has(city)) byCity.set(city, []);
  byCity.get(city).push({ name, code });
}

// ── 组装主要城市表 ───────────────────────────────────────
/** @type {Record<string, {code:string, name:string, stations:string[]}>} */
const CITY_STATIONS = {};
for (const [city, stations] of Object.entries(MAJOR_CITY_MAIN_STATIONS)) {
  if (!byCity.has(city)) {
    console.error(`⚠️  station_name.js 中未找到城市：${city}`);
    continue;
  }
  CITY_STATIONS[city] = { code: stations[0], name: city, stations };
}

// ── 全城市 → 代表站（纯静态兜底，保证任意城市可查）────────
/** @type {Record<string,string>} */
const ALL_CITIES = {};
for (const [city, stations] of byCity) {
  const same = stations.find((s) => s.name === city);
  ALL_CITIES[city] = (same || stations[0]).code;
}

const header = `/**
 * 城市 → 站点表（自动生成，勿手改）
 *
 * 生成：node tools/gen-stations.mjs（纯静态，零网络）
 * 来源：spike/station_name.js（城市分组）+ 固化主站清单
 * 生成日期：${new Date().toISOString().slice(0, 10)}
 *
 * CITY_STATIONS：${Object.keys(CITY_STATIONS).length} 个主要城市，含 Top-N 主站（D18）
 * ALL_CITIES：全部 ${Object.keys(ALL_CITIES).length} 个城市 → 代表站码（兜底，保证任意城市可查）
 *
 * ⚠️ 主站随 OD 变化，本表只是枢纽枚举的候选起点（见 spec/技术方案.md §6.1）。
 */

`;

const body =
  `export const CITY_STATIONS = ${JSON.stringify(CITY_STATIONS, null, 2)};\n\n` +
  `export const ALL_CITIES = ${JSON.stringify(ALL_CITIES, null, 0)};\n`;

const outPath = fileURLToPath(new URL('../web/data/stations.js', import.meta.url));
writeFileSync(outPath, header + body);
console.log(`✅ 已写入 ${outPath}（主要城市 ${Object.keys(CITY_STATIONS).length} + 全部城市 ${Object.keys(ALL_CITIES).length}）`);
