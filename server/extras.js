/**
 * 鸿汇影 · 剩余功能服务端（一次接入，六个能力）
 *  1) 远程功能开关    features.flags() / features.set()         —— 云端下发 on/off，不必重装
 *  2) 升级遥测        telemetry.append() / telemetry.summary()   —— 谁升成功、谁卡住
 *  3) 儿童时段模式    kid.get() / kid.set() / kid.stateAt()      —— 按时间段锁定分组
 *  4) 双端接力        handoff.put() / handoff.take()             —— 桌面收藏推给开鸿设备
 *  5) 双指标选源      score.rank()                               —— 成功率 + 时延，选最好的一条
 *  6) 聚合搜索        search.run(q)                              —— 一个框搜遍全部条目与平台
 * 数据全部落 server/data 下，客户成品只读、开发端可写。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');       // 与 catalog.js / insights.js 同一数据目录
const FLAGS_FP = path.join(DATA, 'feature-flags.json');
const KID_FP = path.join(DATA, 'kid-mode.json');
const HANDOFF_FP = path.join(DATA, 'handoff.json');
const TEL_FP = path.join(DATA, 'update-telemetry.jsonl');
const CATALOG_FP = path.join(DATA, 'catalog.json');
const PLAY_FP = path.join(DATA, 'play.jsonl');

function readJson(fp, dft) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return dft; }
}
function writeJson(fp, obj) {
  try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, JSON.stringify(obj, null, 2)); return true; }
  catch (e) { return false; }
}
function rows(fp) {
  try {
    return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).map(function (l) {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { return []; }
}

/* ---------------- 1) 远程功能开关 ---------------- */
const FLAG_DEFAULT = {
  'stats-heat': true, 'fail-top': true, 'kid-mode': true,
  'handoff': true, 'search-all': true, 'source-rank': true, 'update-telemetry': true
};
const features = {
  all() {
    const f = readJson(FLAGS_FP, null) || { schema: 1, updatedAt: null, flags: {} };
    f.flags = Object.assign({}, FLAG_DEFAULT, f.flags || {});
    return f;
  },
  isOn(id) {
    const f = this.all();
    return f.flags[id] !== false;      // 默认开，只有显式 false 才关
  },
  set(id, enabled) {
    if (!id || typeof id !== 'string') return { ok: false, error: '缺少功能 id' };
    const f = this.all();
    if (enabled === null || enabled === undefined) delete f.flags[id];
    else f.flags[id] = !!enabled;
    f.schema = 1; f.updatedAt = new Date().toISOString();
    if (!writeJson(FLAGS_FP, f)) return { ok: false, error: '写入失败' };
    return { ok: true, id: id, enabled: enabled === null || enabled === undefined ? null : !!enabled, updatedAt: f.updatedAt };
  },
  apply(list) {
    const f = this.all();
    return (list || []).filter(function (x) { return x && x.id && f.flags[x.id] !== false; })
      .map(function (x) {
        const o = Object.assign({}, x);
        o.enabled = true;
        return o;
      });
  }
};

/* ---------------- 2) 升级遥测 ---------------- */
const telemetry = {
  append(evt) {
    const rec = {
      at: new Date().toISOString(),
      stage: String((evt && evt.stage) || 'unknown').slice(0, 24),   // check / download / install / fail / done
      versionName: String((evt && evt.versionName) || '').slice(0, 24),
      versionCode: Number((evt && evt.versionCode) || 0) || null,
      ok: evt && evt.ok !== false,
      error: String((evt && evt.error) || '').slice(0, 160),
      platform: String((evt && evt.platform) || '').slice(0, 16),
      deviceId: String((evt && evt.deviceId) || '').slice(0, 40)
    };
    try { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(TEL_FP, JSON.stringify(rec) + '\n'); }
    catch (e) { return { ok: false, error: '写入失败：' + e.message }; }
    return { ok: true, at: rec.at };
  },
  summary() {
    const all = rows(TEL_FP);
    const keep = all.slice(-2000);
    const byStage = {}, byVersion = {};
    let fail = 0;
    keep.forEach(function (r) {
      byStage[r.stage] = (byStage[r.stage] || 0) + 1;
      if (r.versionName) byVersion[r.versionName] = (byVersion[r.versionName] || 0) + 1;
      if (!r.ok) fail++;
    });
    return {
      ok: true, total: keep.length, failed: fail,
      byStage: byStage, byVersion: byVersion,
      last: keep.slice(-15).reverse()
    };
  }
};

/* ---------------- 3) 儿童时段模式 ---------------- */
const KID_DEFAULT = {
  schema: 1, enabled: false,
  window: { start: '21:00', end: '06:00' },     // 跨零点时间段
  pin: '',                                       // 4 位数字解锁码，空=不校验
  blockGroups: ['成人', '福利', '午夜'],
  updatedAt: null
};
function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
const kid = {
  get() { return Object.assign({}, KID_DEFAULT, readJson(KID_FP, {})); },
  set(cfg) {
    const cur = this.get();
    const next = Object.assign({}, cur, cfg || {});
    next.schema = 1; next.updatedAt = new Date().toISOString();
    if (!writeJson(KID_FP, next)) return { ok: false, error: '写入失败' };
    return { ok: true, config: next };
  },
  /* 现在是否处于「儿童时段」：enabled 且当前时间落在窗口内 */
  stateAt(now) {
    const c = this.get();
    const d = now ? new Date(now) : new Date();
    const cur = d.getHours() * 60 + d.getMinutes();
    const s = minutes(c.window && c.window.start), e = minutes(c.window && c.window.end);
    let inside = false;
    if (s !== null && e !== null) {
      inside = (s <= e) ? (cur >= s && cur < e) : (cur >= s || cur < e);   // 跨零点
    }
    return {
      ok: true, enabled: !!c.enabled, inside: !!c.enabled && inside,
      window: c.window, blockGroups: c.blockGroups || [], pinRequired: !!c.pin,
      now: d.toISOString(), local: d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
    };
  },
  /* 在线内容按分组过滤：儿童时段把 blockGroups 里的条目剔除 */
  filterItems(items, now) {
    const st = this.stateAt(now);
    if (!st.inside) return items;
    const block = (st.blockGroups || []).map(function (x) { return String(x).toLowerCase(); });
    if (!block.length) return items;
    return (items || []).filter(function (x) {
      const g = String((x && x.group) || '').toLowerCase();
      return block.indexOf(g) < 0;
    });
  }
};

