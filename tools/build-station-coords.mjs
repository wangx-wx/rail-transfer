/**
 * 站点坐标产物生成器（T59）—— build-time 手动重跑，产物 checked in
 *
 * 用法：
 *   node tools/build-station-coords.mjs            # 续跑（只补缺失项）
 *   node tools/build-station-coords.mjs --all      # 忽略进度，全量重跑
 *
 * 数据来源：12306 微信小程序「车站地址」接口
 *   POST https://mobile.12306.cn/wxxcx/wechat/bigScreen/getStationAddress
 *   参数：stationCode=<站电报码> → { latitude, longitute, cityName, ... }
 *
 * ⚠️ 非官方小程序接口，仅本地手动运行。产物入库，runtime 零网络。
 *    节奏见 T59：3 并发 × 每路 1.0s；某路连续 3 次非 200 拉到 2s；
 *    连续 5 次非 200 全部停止并保存进度。
 * ⚠️ 断点续跑：进度写在 `.cache/station-coords-progress.json`（gitignore），
 *    重跑只补缺失项，不必从头再来。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://mobile.12306.cn/wxxcx/wechat/bigScreen/getStationAddress';

/** 并发路数与基础间隔（T59） */
const CONCURRENCY = 3;
const BASE_INTERVAL_MS = 1000;
const SLOW_INTERVAL_MS = 2000;
/** 某路连续失败达到此值 → 该路降速 */
const SLOW_AFTER = 3;
/** 全部停止阈值 */
const STOP_AFTER = 5;

const ROOT = new URL('..', import.meta.url);
const PROGRESS_FILE = fileURLToPath(new URL('.cache/station-coords-progress.json', ROOT));
const OUT_FILE = fileURLToPath(new URL('web/data/station-coords.ts', ROOT));

/** 读 web/data/stations.ts 的 STATION_NAMES 键（全部站码） */
function loadCodes() {
  const file = fileURLToPath(new URL('web/data/stations.ts', ROOT));
  const src = readFileSync(file, 'utf8');
  const m = /export const STATION_NAMES[^=]*=\s*(\{[\s\S]*?\});/.exec(src);
  if (!m) throw new Error('未能从 stations.ts 解析 STATION_NAMES');
  return Object.keys(JSON.parse(m[1]));
}

/** 读进度（站码 → [纬度, 经度]）；失败/缺失返回空 */
function loadProgress() {
  if (!existsSync(PROGRESS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveProgress(coords) {
  mkdirSync(fileURLToPath(new URL('.cache', ROOT)), { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(coords));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 查一个站的坐标；返回 [纬度, 经度] 或 null */
async function address(code) {
  const res = await fetch(`${API}?stationCode=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    },
  });
  if (res.status !== 200) return { failed: true };
  const j = await res.json();
  const d = j?.data;
  const lat = Number(d?.latitude);
  const lng = Number(d?.longitute);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return { failed: false, coord: null };
  return { failed: false, coord: [lat, lng] };
}

/** 跑一路：从自己的队列里按间隔取站 */
async function worker(id, queue, coords, stats) {
  let interval = BASE_INTERVAL_MS;
  let consecutive = 0;
  for (const code of queue) {
    if (stats.stop) break;
    let r;
    try {
      r = await address(code);
    } catch {
      r = { failed: true };
    }
    await sleep(interval);

    if (r.failed) {
      consecutive++;
      stats.consecutiveFail++;
      if (consecutive >= SLOW_AFTER) interval = SLOW_INTERVAL_MS;
      if (stats.consecutiveFail >= STOP_AFTER) {
        stats.stop = true;
        console.error(`⛔ 连续 ${STOP_AFTER} 次失败，停止（已保存进度）`);
        break;
      }
      continue;
    }
    consecutive = 0;
    stats.consecutiveFail = 0;
    interval = BASE_INTERVAL_MS;
    stats.done++;
    if (r.coord) {
      coords[code] = r.coord;
      stats.hit++;
    }
    if (stats.done % 50 === 0) {
      saveProgress(coords);
      console.log(`  路${id}：${stats.done}/${stats.total}，命中 ${stats.hit}（${((stats.hit / stats.done) * 100).toFixed(1)}%）`);
    }
  }
  // 每路结束时落盘，避免主进程异常丢失
  saveProgress(coords);
}

async function main() {
  const all = process.argv.includes('--all');
  const codes = loadCodes();
  const coords = all ? {} : loadProgress();
  const todo = codes.filter((c) => !coords[c]);
  console.log(`总站数 ${codes.length}，已有 ${Object.keys(coords).length}，待查 ${todo.length}`);

  const stats = { done: 0, hit: 0, total: todo.length, stop: false, consecutiveFail: 0 };
  // 轮转分配，让三路均匀覆盖（避免某一路全落在相邻站段上）
  const queues = Array.from({ length: CONCURRENCY }, (_, i) => todo.filter((_, j) => j % CONCURRENCY === i));
  await Promise.all(queues.map((q, i) => worker(i + 1, q, coords, stats)));
  saveProgress(coords);

  const out = Object.entries(coords).sort(([a], [b]) => a.localeCompare(b));
  const header = `/**
 * 站点坐标表（自动生成，勿手改）
 *
 * 生成：node tools/build-station-coords.mjs（build-time，手动重跑、可断点续跑）
 * 来源：12306 小程序「车站地址」接口（GCJ-02，与腾讯坐标系一致）
 * 覆盖：${out.length} / ${codes.length} 个站
 *
 * 用途：同城异站换乘接驳（D75 跨城判定、T60 编排）。见 spec/技术方案.md T59。
 * ⚠️ 与 coords.ts 的区别：那是**城市级**（同城只取首站），本表是**站点级**。
 */

`;
  writeFileSync(OUT_FILE, header + `export const STATION_COORDS: Record<string, [number, number]> = ${JSON.stringify(Object.fromEntries(out))};\n`);
  console.log(`✅ 已写入 ${OUT_FILE}（${out.length} 个站，命中率 ${((out.length / codes.length) * 100).toFixed(1)}%）`);
  if (stats.stop) console.log('⚠️ 上次运行被中断，重跑本脚本即可续补剩余站。');
}

main();
