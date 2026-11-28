/**
 * 鸿汇影 · 设备码账号 + 云同步 + 手机遥控（1.7.95 · 台账 P1-01 / P1-02 / P1-03 / P2-B09 / P2-B10）
 * ------------------------------------------------------------------------------------
 * 设计口径（诚实第一）：
 *   1) 没有手机号、没有邮箱、没有第三方登录。「账号」就是一枚 8 位设备码（XXXX-XXXX），
 *      本身就是凭证：知道这枚码就能在另一台设备上取回自己的收藏 / 历史 / 片单 / 续播点。
 *      不做密码、不做找回——号码丢了就是丢了，这是这种轻量账号的固有代价，明确写在客户端面板里。
 *   2) 字符集去掉 0/O/1/I 这类易混字符，4+4 分组便于手抄与朗读。
 *   3) 云同步只收四类用户数据（收藏 / 观看历史 / 片单 / 续播点），一律不含链接、本机路径、口令。
 *      合并策略：按 id 求并集，新的排前面，各自有硬上限；续播点按时间取最新的那份。
 *   4) 手机遥控：手机扫码打开 /remote 页面 → 输入或自带设备码 → 指令写进内存队列 →
 *      桌面端每 2~3 秒轮询取走。队列不落盘（重启即清空），只接受白名单里的 8 个指令。
 *
 * 数据落 server/data/accounts.json；读失败一律当空表，不覆盖坏文件以外的任何东西。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = process.env.KH_DATA_DIR ? path.resolve(process.env.KH_DATA_DIR) : path.join(__dirname, 'data');
const ACCT_FP = path.join(DATA, 'accounts.json');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   /* 32 个字符，去掉了 0/O/1/I */
const CAP = { fav: 200, hist: 200, watchlist: 100, livefav: 100 };
const REMOTE_CMDS = ['playpause', 'seekback', 'seekfwd', 'volup', 'voldown', 'next', 'prev', 'back'];
const REMOTE_TTL = 20 * 1000;      /* 指令存活 20 秒，过期丢弃，避免迟到的按键把电视搅乱 */
const REMOTE_MAX = 60;             /* 单个设备码的队列上限 */

let cache = null;

/* ---------------- 基础工具 ---------------- */

function readAll() {
  if (cache) return cache;
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(ACCT_FP, 'utf8')); } catch (e) { raw = null; }
  cache = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return cache;
}

function writeAll(obj) {
  try {
    fs.mkdirSync(path.dirname(ACCT_FP), { recursive: true });
    const tmp = ACCT_FP + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
    fs.renameSync(tmp, ACCT_FP);
    cache = obj;
    return true;
  } catch (e) { return false; }
}

function clip(s, n) {
  return String(s === undefined || s === null ? '' : s).trim().slice(0, n);
}
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function nowIso() { return new Date().toISOString(); }

/* 设备码规范化：去空白与连字符、统一大写、校验字符集与长度 */
function normCode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s\-_]/g, '');
  if (s.length !== 8) return '';
  for (let i = 0; i < s.length; i++) if (ALPHABET.indexOf(s[i]) < 0) return '';
  return s.slice(0, 4) + '-' + s.slice(4);
}

function newCode() {
  const all = readAll();
  for (let tries = 0; tries < 40; tries++) {
    let raw = '';
    for (let i = 0; i < 8; i++) raw += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    const c = raw.slice(0, 4) + '-' + raw.slice(4);
    if (!all[c]) return c;
  }
  return '';
}

/* ---------------- 用户数据规范化 ---------------- */

/* 单条记录：客户端既有存储里 fav/hist 就是 id 列表（数字或字符串），
   所以标量原样收下；对象形态只留白名单字段，字符串截断，绝不带 URL 与路径。 */
