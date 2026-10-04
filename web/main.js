/**
 * 前端入口 —— 串联表单、编排、渲染
 *
 * 查询流程（用户选定）：**直达与中转分开查**，各查各的，互不干扰。
 * 结果共用一个面板：点「查直达」显示直达，点「查中转」显示中转。
 * 零构建、原生 ESM：浏览器直接加载本文件。
 */

import { CITY_STATIONS, ALL_CITIES, STATION_NAMES } from './data/stations.js';
import { PRESALE_DAYS } from '../shared/constants.js';
import { API_BASE } from './config.js';
import * as api from './lib/api.js';
import { runQuery } from './lib/orchestrate.js';
import { parseLeftTicket, parseTransfer } from './lib/parse.js';
import { processPlans } from './lib/plans.js';
import { renderTrains, renderTransfers } from './lib/render.js';

const $ = (id) => document.getElementById(id);

/** 城市名 → {code, stations} */
function resolveCity(name) {
  const n = (name || '').trim();
  const major = CITY_STATIONS[n];
  if (major) return { code: major.code, stations: major.stations };
  const code = ALL_CITIES[n];
  return code ? { code, stations: [code] } : null;
}

/** 填充城市候选（datalist） */
function fillCities() {
  const names = [...new Set([...Object.keys(CITY_STATIONS), ...Object.keys(ALL_CITIES)])];
  $('cities').innerHTML = names.map((n) => `<option value="${n}"></option>`).join('');
}

/** 默认日期 = 今天 + 3 天 */
function defaultDate() {
  const t = new Date(Date.now() + 8 * 3600e3 + 3 * 86400e3);
  return t.toISOString().slice(0, 10);
}

/** 校验日期在预售期内（D32） */
function checkDate(date) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const max = new Date(Date.now() + 8 * 3600e3 + PRESALE_DAYS * 86400e3).toISOString().slice(0, 10);
  if (date < today) return '日期早于今天，无法查询';
  if (date > max) return `尚未开售：仅可查询 ${today} ~ ${max}`;
  return null;
}

/** 读取并校验表单，返回查询上下文或 null（已设置错误状态） */
function readForm() {
  const date = $('date').value;
  const err = checkDate(date);
  if (err) return setStatusErr(err);
  const from = resolveCity($('from').value);
  const to = resolveCity($('to').value);
  if (!from) return setStatusErr(`未识别的城市：${$('from').value}`);
  if (!to) return setStatusErr(`未识别的城市：${$('to').value}`);
  return {
    from,
    to,
    date,
    seat: $('seat').value,
    token: $('token').value.trim(),
  };
}

function setStatusErr(msg) {
  setStatus(msg, 'err');
  return null;
}

function setPanel(html) {
  $('panel').innerHTML = html;
}

let running = false;

/** 查直达 */
async function onDirect() {
  if (running) return;
  const ctx = readForm();
  if (!ctx) return;

  running = true;
  $('btn-direct').disabled = true;
  setPanel('<div class="empty">查询中…</div>');
  setStatus('正在查询直达…');

  try {
    const r = await api.leftTicket({ from: ctx.from.code, to: ctx.to.code, date: ctx.date }, { token: ctx.token, base: API_BASE });
    if (!r.ok) {
      setPanel(`<div class="empty err">直达查询失败：${r.error}</div>`);
      return setStatus(`直达查询失败：${r.error}`, 'err');
    }
    const { trains, stationMap } = parseLeftTicket(r.data);
    // 合并全量站名表（直达响应自带的 map 只覆盖少数站）
    const merged = { ...STATION_NAMES, ...stationMap };
    setPanel(renderTrains(trains, merged, ctx.seat));
    setStatus(`直达 ${trains.length} 趟`);
  } catch (e) {
    setPanel(`<div class="empty err">查询出错：${e}</div>`);
    setStatus(`查询出错：${e}`, 'err');
  } finally {
    running = false;
    $('btn-direct').disabled = false;
  }
}

/** 查中转 */
async function onTransfer() {
  if (running) return;
  const ctx = readForm();
  if (!ctx) return;

  running = true;
  $('btn-transfer').disabled = true;
  setPanel('<div class="empty">查询中…</div>');
  setStatus('正在查询官方基线…');

  const allPlans = [];
  const renderPanel = () => setPanel(renderTransfers(processPlans(allPlans)));

  try {
    await runQuery(
      { from: ctx.from.code, to: ctx.to.code, date: ctx.date, exclude: [...ctx.from.stations, ...ctx.to.stations] },
      {
        leftTicket: (p) => api.leftTicket(p, { token: ctx.token, base: API_BASE }),
        transfer: (p) => api.transfer(p, { token: ctx.token, base: API_BASE }),
      },
      {
        onDirect: () => {}, // 中转查询不展示直达
        onBaseline: (r) => {
          if (!r.ok) return setStatus('官方基线查询失败，改用内置枢纽兜底…', 'warn');
          for (const item of r.items) {
            if (item.ok && item.data) allPlans.push(...parseTransfer(item.data).plans);
          }
          renderPanel();
        },
        onSegment: (s) => {
          for (const item of s.items) {
            if (item.ok && item.data) allPlans.push(...parseTransfer(item.data).plans);
          }
          const failed = s.items.filter((i) => !i.ok);
          renderPanel();
          setStatus(
            `已查 ${s.index + 1}/${s.total} 段，累计 ${allPlans.length} 条方案` +
              (failed.length ? `（${failed.length} 个枢纽失败）` : ''),
            failed.length ? 'warn' : '',
          );
        },
        onDone: () => setStatus(`完成：中转 ${allPlans.length} 条方案`),
      },
    );
  } catch (e) {
    setStatus(`查询出错：${e}`, 'err');
  } finally {
    running = false;
    $('btn-transfer').disabled = false;
  }
}

function setStatus(text, cls = '') {
  const el = $('status');
  el.className = 'status ' + cls;
  el.textContent = text;
}

fillCities();
$('date').value = defaultDate();
$('btn-direct').addEventListener('click', onDirect);
$('btn-transfer').addEventListener('click', onTransfer);
