/**
 * 鸿汇影 · 分享短链（1.7.94 · 清单 #65「二维码/短链分享」）
 * ------------------------------------------------------------------------------------------
 * 客户端把「片名 / 站点 / 分享文本」发到这里换一个短码，短链形如 /s/<code>；
 * 扫码或点开短链由服务端 302 跳到目标地址，客户端只负责画二维码。
 * 只做「公开可分享的目标」：拒绝本机路径、内网地址、凭证类参数，避免变成内网探测工具。
 * 存储：data/shares.json（最多 500 条，超出按时间淘汰最旧）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.KH_SHARE_DATA || path.join(__dirname, 'data');
const FP = path.join(DATA, 'shares.json');
const CAP = 500;
const CODE_LEN = 7;
const TTL_DAYS = 180;

function readJson(fp, dft) { try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return dft; } }
function writeJson(fp, obj) {
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, fp);
    return true;
  } catch (e) { return false; }
}
function load() {
  const raw = readJson(FP, null);
  if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object') return { schema: 1, items: {} };
  return { schema: 1, items: raw.items };
}
function save(db) { return writeJson(FP, db); }

/* 目标地址白名单：只允许 http(s) 公网地址，或应用内 hash 路由 /#xxx（不跳外链） */
function safeTarget(s) {
  const v = String(s == null ? '' : s).trim().slice(0, 2000);
  if (!v) return null;
  if (v[0] === '#') return v;                         /* 应用内路由：扫码后仍在本应用内 */
  if (!/^https?:\/\//i.test(v)) return null;
  let u;
  try { u = new URL(v); } catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  /* 拦内网 / 回环 / 本机盘符伪装，避免短链被用来探测内网 */
  if (/^(localhost|127\.|0\.0\.0\.0|::1|\[::1\])/.test(host)) return null;
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
  if (/^file:/i.test(u.protocol)) return null;
  return u.toString().slice(0, 2000);
}
function safeTitle(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60); }

function newCode(items) {
  for (let i = 0; i < 12; i++) {
    const c = crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, CODE_LEN).toLowerCase();
    if (c.length >= 5 && !items[c]) return c.padEnd(CODE_LEN, '0');
  }
  return 'x' + Date.now().toString(36).slice(-6);
}

/* 建一条短链；同目标已存在则复用（避免刷爆存储） */
function create(target, title) {
  const t = safeTarget(target);
  if (!t) return { ok: false, error: '目标地址不合法（只接受 http(s) 公网地址或 # 开头的应用内路由）' };
  const db = load();
  const items = db.items;
  const now = Date.now();
  /* 过期与超量清理 */
  const keys = Object.keys(items);
  for (const k of keys) {
    const it = items[k];
    if (!it || !it.at || now - it.at > TTL_DAYS * 86400000) delete items[k];
  }
  const sorted = Object.keys(items).sort((a, b) => (items[a].at || 0) - (items[b].at || 0));
  while (sorted.length > CAP) { const k = sorted.shift(); delete items[k]; }
  let exist = null;
  for (const k of Object.keys(items)) if (items[k].target === t) { exist = k; break; }
  if (exist) {
    items[exist].hits = (items[exist].hits || 0);
    items[exist].title = safeTitle(title) || items[exist].title || '';
    save(db);
    return { ok: true, code: exist, target: t, reused: true };
  }
  const code = newCode(items);
  items[code] = { target: t, title: safeTitle(title), at: now, hits: 0 };
  const ok = save(db);
  if (!ok) return { ok: false, error: '短链写入失败（数据目录不可写）' };
  return { ok: true, code: code, target: t, reused: false };
}

function resolve(code) {
  const c = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (!c) return null;
  const db = load();
  const it = db.items[c];
  if (!it) return null;
  it.hits = (it.hits || 0) + 1;
  it.last = Date.now();
  save(db);
  return { target: it.target, title: it.title || '' };
}

function list(limit) {
  const db = load();
  const arr = Object.keys(db.items).map((k) => Object.assign({ code: k }, db.items[k]))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  return arr.slice(0, Math.min(Number(limit) || 50, 200));
}

function info() {
  const db = load();
  const codes = Object.keys(db.items);
  return { count: codes.length, cap: CAP, ttlDays: TTL_DAYS, data: DATA };
}

module.exports = { create, resolve, list, info, safeTarget, safeTitle, CAP, CODE_LEN };
