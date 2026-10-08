/**
 * 离线可达图生成器（T39）—— build-time 手动重跑，产物 checked in
 *
 * 用法：node tools/build-reachability.mjs [--out web/data/reachability.ts]
 *
 * 数据来源：12306 微信小程序「车站车次大屏」
 *   POST https://mobile.12306.cn/wxxcx/wechat/bigScreen/queryTrainByStation
 *   参数：train_start_date=YYYYMMDD & train_station_code=<电报码>
 *   返回：该站当日全部经停车次（含起终站电报码）
 *
 * ⚠️ 这是**非官方小程序接口**，只应在本地手动低频运行，用于生成稳定拓扑；
 *    不要放进 CI（违反 T41/D31 的低频合规边界）。产物入库，runtime 零网络。
 * ⚠️ 仅本地可跑（需网络）。无网络时保留既有产物不动。
 *
 * 环境变量 HUB_CODES：逗号分隔的枢纽电报码；默认取 web/lib/hubs.ts 的骨干城市代表站。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://mobile.12306.cn/wxxcx/wechat/bigScreen/queryTrainByStation';

/**
 * 默认枢纽电报码（T40 骨干城市主站）。
 *
 * ⚠️ 大屏接口吃**具体站电报码**，不吃城市聚合码：`CQW`（重庆）/`CDW`（成都）
 * 这类代表站码恒返回 0 趟，必须换成实际主站 `CUW`（重庆北）/`ICW`（成都东）。
 * 实测见下。
 */
const DEFAULT_CODES = [
  'VNP', 'AOH', 'IZQ', 'IOQ', 'TJP', 'CUW', 'ICW', 'HZH',
  'NJH', 'WHN', 'XAY', 'CSQ', 'ZZF', 'JNK', 'QDK', 'SYT',
  'DLT', 'HBB', 'CCT', 'SJP', 'TYV', 'HFH', 'FZS', 'XMS',
  'NCG', 'KMM', 'GIW', 'NNZ', 'LZJ', 'XNO', 'YIJ', 'WAR',
  'HHC', 'SZH', 'WXH', 'CZH', 'NGH', 'RZH',
];

/** 读 station_name.js，构造 电报码 → 城市名 */
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

/** 拉一个站当日全部车次 */
async function fetchStation(code, date, cookie) {
  const body = new URLSearchParams({ train_start_date: date, train_station_code: code });
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : fileURLToPath(new URL('../web/data/reachability.ts', import.meta.url));

  const codes = (process.env.HUB_CODES ?? DEFAULT_CODES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const date = process.env.REACH_DATE ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const cityOf = loadCityOf();
  const seen = new Set();
  const edges = [];

  for (const code of codes) {
    let rows;
    try {
      rows = await fetchStation(code, date, process.env.COOKIE);
    } catch (e) {
      console.error(`⚠️  ${code} 拉取失败：${e}`);
      continue;
    }
    for (const r of rows) {
      const a = r.start_station_telecode;
      const b = r.end_station_telecode;
      if (!a || !b) continue;
      const from = cityOf[a] ?? a;
      const to = cityOf[b] ?? b;
      if (from === to) continue;
      const key = `${from}>${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
    console.log(`✅ ${code}：${rows.length} 趟，累计 ${edges.length} 条边`);
    await new Promise((r) => setTimeout(r, 300)); // T41 间隔
  }

  const header = `/**
 * 离线可达图（自动生成，勿手改）
 *
 * 生成：node tools/build-reachability.mjs（build-time，手动重跑）
 * 来源：12306 小程序「车站车次大屏」，日期 ${date}，枢纽 ${codes.length} 个
 * 覆盖：${edges.length} 条「城市→城市」直达边
 *
 * ⚠️ 大屏只给车次起终站，不含中间经停，故边是可达性的**上界**（用于预筛足够安全）。
 * 见 spec/技术方案.md T39。
 */

`;

  writeFileSync(outPath, header + `export const REACHABILITY_EDGES = ${JSON.stringify(edges, null, 0)};\n`);
  console.log(`✅ 已写入 ${outPath}（${edges.length} 条边）`);
}

main();
