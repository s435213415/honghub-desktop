/* 源健康度体检（支持断点续跑 / 分批）
   用法：
     node scripts/verify-sources.js                    # 全量跑，跑完为止（老行为）
     node scripts/verify-sources.js --chunk=300        # 本次最多实测 300 条，剩下留给下次
     node scripts/verify-sources.js --fresh            # 丢掉断点，从零重测
     node scripts/verify-sources.js --status           # 只看进度，不联网
   断点文件 server/data/sources-verify-state.json 记录候选表与已测结果；
   报告 server/data/sources-report.json 由「已测过的全部条目」汇总生成（含 partial 标记）。
   设计原则：只报事实。拿不到/超时一律记 不可播，绝不把「没测」写成「可用」。 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const POOL = path.join(ROOT, 'server/source-pool.json');
const PAGE = path.join(ROOT, 'app/index.html');
const OUT = path.join(ROOT, 'server/data/sources-report.json');
const STATE = path.join(ROOT, 'server/data/sources-verify-state.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const ARG = process.argv.slice(2);
const has = (f) => ARG.some((a) => a === f || a.startsWith(f + '='));
const val = (f, d) => {
  const hit = ARG.find((a) => a.startsWith(f + '='));
  return hit ? Number(hit.split('=')[1]) : d;
};
const CHUNK = val('--chunk', 0);
const FRESH = has('--fresh');
const STATUS = has('--status');

function get(url, timeoutMs, redirect) {
  redirect = redirect || 0;
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get({
      protocol: u.protocol, hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search, headers: { 'User-Agent': UA, 'Accept': '*/*' },
      timeout: timeoutMs, rejectUnauthorized: false
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirect < 3) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return get(next, timeoutMs, redirect + 1).then(resolve, reject);
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; if (buf.length > 4e6) res.destroy(); });
      res.on('end', () => resolve({ code: res.statusCode, body: buf }));
      res.on('error', () => resolve({ code: res.statusCode, body: buf }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// 探测一条流：m3u8 看到 #EXTM3U 即可，直链看首字节有响应
function probe(url, timeoutMs) {
  return get(url, timeoutMs).then((r) => {
    if (r.code !== 200) return { ok: false, why: 'HTTP ' + r.code };
    const b = r.body || '';
    if (/\.m3u8($|\?)/i.test(url) || b.startsWith('#EXTM3U')) {
      return /#EXTM3U/.test(b.slice(0, 2000)) ? { ok: true, why: 'm3u8' } : { ok: false, why: '非 m3u8' };
    }
    return b.length > 0 ? { ok: true, why: '直链' } : { ok: false, why: '空响应' };
  }).catch((e) => ({ ok: false, why: e.message }));
}

// 带硬超时的探测：某些源会把 TCP 挂住，光靠 socket timeout 不可靠，
// 这里再套一层 Promise.race，保证每一条最多占用 tMs+2500ms 就一定出结果。
function probeHard(url, timeoutMs) {
  return Promise.race([
    probe(url, timeoutMs),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, why: '硬超时' }), timeoutMs + 2500))
  ]);
}

function parseM3U(body) {
  const out = [];
  const lines = body.split(/\r?\n/);
  let name = '';
  for (const ln of lines) {
    const t = ln.trim();
    if (t.startsWith('#EXTINF')) {
      const c = t.split(',');
      name = (c.length > 1 ? c[c.length - 1] : '').trim();
    } else if (t && !t.startsWith('#')) {
      if (/^http/.test(t)) out.push({ name: name || t, url: t });
      name = '';
    }
  }
  return out;
}

function coverage() {
  try {
    const page = fs.readFileSync(PAGE, 'utf8');
    const m = page.match(/var LIVE_CHANNELS = \[[\s\S]*?\n\];/);
    if (!m) return null;
    const chans = m[0];
    const ids = (chans.match(/\{id:"[^"]+"/g) || []).length;
    const multi = (chans.match(/备用线路/g) || []).length;
    return { channels: ids, backupLines: multi, channelsWithBackup: multi };
  } catch (e) { return null; }
}

function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }
function writeJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 1));
}

function poolHash(pool) { return crypto.createHash('sha256').update(JSON.stringify(pool)).digest('hex').slice(0, 16); }

/* 断点状态：{schema, poolHash, at, lists, candidates:[{name,url}], tested:[{name,url,ok,why}]} */
function loadState(h) {
  if (FRESH) return null;
  const s = readJson(STATE, null);
  if (!s || s.schema !== 2 || s.poolHash !== h) return null;
  return s;
}

function buildReport(st, partial) {
  const tested = st.tested || [];
  const ok = tested.filter((r) => r.ok);
  const rep = {
    schema: 2,
    at: new Date().toISOString(),
    partial: !!partial,
    lists: st.lists,
    totals: {
      candidates: (st.candidates || []).length,
      tested: tested.length,
      ok: ok.length,
      bad: tested.length - ok.length,
      pending: Math.max(0, (st.candidates || []).length - tested.length)
    },
    coverage: coverage(),
    ok: ok,
    bad: tested.filter((r) => !r.ok).map((r) => ({ name: r.name, url: r.url, why: r.why }))
  };
  writeJson(OUT, rep);
  return rep;
}

