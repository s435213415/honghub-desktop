'use strict';
/* 源体检 + 补备源：找出单线路 / 慢速 / 受限频道，触发一次定向补源，并给每条频道挑出最快线路做优先项。 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const CATALOG = path.join(DATA, 'catalog.json');
const POOL = path.join(DATA, 'source-pool.json');
const HUNT_REPORT = path.join(DATA, 'source-hunt-report.json');
const BACKUPS = path.join(DATA, 'catalog-backups');

function readJson(f, def) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; }
}

function lines(it) {
  return Array.isArray(it.sources) ? it.sources : [];
}

function report() {
  const c = readJson(CATALOG, null);
  if (!c || !Array.isArray(c.items)) return { ok: false, error: '读取 catalog.json 失败' };
  const channels = c.items.filter(function (it) { return it.type === 'channel'; });
  const single = [], slow = [], noLine = [];
  channels.forEach(function (it) {
    const n = lines(it).length || Number(it.sourceCount || 0);
    const st = String(it.status || '');
    if (n === 0) noLine.push({ id: it.id, name: it.name, status: st });
    else if (n === 1) single.push({ id: it.id, name: it.name, status: st, ms: it.ms || null, group: it.group || '' });
    if (st === 'slow' || st === 'limited' || (it.ms && it.ms > 2500)) {
      slow.push({ id: it.id, name: it.name, status: st, ms: it.ms || null, lines: n });
    }
  });
  const pool = readJson(POOL, { items: [] });
  const hunt = readJson(HUNT_REPORT, null);
  const poolItems = pool.items || [];
  // 覆盖诊断：弱频道的名字在池里到底有没有同义候选，没有就是「池里根本没这个台」，补源必然为 0
  let hunter = null;
  try { hunter = require('./source-hunter'); } catch (e) {}
  let matched = 0;
  const coverage = single.slice(0, 20).map(function (x) {
    let n = 0;
    if (hunter && hunter.scoreWithAlias) {
      n = poolItems.filter(function (c) { return hunter.scoreWithAlias(x.name, c.name) > 0; }).length;
    }
    if (n > 0) matched++;
    return { id: x.id, name: x.name, candidates: n };
  });
  return {
    ok: true, at: new Date().toISOString(),
    totals: {
      channels: channels.length,
      single: single.length,
      slow: slow.length,
      noLine: noLine.length,
      pool: poolItems.length || (pool.total || 0),
      poolCovered: matched,
      poolChecked: coverage.length
    },
    coverage: coverage,
    lastHunt: hunt ? { at: hunt.at, added: (hunt.added || []).length, checked: hunt.checkedChannels || 0, note: hunt.note || '' } : null,
    single: single.slice(0, 60),
    slow: slow.slice(0, 60),
    noLine: noLine.slice(0, 60)
  };
}

async function hunt(limit) {
  const hunter = require('./source-hunter');
  const r = await hunter.hunt({ max: Number(limit) || 8, includeWeak: true });
  return {
    ok: true, at: new Date().toISOString(),
    added: (r && r.added) || [],
    missed: (r && r.missed) || [],
    checkedChannels: (r && r.checkedChannels) || 0,
    pool: r && r.pool ? r.pool.total : null,
    cached: !!(r && r.cached)
  };
}

/* 给每条频道指定优先线路：取状态 ok 且耗时最短的那条，写回 preferred 下标 */
function prioritize() {
  const c = readJson(CATALOG, null);
  if (!c || !Array.isArray(c.items)) return { ok: false, error: '读取 catalog.json 失败' };
  let changed = 0;
  c.items.forEach(function (it) {
    if (it.type !== 'channel') return;
    const srcs = lines(it);
    if (!srcs.length) return;
    let best = -1, bestMs = Infinity;
    srcs.forEach(function (s, i) {
      const st = String((s && s.status) || '');
      if (st && st !== 'ok') return;
      const ms = Number((s && s.ms) || 0) || 9999;
      if (ms < bestMs) { bestMs = ms; best = i; }
    });
    if (best < 0) return;
    if (Number(it.preferred || 0) !== best) { it.preferred = best; changed++; }
  });
  if (!changed) return { ok: true, changed: 0 };
  try {
    fs.mkdirSync(BACKUPS, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(CATALOG, path.join(BACKUPS, 'catalog-prefer-' + stamp + '.json'));
    c.generatedAt = new Date().toISOString();
    fs.writeFileSync(CATALOG, JSON.stringify(c, null, 2), 'utf8');
  } catch (e) { return { ok: false, error: '写回失败：' + (e && e.message) }; }
  return { ok: true, changed: changed };
}

module.exports = { report, hunt, prioritize };
