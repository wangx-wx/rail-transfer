/**
 * 前端入口 —— 串联表单、编排、渲染
 *
 * 零构建、原生 ESM：浏览器直接加载本文件。
 */

import { CITY_STATIONS, ALL_CITIES } from './data/stations.js';
import { PRESALE_DAYS } from '../shared/constants.js';
import { API_BASE } from './config.js';
import * as api from './lib/api.js';
import { runQuery } from './lib/orchestrate.js';
import { parseLeftTicket, parseTransfer } from './lib/parse.js';
import { processPlans } from './lib/plans.js';
import { renderTrains, renderTransfers, filterByPeriod } from './lib/render.js';

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

let running = false;

async function onSubmit(e) {
  e.preventDefault();
  if (running) return;

  const fromName = $('from').value.trim();
  const toName = $('to').value.trim();
  const date = $('date').value;
  const seat = $('seat').value;
  const period = $('period').value;
  const token = $('token').value.trim();

  const err = checkDate(date);
  if (err) return setStatus(err, 'err');

  const from = resolveCity(fromName);
  const to = resolveCity(toName);
  if (!from) return setStatus(`未识别的城市：${fromName}`, 'err');
  if (!to) return setStatus(`未识别的城市：${toName}`, 'err');

  running = true;
  $('submit').disabled = true;
  $('panel-direct').innerHTML = '<div class="empty">查询中…</div>';
  $('panel-transfer').innerHTML = '<div class="empty">查询中…</div>';
  setStatus('正在查询直达…');

  /** 累积所有中转方案 */
  const allPlans = [];
  let stationMap = {};

  const renderTransferPanel = () => {
    const groups = processPlans(allPlans);
    $('panel-transfer').innerHTML = renderTransfers(groups);
  };

  try {
    await runQuery(
      { from: from.code, to: to.code, date, exclude: [...from.stations, ...to.stations] },
      {
        leftTicket: (p) => api.leftTicket(p, { token, base: API_BASE }),
        transfer: (p) => api.transfer(p, { token, base: API_BASE }),
      },
      {
        onDirect: (r) => {
          if (!r.ok) {
            $('panel-direct').innerHTML = `<div class="empty err">直达查询失败：${r.error}</div>`;
            return setStatus(`直达查询失败：${r.error}`, 'err');
          }
          const { trains, stationMap: sm } = parseLeftTicket(r.data);
          stationMap = sm;
          const filtered = filterByPeriod(trains, period);
          $('panel-direct').innerHTML = renderTrains(filtered, sm, seat);
          setStatus(`直达 ${filtered.length} 趟（共 ${trains.length}）`);
        },
        onBaseline: (r) => {
          if (!r.ok) return setStatus('官方基线查询失败，改用内置枢纽兜底…', 'warn');
          for (const item of r.items) {
            if (item.ok && item.data) allPlans.push(...parseTransfer(item.data).plans);
          }
          renderTransferPanel();
        },
        onSegment: (s) => {
          const ok = s.items.filter((i) => i.ok);
          for (const item of ok) {
            if (item.data) allPlans.push(...parseTransfer(item.data).plans);
          }
          const failed = s.items.filter((i) => !i.ok);
          renderTransferPanel();
          setStatus(
            `中转：已查 ${s.index + 1}/${s.total} 段，累计 ${allPlans.length} 条方案` +
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
    $('submit').disabled = false;
  }
}

function setStatus(text, cls = '') {
  const el = $('status');
  el.className = 'status ' + cls;
  el.textContent = text;
}

// ── 标签页切换（D27）────────────────────────────────────
function initTabs() {
  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.tabs button')) {
        b.setAttribute('aria-selected', String(b === btn));
      }
      document.getElementById('panel-direct').classList.toggle('active', btn.dataset.tab === 'direct');
      document.getElementById('panel-transfer').classList.toggle('active', btn.dataset.tab === 'transfer');
    });
  }
}

fillCities();
$('date').value = defaultDate();
$('form').addEventListener('submit', onSubmit);
initTabs();