(async function main() {
  const pool = JSON.parse(fs.readFileSync(POOL, 'utf8'));
  const tMs = pool.probe.timeoutMs || 6000;
  const threads = pool.probe.threads || 24;
  const ban = (pool.ban || []).map((s) => s.toLowerCase());
  const h = poolHash(pool);

  if (STATUS) {
    const st = loadState(h);
    if (!st) { console.log('  断点：无（或清单已变，下次会重建候选表）'); process.exit(0); }
    const t = (st.tested || []).length;
    const c = (st.candidates || []).length;
    console.log('  断点：候选 ' + c + ' · 已测 ' + t + ' · 剩余 ' + Math.max(0, c - t) +
      ' · 更新 ' + st.at + (st.poolHash === h ? '' : '（清单已变）'));
    const rep = readJson(OUT, null);
    if (rep && rep.totals) console.log('  报告：可用 ' + rep.totals.ok + ' / 已测 ' + rep.totals.tested + ' / 待测 ' + (rep.totals.pending || 0));
    process.exit(0);
  }

  let st = loadState(h);
  if (st) {
    console.log('  续跑：候选 ' + st.candidates.length + ' · 已测 ' + st.tested.length +
      ' · 剩余 ' + (st.candidates.length - st.tested.length));
  } else {
    const src = [];
    const cands = [];
    for (const url of pool.lists || []) {
      try {
        const r = await get(url, 12000);
        if (r.code !== 200) { src.push({ url, ok: false, why: 'HTTP ' + r.code, n: 0 }); console.log('  表 ' + url + ' → HTTP ' + r.code); continue; }
        const list = parseM3U(r.body);
        src.push({ url, ok: true, n: list.length });
        for (const it of list) if (!ban.some((b) => it.name.toLowerCase().includes(b))) cands.push(it);
        console.log('  表 ' + url + ' → ' + list.length + ' 条');
      } catch (e) {
        src.push({ url, ok: false, why: e.message, n: 0 });
        console.log('  表 ' + url + ' → 失败 ' + e.message);
      }
    }
    const uniq = [];
    const seen = new Set();
    for (const c of cands) if (!seen.has(c.url)) { seen.add(c.url); uniq.push({ name: c.name, url: c.url }); }
    st = { schema: 2, poolHash: h, at: new Date().toISOString(), lists: src, candidates: uniq, tested: [] };
    writeJson(STATE, st);
    console.log('  新候选 ' + uniq.length + ' 条（去重后）');
  }

  const done = new Set(st.tested.map((r) => r.url));
  const todo = st.candidates.filter((c) => !done.has(c.url));
  const take = CHUNK > 0 ? todo.slice(0, CHUNK) : todo;
  if (!take.length) {
    const rep = buildReport(st, false);
    console.log('\n=== 已全部测完 ===');
    console.log('  候选 ' + rep.totals.candidates + ' · 可用 ' + rep.totals.ok + ' · 不可用 ' + rep.totals.bad);
    console.log('  报告 → ' + OUT);
    process.exit(0);
  }
  console.log('  本轮实测 ' + take.length + ' 条（' + threads + ' 线程，共剩余 ' + todo.length + '）…');

  let i = 0;
  let sinceSave = 0;
  let stopped = false;
  // 整轮截止：到点就停止领新条目、保存、出报告，避免一次跑太久又被外部掐断
  const DEADLINE = Date.now() + val('--deadline', 240) * 1000;
  function save(partial) {
    st.at = new Date().toISOString();
    writeJson(STATE, st);
    buildReport(st, partial);
    sinceSave = 0;
  }
  async function worker() {
    while (i < take.length && !stopped) {
      if (Date.now() > DEADLINE) { stopped = true; break; }
      const c = take[i++];
      const r = await probeHard(c.url, tMs);
      st.tested.push({ name: c.name, url: c.url, ok: r.ok, why: r.why });
      sinceSave++;
      if (sinceSave >= 25) {
        const okN = st.tested.filter((x) => x.ok).length;
        console.log('    进度 本次 ' + st.tested.length + '/' + st.candidates.length + ' · 累计可用 ' + okN);
        save(true);          // 增量落盘：被打断也不丢进度
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(threads, take.length) }, worker));
  save(todo.length > take.length);

  const rep = readJson(OUT, null);
  const sha = crypto.createHash('sha256').update(JSON.stringify(rep.ok)).digest('hex').slice(0, 12);
  console.log('\n=== 源健康度体检' + (rep.partial ? '（本轮部分完成）' : '完成') + ' ===');
  console.log('  候选 ' + rep.totals.candidates + ' · 已测 ' + rep.totals.tested +
    ' · 可用 ' + rep.totals.ok + ' · 不可用 ' + rep.totals.bad + ' · 待测 ' + rep.totals.pending + ' · 指纹 ' + sha);
  if (rep.coverage) console.log('  在册频道 ' + rep.coverage.channels + ' · 备用线路 ' + rep.coverage.backupLines + ' 条');
  console.log('  报告 → ' + OUT);
  if (rep.totals.pending > 0) console.log('  还有 ' + rep.totals.pending + ' 条没测，下次继续：node scripts/verify-sources.js --chunk=300');
})();