function cleanItem(it) {
  if (typeof it === 'number') return Number.isFinite(it) ? { id: it } : null;
  if (typeof it === 'string') {
    const s = clip(it, 40);
    return s ? { id: s } : null;
  }
  if (!isObj(it)) return null;
  const id = (typeof it.id === 'number') ? it.id : clip(it.id, 40);
  if (id === '' || id === null) return null;
  const out = { id: id };
  ['title', 'name', 'cat', 'category', 'year', 'tags', 'channel', 'kind'].forEach((k) => {
    if (it[k] === undefined || it[k] === null) return;
    if (Array.isArray(it[k])) {
      out[k] = it[k].slice(0, 8).map((x) => clip(x, 24)).filter(Boolean);
      return;
    }
    if (typeof it[k] === 'number') { out[k] = it[k]; return; }
    const v = clip(it[k], 60);
    if (/^https?:\/\//i.test(v)) return;      /* 链接型字段直接丢 */
    if (v) out[k] = v;
  });
  if (Number.isFinite(Number(it.at))) out.at = Number(it.at);
  return out;
}

function cleanList(arr, cap) {
  const out = [];
  const seen = {};
  (Array.isArray(arr) ? arr : []).forEach((it) => {
    const c = cleanItem(it);
    if (!c) return;
    const key = String(c.id);
    if (seen[key]) return;
    seen[key] = 1;
    if (out.length < cap) out.push(c);
  });
  return out;
}

/* 续播点：客户端本机是 {影片id: 秒数}，跨端上云时补上时间戳（拿不到就记 0）。
   两种形态都收：纯数字 → pos；对象 → pos/dur/at。 */
function cleanProg(src) {
  const out = {};
  if (!isObj(src)) return out;
  Object.keys(src).slice(0, CAP.hist).forEach((k) => {
    const v = src[k];
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v < 0) return;
      out[clip(k, 40)] = { pos: Math.round(v), dur: 0, at: 0 };
      return;
    }
    if (!isObj(v)) return;
    const pos = Number(v.pos), dur = Number(v.dur);
    if (!Number.isFinite(pos) || pos < 0) return;
    out[clip(k, 40)] = {
      pos: Math.round(pos * 10) / 10,
      dur: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 10) / 10 : 0,
      at: Number(v.at) || 0
    };
  });
  return out;
}

/* 客户端上传的 profile → 服务端口径 */
function sanitize(profile) {
  const p = isObj(profile) ? profile : {};
  return {
    fav: cleanList(p.fav, CAP.fav),
    hist: cleanList(p.hist, CAP.hist),
    watchlist: cleanList(p.watchlist, CAP.watchlist),
    livefav: cleanList(p.livefav, CAP.livefav),
    prog: cleanProg(p.prog)
  };
}

/* 两台设备的并集：新的在前（按 at/顺序），去重；续播点取 at 最新的 */
function mergeList(remote, local, cap) {
  const out = [];
  const seen = {};
  const push = (it) => {
    const c = cleanItem(it);
    if (!c) return;
    const k = String(c.id);
    if (seen[k]) return;
    seen[k] = 1;
    if (out.length < cap) out.push(c);
  };
  (remote || []).forEach(push);
  (local || []).forEach(push);
  return out;
}

function mergeProfile(remote, local) {
  const r = isObj(remote) ? remote : {};
  const l = sanitize(local);
  const prog = {};
  const rp = isObj(r.prog) ? r.prog : {};
  Object.keys(rp).forEach((k) => { prog[k] = rp[k]; });
  Object.keys(l.prog).forEach((k) => {
    const a = prog[k], b = l.prog[k];
    /* 有时间戳就比时间；都没时间戳（本机秒数直传）就留进度更靠后的那份 */
    const newer = a ? ((b.at && a.at) ? (b.at >= a.at) : (b.pos >= a.pos)) : true;
    if (newer) prog[k] = b;
  });
  /* 续播点最多留 200 条，按时间倒序保留（无时间的排在后面） */
  const keys = Object.keys(prog).sort((a, b) => (prog[b].at || 0) - (prog[a].at || 0)).slice(0, CAP.hist);
  const outProg = {};
  keys.forEach((k) => { outProg[k] = prog[k]; });
  return {
    fav: mergeList(r.fav, l.fav, CAP.fav),
    hist: mergeList(r.hist, l.hist, CAP.hist),
    watchlist: mergeList(r.watchlist, l.watchlist, CAP.watchlist),
    livefav: mergeList(r.livefav, l.livefav, CAP.livefav),
    prog: outProg
  };
}

