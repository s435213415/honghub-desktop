/**
 * 鸿汇影 · 远端配置中心（#69 远端默认值 / #70 灰度开关 / #71 锁定项 / #77 公告位 / #66 云同步中枢）
 * ------------------------------------------------------------------------------------------
 * 一份 JSON 管五件事，客户端只读、开发端可写：
 *   notice    首页公告位（可设有效期、级别、链接；客户端可关掉本次）
 *   locks     锁定键列表（命中的设置项在客户端只读并打锁标记，防误配）
 *   defaults  远端默认值（客户端只在「本机没设过」时应用，本机覆盖优先）
 *   flags     灰度开关（按设备哈希比例 + 版本区间求值，on=false 直接关）
 *   sync      偏好云同步槽（只同步偏好，服务端二次过滤源地址类字段）
 * 所有写入都 bump rev，客户端按 rev 判断要不要重渲染。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.KH_CFG_DATA || path.join(__dirname, 'data');   // 自测用 KH_CFG_DATA 指向临时目录，避免污染真配置
const FP = path.join(DATA, 'config-center.json');
const SYNC_FP = path.join(DATA, 'sync-store.json');

const DEFAULTS = {
  schema: 1,
  rev: 1,
  updatedAt: null,
  notice: { enabled: false, id: '', title: '', text: '', link: '', level: 'info', from: '', to: '', onboard: true },
  locks: [],
  defaults: {},
  flags: {},
  sync: { enabled: true }
};

function readJson(fp, dft) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return dft; }
}
function writeJson(fp, obj) {
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, fp);
    return true;
  } catch (e) { return false; }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function get() {
  const raw = readJson(FP, null);
  if (!raw || typeof raw !== 'object') return clone(DEFAULTS);
  return {
    schema: 1,
    rev: Number(raw.rev) || 1,
    updatedAt: raw.updatedAt || null,
    notice: Object.assign({}, DEFAULTS.notice, raw.notice || {}),
    locks: Array.isArray(raw.locks) ? raw.locks.filter((x) => typeof x === 'string' && x).slice(0, 200) : [],
    defaults: (raw.defaults && typeof raw.defaults === 'object' && !Array.isArray(raw.defaults)) ? raw.defaults : {},
    flags: (raw.flags && typeof raw.flags === 'object' && !Array.isArray(raw.flags)) ? raw.flags : {},
    sync: Object.assign({}, DEFAULTS.sync, raw.sync || {})
  };
}

function save(cfg) {
  cfg.schema = 1;
  cfg.rev = (Number(cfg.rev) || 1) + 1;
  cfg.updatedAt = new Date().toISOString();
  const ok = writeJson(FP, cfg);
  return ok ? { ok: true, rev: cfg.rev, updatedAt: cfg.updatedAt } : { ok: false, error: '写入失败' };
}

/* ---------------- 灰度求值 ---------------- */
function bucket(device, id) {
  const s = String(device || 'anon') + '|' + String(id || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % 100;
}

function verNum(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

function inVerRange(ver, min, max) {
  const n = verNum(ver);
  if (n == null) return true;               // 版本不明就不按版本卡，避免误关
  const lo = verNum(min), hi = verNum(max);
  if (lo != null && n < lo) return false;
  if (hi != null && n > hi) return false;
  return true;
}

function evalFlags(flags, ctx) {
  const out = {};
  const dev = (ctx && ctx.device) || 'anon';
  const ver = (ctx && ctx.version) || '';
  Object.keys(flags || {}).forEach(function (id) {
    const f = flags[id] || {};
    if (f.on === false) { out[id] = false; return; }
    if (f.on === null || f.on === undefined || f.on === true) {
      if (f.roll != null && Number(f.roll) < 100) {
        if (Number(f.roll) <= 0) { out[id] = false; return; }
        out[id] = bucket(dev, id) < Number(f.roll);
        if (!out[id]) return;
      }
      out[id] = inVerRange(ver, f.minVer, f.maxVer);
      return;
    }
    out[id] = true;
  });
  return out;
}

/* ---------------- 公告有效期 ---------------- */
function activeNotice(notice, now) {
  if (!notice || !notice.enabled) return null;
  const t = now || new Date();
  if (notice.from) {
    const f = Date.parse(notice.from);
    if (!isNaN(f) && t.getTime() < f) return null;
  }
  if (notice.to) {
    const e = Date.parse(notice.to);
    if (!isNaN(e) && t.getTime() > e) return null;
  }
  if (!String(notice.title || '').trim() && !String(notice.text || '').trim()) return null;
  return {
    id: String(notice.id || '') || ('n' + t.getTime()),
    title: String(notice.title || '').slice(0, 60),
    text: String(notice.text || '').slice(0, 400),
    link: String(notice.link || '').slice(0, 300),
    level: ['info', 'event', 'warn'].indexOf(notice.level) >= 0 ? notice.level : 'info',
    onboard: notice.onboard !== false
  };
}

/* ---------------- 客户端只读视图 ---------------- */
function view(ctx) {
  const cfg = get();
  return {
    ok: true,
    rev: cfg.rev,
    updatedAt: cfg.updatedAt,
    notice: activeNotice(cfg.notice),
    locks: cfg.locks,
    defaults: cfg.defaults,
    flags: evalFlags(cfg.flags, ctx || {}),
    flagsRaw: cfg.flags,
    sync: { enabled: cfg.sync.enabled !== false }
  };
}

/* ---------------- 写入（仅开发端） ---------------- */
function patch(p) {
  const cfg = get();
  if (p && typeof p.notice === 'object' && p.notice) {
    const n = Object.assign({}, cfg.notice, p.notice);
    n.enabled = n.enabled === true || n.enabled === 'true';
    cfg.notice = n;
  }
  if (p && Array.isArray(p.locks)) {
    cfg.locks = p.locks.filter((x) => typeof x === 'string' && x).slice(0, 200);
  }
  if (p && typeof p.defaults === 'object' && p.defaults && !Array.isArray(p.defaults)) {
    cfg.defaults = p.defaults;
  }
  if (p && typeof p.flags === 'object' && p.flags && !Array.isArray(p.flags)) {
    const nf = {};
    Object.keys(p.flags).forEach(function (id) {
      const v = p.flags[id];
      if (v == null) return;
      if (typeof v === 'boolean') { nf[id] = { on: v }; return; }
      if (typeof v === 'object') {
        const o = {};
        if (v.on !== undefined) o.on = v.on === null ? null : !!v.on;
        if (v.roll != null) o.roll = Math.max(0, Math.min(100, Number(v.roll) || 0));
        if (v.minVer) o.minVer = String(v.minVer).slice(0, 16);
        if (v.maxVer) o.maxVer = String(v.maxVer).slice(0, 16);
        if (v.note) o.note = String(v.note).slice(0, 120);
        nf[id] = o;
      }
    });
    cfg.flags = nf;
  }
  if (p && typeof p.sync === 'object' && p.sync) {
    cfg.sync = { enabled: p.sync.enabled !== false };
  }
  return save(cfg);
}

/* ---------------- #66 偏好云同步 ---------------- */
const SYNC_KEYS_ALLOW = /^(kh_[a-z0-9_]+)$/;          // 只认 kh_ 前缀的偏好键
const SYNC_BAN = /(url|site|src|link|addr|host|exe|path|dir|file|args|token|pass|pwd|pin|secret|key)/i; // 源地址 / 本机路径 / 凭证不上云

function syncStore() {
  const raw = readJson(SYNC_FP, null);
  if (!raw || typeof raw !== 'object') return { schema: 1, rev: 1, slots: {}, updatedAt: null };
  return { schema: 1, rev: Number(raw.rev) || 1, slots: raw.slots || {}, updatedAt: raw.updatedAt || null };
}

function sanitizePayload(payload) {
  const out = {};
  const src = (payload && typeof payload === 'object') ? payload : {};
  Object.keys(src).forEach(function (k) {
    if (!SYNC_KEYS_ALLOW.test(k)) return;
    if (SYNC_BAN.test(k.replace(/^kh_/, ''))) return;
    const v = src[k];
    if (v == null) return;
    if (typeof v === 'string' && /^http/i.test(v)) return;      // 地址串一律拦
    if (typeof v === 'object') {
      try {
        const j = JSON.stringify(v);
        if (j.length > 4096) return;
        if (/https?:\/\//.test(j)) return;
        out[k] = v;
      } catch (e) { return; }
    } else {
      out[k] = v;
    }
  });
  return out;
}

function syncPush(device, payload) {
  const d = String(device || '').slice(0, 64) || 'anon';
  const clean = sanitizePayload(payload);
  const keys = Object.keys(clean);
  if (!keys.length) return { ok: false, error: '没有可同步的偏好键（只同步 kh_ 前缀且不含地址/凭证）' };
  const s = syncStore();
  s.slots[d] = { rev: (Number(s.slots[d] && s.slots[d].rev) || 0) + 1, updatedAt: new Date().toISOString(), payload: clean };
  s.rev = (Number(s.rev) || 1) + 1;
  s.updatedAt = new Date().toISOString();
  const ok = writeJson(SYNC_FP, s);
  return ok ? { ok: true, rev: s.slots[d].rev, keys: keys.length, updatedAt: s.slots[d].updatedAt } : { ok: false, error: '写入失败' };
}

function syncPull(device) {
  const d = String(device || '').slice(0, 64);
  const s = syncStore();
  let best = null, bestDev = '';
  Object.keys(s.slots).forEach(function (k) {
    if (k === d) return;
    const it = s.slots[k];
    if (!it || !it.payload) return;
    if (!best) { best = it; bestDev = k; return; }
    const a = Date.parse(it.updatedAt) || 0, b = Date.parse(best.updatedAt) || 0;
    if (a > b) { best = it; bestDev = k; }
  });
  if (!best) return { ok: true, empty: true, payload: {}, from: '', updatedAt: null };
  return { ok: true, empty: false, payload: best.payload, from: bestDev, updatedAt: best.updatedAt };
}

function syncAll() {
  const s = syncStore();
  const peers = Object.keys(s.slots).map(function (k) {
    return { device: k, rev: s.slots[k].rev, updatedAt: s.slots[k].updatedAt, keys: Object.keys(s.slots[k].payload || {}).length };
  });
  return { ok: true, rev: s.rev, updatedAt: s.updatedAt, peers: peers };
}

/* ---------------- #72 存储载体：导出一致性清单 ---------------- */
function schemaInfo() {
  const cfg = get();
  const fp = path.join(__dirname, 'config-items.json');
  let items = 0;
  try { const j = JSON.parse(fs.readFileSync(fp, 'utf8')); items = Array.isArray(j) ? j.length : (j.items ? j.items.length : 0); } catch (e) {}
  const digest = crypto.createHash('sha256').update(JSON.stringify(cfg)).digest('hex').slice(0, 16);
  return {
    ok: true,
    carrier: 'client: localStorage（封条 + 双校验和） / 主进程: userData/kh-b8.json / 服务端: server/data/*.json',
    rev: cfg.rev,
    digest: digest,
    items: items,
    keys: {
      defaults: Object.keys(cfg.defaults || {}).length,
      locks: (cfg.locks || []).length,
      flags: Object.keys(cfg.flags || {}).length
    },
    note: '非加密强度：封条只防手改与半截写入，不防有意破解'
  };
}

module.exports = {
  get, patch, view, evalFlags, activeNotice, bucket, inVerRange,
  syncPush, syncPull, syncAll, sanitizePayload, schemaInfo, DEFAULTS
};
