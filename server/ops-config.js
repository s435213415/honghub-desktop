/**
 * 鸿汇影 · 运维可配置项（白名单 / 推荐位 / 更新通道）
 * --------------------------------------------------------------
 *  1) 接口来源白名单 origins  —— 在回环之外，额外放行指定来源网页读写本地中枢
 *  2) 首页推荐位 promo        —— 云端可配标题/副标题/条目；未配置时客户端回退内置公开片
 *  3) 更新通道 channel        —— 稳定 / 内测两套通道标记；内测未配置版本时如实回退稳定
 *
 * 数据全部落 server/data 下；客户成品只读这些接口，写操作只在开发端模式开放。
 * 口径诚实：配置缺失/未命中时回退默认，不编造内测包、不伪造推荐条目。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const ORIGIN_FP = path.join(DATA, 'allow-origins.json');
const PROMO_FP = path.join(DATA, 'promo-config.json');
const CHANNEL_FP = path.join(DATA, 'update-channel.json');

function readJson(fp, dft) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return dft; }
}
function writeJson(fp, obj) {
  try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n'); return true; }
  catch (e) { return false; }
}
function now() { return new Date().toISOString(); }
function clip(s, n) { return String(s === undefined || s === null ? '' : s).slice(0, n); }

/* ---------------- 1) 来源域名白名单 ---------------- */
const LOOP_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function originHost(origin) {
  try { return new URL(String(origin || '')).hostname.toLowerCase(); } catch (e) { return ''; }
}
/* 条目规范化：去尾斜杠；只保留 scheme://host[:port] */
function normalizeOrigin(entry) {
  let s = clip(entry, 300).trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    return u.protocol + '//' + u.host.toLowerCase();
  } catch (e) { return ''; }
}
function hostMatch(pattern, host) {
  if (!pattern || !host) return false;
  if (pattern === host) return true;
  if (pattern.indexOf('*.') === 0) {
    const base = pattern.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return false;
}

const origins = {
  list() {
    const o = readJson(ORIGIN_FP, { schema: 1, origins: [] });
    return { ok: true, origins: Array.isArray(o.origins) ? o.origins : [], updatedAt: o.updatedAt || null };
  },
  add(entry) {
    const norm = normalizeOrigin(entry);
    if (!norm) return { ok: false, error: '来源格式无效，需为 http://host 或 http://host:port' };
    const o = readJson(ORIGIN_FP, { schema: 1, origins: [] });
    o.origins = Array.isArray(o.origins) ? o.origins : [];
    if (!o.origins.some(function (x) { return normalizeOrigin(x) === norm; })) o.origins.push(norm);
    o.updatedAt = now();
    if (!writeJson(ORIGIN_FP, o)) return { ok: false, error: '写入失败' };
    return { ok: true, origins: o.origins };
  },
  remove(entry) {
    const norm = normalizeOrigin(entry);
    const o = readJson(ORIGIN_FP, { schema: 1, origins: [] });
    o.origins = (Array.isArray(o.origins) ? o.origins : []).filter(function (x) { return normalizeOrigin(x) !== norm; });
    o.updatedAt = now();
    writeJson(ORIGIN_FP, o);
    return { ok: true, origins: o.origins };
  },
  /* 回环始终放行；其余来源需命中白名单（整串 origin 或 host 后缀）。 */
  isAllowed(origin) {
    if (LOOP_RE.test(String(origin || ''))) return true;
    const host = originHost(origin);
    if (!host) return false;
    const o = readJson(ORIGIN_FP, { origins: [] });
    return (Array.isArray(o.origins) ? o.origins : []).some(function (pat) {
      const p = String(pat || '');
      if (/^https?:\/\//i.test(p)) return normalizeOrigin(p) === normalizeOrigin(origin);
      return hostMatch(p.toLowerCase(), host);
    });
  }
};

/* ---------------- 2) 首页推荐位云端配置 ---------------- */
const PROMO_DEFAULT = { schema: 1, enabled: false, updatedAt: null, title: '', subtitle: '', items: [] };

function cleanPromoItem(it) {
  if (!it || typeof it !== 'object') return null;
  const id = clip(it.id, 60);
  const title = clip(it.title, 80);
  if (!title) return null;
  return {
    id: id,
    title: title,
    subtitle: clip(it.subtitle, 120),
    desc: clip(it.desc, 200),
    tag: clip(it.tag, 20),
    color: clip(it.color, 16),
    accent: clip(it.accent, 16)
  };
}

const promo = {
  get() {
    const o = readJson(PROMO_FP, null);
    if (!o || typeof o !== 'object') {
      return { ok: true, enabled: false, title: '', subtitle: '', items: [], updatedAt: null, note: '未配置云端推荐位，客户端回退内置公开授权片' };
    }
    const items = Array.isArray(o.items) ? o.items.map(cleanPromoItem).filter(Boolean).slice(0, 12) : [];
    return {
      ok: true,
      enabled: !!o.enabled && items.length > 0,
      title: clip(o.title, 80),
      subtitle: clip(o.subtitle, 120),
      items: items,
      updatedAt: o.updatedAt || null,
      note: (!o.enabled || !items.length) ? '未配置云端推荐位，客户端回退内置公开授权片' : ''
    };
  },
  set(cfg) {
    cfg = cfg || {};
    const items = (Array.isArray(cfg.items) ? cfg.items : []).map(cleanPromoItem).filter(Boolean).slice(0, 12);
    const next = {
      schema: 1,
      enabled: !!cfg.enabled,
      title: clip(cfg.title, 80),
      subtitle: clip(cfg.subtitle, 120),
      items: items,
      updatedAt: now()
    };
    if (!writeJson(PROMO_FP, next)) return { ok: false, error: '写入失败' };
    return { ok: true, promo: this.get() };
  }
};

/* ---------------- 3) 更新通道（稳定 / 内测） ---------------- */
const CHANNELS = {
  stable: { id: 'stable', name: '稳定通道', note: '全量放量，默认通道' },
  beta: { id: 'beta', name: '内测通道', note: '仅内测设备；未配置内测版本时回退稳定' }
};

const channel = {
  get() {
    const o = readJson(CHANNEL_FP, null);
    const active = o && (o.active === 'beta' || o.active === 'stable') ? o.active : 'stable';
    return {
      ok: true,
      active: active,
      channels: CHANNELS,
      betaVersion: (o && o.betaVersion) || null,
      updatedAt: (o && o.updatedAt) || null,
      note: active === 'beta' && !(o && o.betaVersion) ? '内测通道尚未配置内测版本，更新比对将回退稳定清单' : ''
    };
  },
  set(next) {
    next = next || {};
    const active = next.active === 'beta' ? 'beta' : 'stable';
    const cur = readJson(CHANNEL_FP, { schema: 1 });
    const out = {
      schema: 1,
      active: active,
      betaVersion: active === 'beta' ? clip(next.betaVersion, 40) || (cur.betaVersion || null) : null,
      updatedAt: now()
    };
    if (!writeJson(CHANNEL_FP, out)) return { ok: false, error: '写入失败' };
    return { ok: true, channel: this.get() };
  }
};

module.exports = { origins, promo, channel };