/* ---------------- 账号 ---------------- */

function ensure(code) {
  const all = readAll();
  const c = normCode(code);
  if (!c) return null;
  if (!all[c]) return null;
  return all[c];
}

function create(preferCode) {
  const all = readAll();
  let c = normCode(preferCode);
  if (c && all[c]) {
    return { ok: true, code: c, existing: true, account: all[c] };
  }
  if (!c) c = newCode();
  if (!c) return { ok: false, error: '号码空间分配失败，请重试' };
  all[c] = {
    code: c, createdAt: nowIso(), lastAt: nowIso(), nick: '',
    data: { fav: [], hist: [], watchlist: [], livefav: [], prog: {} },
    rev: 0
  };
  const okW = writeAll(all);
  return { ok: okW, code: c, existing: false, account: all[c], error: okW ? '' : '落盘失败（只读文件系统？）' };
}

function get(code) {
  const a = ensure(code);
  if (!a) return null;
  return { code: a.code, nick: a.nick || '', createdAt: a.createdAt, lastAt: a.lastAt, rev: a.rev || 0, data: a.data };
}

function sync(code, profile, nick) {
  const all = readAll();
  const c = normCode(code);
  if (!c) return { ok: false, error: '设备码格式不对（应为 8 位字母数字，如 ABCD-EFGH）' };
  if (!all[c]) return { ok: false, code: c, missing: true, error: '这枚设备码还不存在，先在本机生成或注册' };
  const a = all[c];
  a.data = mergeProfile(a.data, profile);
  a.rev = (a.rev || 0) + 1;
  a.lastAt = nowIso();
  if (nick !== undefined) a.nick = clip(nick, 24);
  const okW = writeAll(all);
  return { ok: okW, code: c, rev: a.rev, nick: a.nick || '', data: a.data, error: okW ? '' : '落盘失败' };
}

function rename(code, nick) {
  const all = readAll();
  const c = normCode(code);
  if (!c || !all[c]) return { ok: false, error: '没有这枚设备码' };
  all[c].nick = clip(nick, 24);
  all[c].lastAt = nowIso();
  return { ok: writeAll(all), code: c, nick: all[c].nick };
}

function stats() {
  const all = readAll();
  const codes = Object.keys(all);
  return { accounts: codes.length, lastAt: codes.map((c) => all[c].lastAt || '').sort().pop() || '' };
}

/* ---------------- 手机遥控队列 ---------------- */

const queues = {};   /* code → [{id, cmd, at}] */
let seq = 1;

function pushCmd(code, cmd) {
  const c = normCode(code);
  if (!c) return { ok: false, error: '设备码格式不对' };
  if (REMOTE_CMDS.indexOf(cmd) < 0) return { ok: false, error: '不支持的指令：' + clip(cmd, 20) };
  const q = queues[c] || (queues[c] = []);
  const now = Date.now();
  /* 先清过期，再压入 */
  const alive = q.filter((x) => now - x.at <= REMOTE_TTL);
  alive.push({ id: seq++, cmd: cmd, at: now });
  queues[c] = alive.slice(-REMOTE_MAX);
  return { ok: true, code: c, id: queues[c][queues[c].length - 1].id, queued: queues[c].length };
}

function pollCmd(code, since) {
  const c = normCode(code);
  if (!c) return { ok: false, error: '设备码格式不对' };
  const now = Date.now();
  const q = (queues[c] || []).filter((x) => now - x.at <= REMOTE_TTL);
  queues[c] = q;
  const after = Number(since) || 0;
  const list = q.filter((x) => x.id > after).map((x) => ({ id: x.id, cmd: x.cmd, at: x.at }));
  return { ok: true, code: c, cmds: list, lastId: q.length ? q[q.length - 1].id : after };
}