/* ---------------- 4) 双端接力 ---------------- */
const HANDOFF_TTL = 10 * 60 * 1000;
const handoff = {
  put(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'payload 必须为对象' };
    const box = readJson(HANDOFF_FP, { schema: 1, codes: {} }) || { schema: 1, codes: {} };
    const codes = box.codes || {};
    const now = Date.now();
    Object.keys(codes).forEach(function (k) { if (now - (codes[k].at || 0) > HANDOFF_TTL) delete codes[k]; });
    let code = '';
    do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (codes[code]);
    codes[code] = { at: now, payload: payload };
    writeJson(HANDOFF_FP, { schema: 1, codes: codes });
    return { ok: true, code: code, expiresIn: Math.round(HANDOFF_TTL / 1000), count: Object.keys(codes).length };
  },
  take(code) {
    const box = readJson(HANDOFF_FP, { schema: 1, codes: {} }) || { schema: 1, codes: {} };
    const codes = box.codes || {};
    const rec = codes[String(code || '').trim()];
    if (!rec) return { ok: false, error: '接力码不存在或已过期' };
    if (Date.now() - (rec.at || 0) > HANDOFF_TTL) { delete codes[code]; writeJson(HANDOFF_FP, { schema: 1, codes: codes }); return { ok: false, error: '接力码已过期' }; }
    delete codes[code];      // 一次性
    writeJson(HANDOFF_FP, { schema: 1, codes: codes });
    return { ok: true, payload: rec.payload };
  }
};

/* ---------------- 5) 双指标选源 ---------------- */
const score = {
  rank(limit) {
    const cat = readJson(CATALOG_FP, { items: [] });
    const items = (cat && cat.items) || [];
    const out = [];
    items.forEach(function (it) {
      const list = (it.sources || []).map(function (s, i) {
        const ok = s.status === 'ok';
        const ms = Number(s.ms || 0);
        /* 成功率 60% + 时延 40%（时延越短越好，30 s 视为 0 分） */
        const okScore = ok ? 1 : 0;
        const speedScore = ok && ms > 0 ? Math.max(0, 1 - ms / 30000) : (ok ? 0.85 : 0);
        const v = Math.round((okScore * 0.6 + speedScore * 0.4) * 1000) / 10;   // 0-100
        return { index: i, label: s.label || ('线路 ' + (i + 1)), url: s.url, status: s.status, ms: ms, code: s.code || '', error: s.error || '', score: v };
      });
      list.sort(function (a, b) { return b.score - a.score; });
      const best = list[0] || null;
      out.push({
        id: it.id, name: it.name, group: it.group || '', count: list.length,
        usable: list.filter(function (x) { return x.status === 'ok'; }).length,
        best: best ? { label: best.label, score: best.score, ms: best.ms, status: best.status } : null,
        ranked: list.slice(0, 3)
      });
    });
    out.sort(function (a, b) { return (b.best ? b.best.score : -1) - (a.best ? a.best.score : -1); });
    const lim = Math.max(1, Math.min(300, Number(limit) || 40));
    return { ok: true, total: out.length, rows: out.slice(0, lim) };
  }
};

/* ---------------- 6) 聚合搜索 ---------------- */
function normalize(s) { return String(s || '').toLowerCase(); }
const search = {
  run(q, limit) {
    const kw = normalize(String(q || '').trim());
    if (kw.length < 1) return { ok: false, error: '请输入关键词' };
    const cat = readJson(CATALOG_FP, { items: [] });
    const items = (cat && cat.items) || [];
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    const hits = [];
    items.forEach(function (it) {
      const hay = normalize([it.name, it.group, it.region, it.type, (it.tags || []).join(' ')].join(' '));
      if (hay.indexOf(kw) < 0) return;
      const srcs = it.sources || [];
      const okSrcs = srcs.filter(function (s) { return s.status === 'ok'; });
      hits.push({
        kind: 'item', id: it.id, name: it.name, group: it.group || '', region: it.region || '',
        type: it.type || '', sources: srcs.length, usable: okSrcs.length,
        bestUrl: (okSrcs[0] && okSrcs[0].url) || (srcs[0] && srcs[0].url) || '',
        bestLabel: (okSrcs[0] && (okSrcs[0].label || '线路')) || ''
      });
    });
    hits.sort(function (a, b) { return b.usable - a.usable; });
    return { ok: true, query: kw, total: hits.length, rows: hits.slice(0, lim), truncated: hits.length > lim };
  }
};

module.exports = { features: features, telemetry: telemetry, kid: kid, handoff: handoff, score: score, search: search };
