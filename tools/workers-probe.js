/**
 * Cloudflare Workers 探测脚本 —— 验证 Workers 能否访问 12306
 *
 * 目的：在投入开发前，确认三件事
 *   1. Workers 出口 IP 能否访问 12306（是否被风控）
 *   2. 余票接口的 cookie 流程在 Worker 环境是否可行
 *   3. 真实规模的枢纽枚举，子请求数距离 Free 版 50/次 的上限有多远
 *
 * 用法（部署后）：
 *   /                  基础探测（4 次子请求）
 *   /?full=1           完整枚举（34 次子请求，测上限压力）
 *   /?date=2026-10-08  指定日期（默认 = 北京时间 +3 天）
 *
 * 注意：日期必须落在 [今天, 今天+14] 内，越界会返回 302 → error.html
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const KYFW = 'https://kyfw.12306.cn';

/**
 * 子请求计数器。
 * ⚠️ 必须是 invocation 内的局部状态，不能放模块顶层：
 * Workers 会复用 isolate，模块级变量跨请求累积（实测踩到，数字翻倍）。
 * 用闭包把计数器绑定到本次 invocation。
 */
function makeCounter() {
  const state = { n: 0 };
  return {
    probe: async (url, headers = {}) => {
      state.n++;
      try {
        return await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'manual' });
      } catch (e) {
        return { error: String(e) };
      }
    },
    get count() { return state.n; },
  };
}

/** 默认日期 = 北京时间 +3 天 */
function defaultDate() {
  const t = new Date(Date.now() + 8 * 3600 * 1000 + 3 * 86400 * 1000);
  return t.toISOString().slice(0, 10);
}

/** 提取 Set-Cookie（优先标准 getSetCookie，回退合并头） */
function extractCookies(r) {
  if (typeof r.headers?.getSetCookie === 'function') {
    try { return r.headers.getSetCookie() || []; } catch { /* 回退 */ }
  }
  const sc = r.headers?.get?.('set-cookie');
  return sc ? [sc] : [];
}

/** 解析响应，返回 {n, err, note} */
async function parseJson(r, pick) {
  if (r.error) return { n: 0, err: 'fetch失败: ' + r.error };
  const loc = r.headers.get('location') || '';
  const text = await r.text();
  if (loc.includes('error.html')) return { n: 0, err: '被拦：302 → error.html（WAF 或越界）', loc };
  if (r.status !== 200) return { n: 0, err: `HTTP ${r.status}`, loc };
  try {
    const j = JSON.parse(text);
    const n = pick(j) || 0;
    const err = j.errorMsg || (n === 0 ? 'data 为空（status 仍为 true）' : '');
    return { n, err, note: text.slice(0, 80).replace(/\s+/g, ' ') };
  } catch {
    return { n: 0, err: '非 JSON', note: text.slice(0, 120).replace(/\s+/g, ' ') };
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const full = url.searchParams.get('full') === '1';
    const date = url.searchParams.get('date') || defaultDate();

    // 每次 invocation 独立的计数器（见 makeCounter 注释）
    const counter = makeCounter();
    const probe = counter.probe;

    const out = {
      _说明: 'subrequests 为【本次 invocation】的子请求数；Free 版上限 50/次',
      date,
      full,
      steps: [],
    };
    const log = (name, obj) => out.steps.push({ 步骤: name, ...obj });

    // ── 0. 出口 IP（用于对比是否被风控）──────────────────────
    const r0 = await probe('https://api.ipify.org?format=json');
    if (r0.error) log('0_出口IP', { error: r0.error });
    else {
      const t = await r0.text();
      log('0_出口IP', { ip: (JSON.parse(t).ip || t).slice(0, 40) });
    }

    // ── 1. init 拿 cookie ───────────────────────────────────
    const r1 = await probe(`${KYFW}/otn/leftTicket/init`);
    const setCookies = extractCookies(r1);
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    log('1_余票init', {
      status: r1.status ?? 'fetch失败',
      location: r1.headers?.get?.('location') || '',
      cookie数: setCookies.length,
      cookie摘要: cookie.slice(0, 70) || '(空)',
    });

    // ── 2. 余票查询（需 cookie）─────────────────────────────
    const ltUrl = `${KYFW}/otn/leftTicket/queryG?leftTicketDTO.train_date=${date}` +
      `&leftTicketDTO.from_station=BJP&leftTicketDTO.to_station=SHH&purpose_codes=ADULT`;
    const r2 = await probe(ltUrl, {
      Cookie: cookie,
      Referer: `${KYFW}/otn/leftTicket/init`,
    });
    const p2 = await parseJson(r2, (j) => j?.data?.result?.length);
    log('2_余票queryG', {
      status: r2.status ?? 'fetch失败',
      车次数: p2.n,
      错误: p2.err,
      ACAO: r2.headers?.get?.('access-control-allow-origin') ?? '(无)',
      片段: p2.note,
    });

    // ── 3. 官方中转（免 cookie）─────────────────────────────
    const lcUrl = `${KYFW}/lcquery/queryG?train_date=${date}` +
      `&from_station_telecode=LZJ&to_station_telecode=HZH&middle_station=&result_index=0` +
      `&can_query=Y&isShowWZ=N&purpose_codes=00&channel=E`;
    const r3 = await probe(lcUrl, { Referer: `${KYFW}/otn/lcQuery/init` });
    const p3 = await parseJson(r3, (j) => j?.data?.middleList?.length);
    log('3_中转lcquery', { status: r3.status ?? 'fetch失败', 方案数: p3.n, 错误: p3.err, 片段: p3.note });

    // ── 4. 完整枚举（测子请求上限压力）───────────────────────
    if (full) {
      const hubs = ['TIP', 'JGK', 'UUH', 'NKH', 'OHH', 'WGH', 'ESH', 'BMH', 'ENH', 'ZAF', 'SJP', 'HGH', 'WHN', 'QDK', 'TNV'];
      const froms = ['VNP', 'BXP']; // 模拟「城市内多站」：北京南 + 北京西
      const detail = [];
      for (const f of froms) {
        for (const h of hubs) {
          const u = `${KYFW}/lcquery/queryG?train_date=${date}` +
            `&from_station_telecode=${f}&to_station_telecode=SHH&middle_station=${h}` +
            `&result_index=0&can_query=Y&isShowWZ=N&purpose_codes=00&channel=E`;
          const r = await probe(u, { Referer: `${KYFW}/otn/lcQuery/init` });
          const p = await parseJson(r, (j) => j?.data?.middleList?.length);
          detail.push(`${f}/${h}: ${p.n}${p.err ? ' [' + p.err + ']' : ''}`);
        }
      }
      log('4_枢纽枚举', {
        组合数: froms.length * hubs.length,
        明细: detail,
        说明: '2 个出发站 × 15 枢纽 = 30 次；实际产品若按 2~4 站展开会更多',
      });
    }

    out.subrequests = counter.count;
    out.判定 = counter.count > 50
      ? `已超 Free 版 50/次上限（${counter.count} 次）——本次应已报错`
      : `未超上限（${counter.count}/50）`;

    return new Response(JSON.stringify(out, null, 2), {
      headers: { 'content-type': 'application/json;charset=utf-8' },
    });
  },
};