function queueStats() {
  return Object.keys(queues).map((c) => ({ code: c, n: queues[c].length }));
}

/* ---------------- 手机遥控页面（单文件，无外部依赖） ---------------- */

function remotePage(baseUrl, code) {
  const c = normCode(code) || '';
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>鸿汇影 · 手机遥控</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#0B0D16;color:#E6EEF9;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;padding:18px 16px 30px}
h1{font-size:19px;margin:0 0 4px}
p.tip{color:#8D96AB;font-size:12.5px;margin:0 0 14px}
.code{display:flex;gap:8px;margin-bottom:16px}
.code input{flex:1;background:#141826;border:1px solid #262B3B;border-radius:10px;color:#E6EEF9;padding:11px 12px;font:600 16px/1 ui-monospace,monospace;letter-spacing:1px;text-transform:uppercase}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
button{background:#1878D6;border:0;border-radius:14px;color:#fff;font:600 16px/1.2 system-ui;padding:20px 6px;min-height:64px}
button.ghost{background:#1B2030;color:#C9CEDC}
button:active{transform:scale(.97);background:#0F5EA8}
button.ghost:active{background:#252B3D}
#out{margin-top:16px;color:#8D96AB;font-size:12.5px;min-height:18px}
.ok{color:#22C55E}
.err{color:#FF7A85}
</style></head><body>
<h1>鸿汇影 · 手机遥控</h1>
<p class="tip">手机与电视/电脑在同一局域网或都能上公网时可用。方向键在电视端自己移动焦点，这里只发播放指令。</p>
<div class="code"><input id="code" placeholder="设备码 ABCD-EFGH" value="${c}" autocomplete="off" spellcheck="false"></div>
<div class="pad">
  <button onclick="send('prev')">上一个</button>
  <button onclick="send('playpause')">播放 / 暂停</button>
  <button onclick="send('next')">下一个</button>
  <button class="ghost" onclick="send('seekback')">快退 10 秒</button>
  <button class="ghost" onclick="send('back')">返回</button>
  <button class="ghost" onclick="send('seekfwd')">快进 10 秒</button>
  <button class="ghost" onclick="send('voldown')">音量 −</button>
  <button class="ghost" onclick="send('playpause')">⏯</button>
  <button class="ghost" onclick="send('volup')">音量 +</button>
</div>
<div id="out">点上面的按钮就能发指令</div>
<script>
var BASE = ${JSON.stringify(base)};
function out(t, cls){ var o = document.getElementById('out'); o.textContent = t; o.className = cls || ''; }
function codeNow(){ return (document.getElementById('code').value || '').trim(); }
function send(cmd){
  var c = codeNow();
  if(!c){ out('先填设备码（在电视/电脑的「账号与云同步」面板里）', 'err'); return; }
  fetch(BASE + '/api/remote/cmd', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ code: c, cmd: cmd }) })
    .then(function(r){ return r.json(); })
    .then(function(d){ if(d && d.ok) out('已发送：' + cmd + '（队列 ' + (d.queued||0) + '）', 'ok'); else out((d && d.error) || '发送失败', 'err'); })
    .catch(function(e){ out('网络失败：' + (e && e.message || e), 'err'); });
}
</script></body></html>`;
}

module.exports = {
  ALPHABET: ALPHABET, CAP: CAP, REMOTE_CMDS: REMOTE_CMDS,
  normCode: normCode, newCode: newCode,
  sanitize: sanitize, mergeProfile: mergeProfile, mergeList: mergeList,
  cleanItem: cleanItem, cleanList: cleanList, cleanProg: cleanProg,
  create: create, get: get, sync: sync, rename: rename, stats: stats,
  pushCmd: pushCmd, pollCmd: pollCmd, queueStats: queueStats, remotePage: remotePage,
  ACCT_FP: ACCT_FP,
  _resetCache: function () { cache = null; }
};
