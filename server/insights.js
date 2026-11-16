'use strict';
/* 维护决策用的两组数据（只读，不改产物）：
   1) 收视热度：哪些频道 / 平台真的被点开、被起播、失败多少（来自 play.jsonl 埋点）
   2) 失效源 TOP：哪些线路实测失败、错在哪个错误码，同一条目里还有哪些可用备用线路
   两者都直接读现有巡检与埋点结果，不新增采集链路。 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
let catalog = null;
try { catalog = require('./catalog'); } catch (e) { catalog = null; }

function readJson(p, dft) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dft; }
}

function catalogDoc() {
  return readJson(path.join(DATA_DIR, 'catalog.json'), { items: [] }) || { items: [] };
}

function nameOf(items, id) {
  const it = items.find(function (x) { return x.id === id; });
  return it ? { name: it.name, type: it.type, group: it.group } : { name: null, type: null, group: null };
}

function heat(days) {
  const d = Number(days) || 7;
  const doc = catalogDoc();
  const items = doc.items || [];
  if (!catalog || typeof catalog.aggregatePlay !== 'function') {
    return { ok: false, error: '埋点模块不可用（play.jsonl 未初始化）' };
  }
  const a = catalog.aggregatePlay(d);
  const rows = Object.keys(a.byId).map(function (id) {
    const m = a.byId[id];
    const meta = nameOf(items, id);
    return {
      id: id, name: meta.name, type: m.type || meta.type, group: meta.group,
      opens: m.opens, starts: m.starts, fails: m.fails, samples: m.samples,
      failRate: m.failRate, avgLatency: m.avgLatency,
      topError: Object.keys(m.errors || {}).sort(function (x, y) { return m.errors[y] - m.errors[x]; })[0] || null,
      last: m.last
    };
  }).sort(function (x, y) { return (y.opens - x.opens) || (y.starts - x.starts); });
  const cold = items.filter(function (it) { return !a.byId[it.id]; });
  return {
    ok: true, days: d, at: new Date().toISOString(),
    totals: {
      events: a.total, touched: rows.length, untouched: cold.length,
      opens: rows.reduce(function (s, r) { return s + r.opens; }, 0),
      starts: rows.reduce(function (s, r) { return s + r.starts; }, 0),
      fails: rows.reduce(function (s, r) { return s + r.fails; }, 0)
    },
    rows: rows.slice(0, 30),
    cold: cold.slice(0, 20).map(function (it) { return { id: it.id, name: it.name, type: it.type, group: it.group }; })
  };
}

function failTop(limit) {
  const n = Number(limit) || 25;
  const doc = catalogDoc();
  const items = doc.items || [];
  const failures = [];
  const itemFails = {};
  for (const it of items) {
    for (const s of (it.sources || [])) {
      const bad = String(s.status || '').toLowerCase() !== 'ok';
      if (!bad) continue;
      failures.push({
        itemId: it.id, itemName: it.name, type: it.type, group: it.group,
        label: s.label || null, url: s.url || null,
        code: s.code || null, error: s.error || null, ms: s.ms || null, checkedAt: s.checkedAt || null
      });
      itemFails[it.id] = (itemFails[it.id] || 0) + 1;
    }
  }
  const byError = {};
  failures.forEach(function (f) { const k = String(f.error || f.code || 'unknown'); byError[k] = (byError[k] || 0) + 1; });
  const rows = failures.map(function (f) {
    const it = items.find(function (x) { return x.id === f.itemId; }) || { sources: [] };
    const alt = (it.sources || []).filter(function (s) {
      return String(s.status || '').toLowerCase() === 'ok' && s.url !== f.url;
    }).slice(0, 3).map(function (s) { return { label: s.label, url: s.url, ms: s.ms }; });
    return Object.assign({}, f, { alt: alt });
  }).sort(function (x, y) {
    const a = itemFails[y.itemId] - itemFails[x.itemId];
    return a !== 0 ? a : (Number(y.code || 0) - Number(x.code || 0));
  });
  return {
    ok: true, at: new Date().toISOString(),
    totals: {
      items: items.length,
      sources: items.reduce(function (s, it) { return s + (it.sources || []).length; }, 0),
      failed: failures.length,
      failedItems: Object.keys(itemFails).length
    },
    byError: byError,
    rows: rows.slice(0, n)
  };
}

module.exports = { heat, failTop };
