/**
 * 城市 → 站点表生成器（T22）
 *
 * 用法：node tools/gen-stations.mjs [--out web/data/stations.js]
 *
 * 两个来源：
 *   1. spike/station_name.js —— 城市分组（字段 7 = 城市名），纯静态、零查询
 *   2. 12306 leftTicket 采样 —— 对主要城市用「远距离大站」做对端采样，
 *      按到发站频次取 Top-N，过滤市郊小站
 *
 * 产物 checked in，运行时零网络依赖。
 *
 * ⚠️ 局限（见 spec/技术方案.md §6.1）：主站随 OD 变化，本表只是
 * 「枢纽枚举的候选起点」，精确性交给下游换乘可行性筛选。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const KYFW = 'https://kyfw.12306.cn';

/** 主要城市（D18 约 40 城）。值为城市名，需与 station_name.js 字段 7 一致。 */
const MAJOR_CITIES = [
  '北京', '上海', '广州', '深圳', '天津', '重庆', '成都', '杭州',
  '南京', '武汉', '西安', '长沙', '郑州', '济南', '青岛', '沈阳',
  '大连', '哈尔滨', '长春', '石家庄', '太原', '合肥', '福州', '厦门',
  '南昌', '昆明', '贵阳', '南宁', '兰州', '西宁', '银川', '乌鲁木齐',
  '呼和浩特', '海口', '三亚', '苏州', '无锡', '常州', '宁波', '温州',
];

/** 对端采样站（远距离大站，覆盖面广） */
const PEERS = ['BJP', 'SHH', 'GZQ', 'WHN', 'XAY', 'CDW'];

/** 采样间隔（毫秒）—— 合规：个人低频，不制造突发流量 */
const SLEEP_MS = 120;

/** 每个城市保留的主站数上限 */
const TOP_N = 4;

// ── 1. 读 station_name.js，按城市分组 ────────────────────
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

// ── 2. 采样求主站排名 ────────────────────────────────────
const date = new Date(Date.now() + 8 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10);

async function getCookie() {
  const res = await fetch(`${KYFW}/otn/leftTicket/init`, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const list = res.headers.getSetCookie?.() || [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

/** 查一对 OD，返回终点侧到发站频次 */
async function sample(cookie, from, to) {
  const u = `${KYFW}/otn/leftTicket/queryG?leftTicketDTO.train_date=${date}` +
    `&leftTicketDTO.from_station=${from}&leftTicketDTO.to_station=${to}&purpose_codes=ADULT`;
  const res = await fetch(u, { headers: { 'User-Agent': UA, Cookie: cookie, Referer: `${KYFW}/otn/leftTicket/init` }, redirect: 'manual' });
  if (res.status !== 200) return {};
  const j = await res.json().catch(() => ({}));
  const counts = {};
  for (const row of j?.data?.result || []) {
    const code = row.split('|')[7]; // 到达站码
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

async function rankStations(cookie, cityName) {
  const stations = byCity.get(cityName) || [];
  if (!stations.length) return [];
  const codes = new Set(stations.map((s) => s.code));
  // 对端城市采样时，用该城市同名站作起点（如 北京→BJP）
  const fromCode = stations.find((s) => s.name === cityName)?.code || stations[0].code;
  const score = {};
  for (const peer of PEERS) {
    if (peer === fromCode) continue; // 跳过自身
    const counts = await sample(cookie, peer, fromCode);
    for (const [code, n] of Object.entries(counts)) {
      if (codes.has(code)) score[code] = (score[code] || 0) + n;
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
  return stations
    .map((s) => ({ ...s, score: score[s.code] || 0 }))
    .sort((a, b) => b.score - a.score);
}

// ── 3. 生成 ──────────────────────────────────────────────
const cookie = await getCookie();
/** @type {Record<string, {name:string, code:string, stations:string[]}>} */
const out = {};

for (const city of MAJOR_CITIES) {
  const stations = byCity.get(city);
  if (!stations) {
    console.error(`⚠️  未找到城市：${city}`);
    continue;
  }
  const ranked = await rankStations(cookie, city);
  // 代表站：优先同名站（如 北京=BJP），否则取排名第一
  const sameName = ranked.find((s) => s.name === city);
  const rep = sameName || ranked[0];
  const top = ranked.slice(0, TOP_N).filter((s) => s.score > 0);
  // 代表站必须在列表内
  const list = top.map((s) => s.code);
  if (rep && !list.includes(rep.code)) list.unshift(rep.code);

  out[city] = { code: rep?.code || '', name: city, stations: list };
  console.error(`${city.padEnd(4)} 代表站=${rep?.code} 主站=[${list.join(',')}]`);
}

// ── 4. 全城市 → 代表站（纯静态，无需采样）───────────────
// 任意城市都能查：优先同名站，否则取该城市第一个站
/** @type {Record<string,string>} */
const allCities = {};
for (const [city, stations] of byCity) {
  const same = stations.find((s) => s.name === city);
  allCities[city] = (same || stations[0]).code;
}

const header = `/**
 * 城市 → 站点表（自动生成，勿手改）
 *
 * 生成：node tools/gen-stations.mjs
 * 来源：spike/station_name.js（城市分组）+ 12306 leftTicket 采样（主站排名）
 * 生成日期：${new Date().toISOString().slice(0, 10)}
 *
 * CITY_STATIONS：${Object.keys(out).length} 个主要城市，含采样出的 Top-N 主站（D18）
 * ALL_CITIES：全部 ${Object.keys(allCities).length} 个城市 → 代表站码（兜底，保证任意城市可查）
 *
 * ⚠️ 主站随 OD 变化，本表只是枢纽枚举的候选起点（见 spec/技术方案.md §6.1）。
 */

`;

const body =
  `export const CITY_STATIONS = ${JSON.stringify(out, null, 2)};\n\n` +
  `export const ALL_CITIES = ${JSON.stringify(allCities, null, 0)};\n`;

const outPath = fileURLToPath(new URL('../web/data/stations.js', import.meta.url));
writeFileSync(outPath, header + body);
console.error(`\n✅ 已写入 ${outPath}（主要城市 ${Object.keys(out).length} + 全部城市 ${Object.keys(allCities).length}）`);
