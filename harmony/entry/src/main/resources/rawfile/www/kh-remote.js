/* HongHub 前端模块：远端配置与云同步（1.7.94 · 清单 #69 #70 #71 #77 #66 #75）
   一份远端视图管四件事：公告位（首页横幅）、锁定项（只读）、远端默认值（本机没设过才补）、
   灰度开关（按设备哈希 + 版本区间求值）。另外提供偏好云同步的推送 / 拉取。
   本文件纯逻辑 + 三个请求包装，不碰 DOM；DOM 与存储仍在 kh-core.js，便于单测。 */
(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KHREMOTE = api;
})(typeof window !== 'undefined' ? window : this, function(){
  'use strict';

  var DEF = {
    rev: 0, at: '', notice: null, locks: [], defaults: {}, flags: {}, sync: { enabled: true }, from: 'none'
  };
  var LEVELS = ['info', 'event', 'warn'];
  /* 与 server/config-center.js 同一套禁用词：源地址 / 本机路径 / 凭证不上云 */
  var SYNC_BAN = /(url|site|src|link|addr|host|exe|path|dir|file|args|token|pass|pwd|pin|secret|key)/i;

  function isObj(o){ return o && typeof o === 'object' && !Array.isArray(o); }
  function str(v, n){ return String(v == null ? '' : v).slice(0, n || 400); }
  function simple(v){
    return v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  }

  /* ---------------- 视图归一 ---------------- */
  function normNotice(n){
    if (!isObj(n)) return null;
    var title = str(n.title, 60).trim(), text = str(n.text, 400).trim();
    if (!title && !text) return null;
    return {
      id: str(n.id, 64).trim() || ('n' + (title + text).length),
      title: title, text: text, link: str(n.link, 300).trim(),
      level: LEVELS.indexOf(n.level) >= 0 ? n.level : 'info',
      onboard: n.onboard !== false,
      from: str(n.from, 32), to: str(n.to, 32)
    };
  }

  function normView(raw){
    var v = JSON.parse(JSON.stringify(DEF));
    if (!isObj(raw)) return v;
    v.rev = Number(raw.rev) || 0;
    v.at = str(raw.at || raw.updatedAt, 32);
    v.notice = normNotice(raw.notice);
    v.locks = Array.isArray(raw.locks)
      ? raw.locks.filter(function(x){ return typeof x === 'string' && x; }).map(function(x){ return x.trim(); }).slice(0, 200)
      : [];
    v.locks = v.locks.filter(function(x, i, a){ return a.indexOf(x) === i; });
    if (isObj(raw.defaults)) {
      var d = {};
      /* null 不当默认值：写进去等于把键清空，容易把用户已有设置抹掉 */
      Object.keys(raw.defaults).forEach(function(k){ if (raw.defaults[k] != null && simple(raw.defaults[k])) d[k] = raw.defaults[k]; });
      v.defaults = d;
    }
    if (isObj(raw.flags)) {
      var f = {};
      Object.keys(raw.flags).forEach(function(k){ f[k] = raw.flags[k] === true; });
      v.flags = f;
    }
    if (isObj(raw.sync)) v.sync = { enabled: raw.sync.enabled !== false };
    if (isObj(raw.flagsRaw)) v.flagsRaw = raw.flagsRaw;
    v.from = 'remote';
    return v;
  }

  /* 缓存视图再判一次有效期：远端可能早就过期了，本地不该一直挂横幅 */
  function noticeActive(n, now){
    if (!n || !isObj(n)) return null;
    var t = now ? new Date(now) : new Date();
    if (n.from) { var f = Date.parse(n.from); if (!isNaN(f) && t.getTime() < f) return null; }
    if (n.to) { var e = Date.parse(n.to); if (!isNaN(e) && t.getTime() > e) return null; }
    if (!str(n.title, 60) && !str(n.text, 400)) return null;
    return n;
  }

  /* 关闭状态：本机记「关过哪些 id」，换公告 id 就重新出现 */
  function noticeShowable(view, closedIds, now){
    var n = noticeActive(view && view.notice, now);
    if (!n) return null;
    if (Array.isArray(closedIds) && closedIds.indexOf(n.id) >= 0) return null;
    return n;
  }

  function lockHit(locks, key){
    if (!key || !Array.isArray(locks)) return false;
    return locks.indexOf(String(key)) >= 0;
  }

  function flagOn(flags, id, dft){
    if (!isObj(flags)) return dft === undefined ? true : !!dft;
    if (!(id in flags)) return dft === undefined ? true : !!dft;
    return !!flags[id];
  }

  /* ---------------- 远端默认值：只补「本机没设过」的键 ---------------- */
  function defaultsPlan(defaults, has){
    var out = [], skipped = [];
    if (!isObj(defaults)) return { apply: out, skip: skipped };
    Object.keys(defaults).forEach(function(k){
      if (typeof has === 'function' && has(k)) { skipped.push(k); return; }
      out.push({ key: k, value: defaults[k] });
    });
    return { apply: out, skip: skipped };
  }

  /* ---------------- 离线灰度求值（与服务端同算法，断网也能用缓存结论） ---------------- */
  function bucket(device, id){
    var s = String(device || 'anon') + '|' + String(id || ''), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h % 100;
  }
  function verNum(v){
    var m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]) : null;
  }
  function evalFlags(flags, ctx){
    var out = {};
    if (!isObj(flags)) return out;
    var dev = (ctx && ctx.device) || 'anon', ver = (ctx && ctx.version) || '';
    Object.keys(flags).forEach(function(id){
      var f = flags[id];
      if (typeof f === 'boolean') { out[id] = f; return; }
      if (!isObj(f)) { out[id] = true; return; }
      var on = f.on !== false;
      if (on && f.roll != null && Number(f.roll) < 100) on = bucket(dev, id) < Number(f.roll);
      if (on && (f.minVer || f.maxVer)) {
        var n = verNum(ver), lo = verNum(f.minVer), hi = verNum(f.maxVer);
        if (n != null && lo != null && n < lo) on = false;
        if (n != null && hi != null && n > hi) on = false;
      }
      out[id] = !!on;
    });
    return out;
  }

  /* ---------------- 云同步：客户端侧也过滤一遍（服务端还会再滤） ---------------- */
  function syncFilter(src){
    var out = {};
    if (!isObj(src)) return out;
    Object.keys(src).forEach(function(k){
      if (!/^kh_[a-z0-9_]+$/.test(k)) return;
      if (SYNC_BAN.test(k.replace(/^kh_/, ''))) return;
      var v = src[k];
      if (!simple(v) && !isObj(v)) return;
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) return;
      if (isObj(v)) {
        var j;
        try { j = JSON.stringify(v); } catch (e) { return; }
        if (j.length > 4096 || /https?:\/\//.test(j)) return;
      }
      out[k] = v;
    });
    return out;
  }

  /* ---------------- 请求包装 ---------------- */
  function apiBase(base){ return String(base || '').replace(/\/+$/, ''); }
  function req(fetchImpl, url, opt){
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.reject(new Error('没有可用的 fetch'));
    return f(url, opt || { cache: 'no-store' }).then(function(r){ return r.json(); });
  }

  function load(base, device, ver, fetchImpl){
    var q = apiBase(base) + '/api/config/center?device=' + encodeURIComponent(device || '')
      + '&ver=' + encodeURIComponent(ver || '');
    return req(fetchImpl, q).then(function(d){
      if (!d || !d.ok) throw new Error((d && d.error) || '远端配置拉取失败');
      var v = normView(d);
      if (isObj(d.flagsRaw)) v.flagsRaw = d.flagsRaw;
      return v;
    });
  }

  function push(base, device, payload, fetchImpl){
    var body = JSON.stringify({ device: device, payload: syncFilter(payload) });
    return req(fetchImpl, apiBase(base) + '/api/sync/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
    });
  }

  function pull(base, device, fetchImpl){
    return req(fetchImpl, apiBase(base) + '/api/sync/pull?device=' + encodeURIComponent(device || ''));
  }

  return {
    DEF: DEF, normView: normView, normNotice: normNotice, noticeActive: noticeActive, noticeShowable: noticeShowable,
    lockHit: lockHit, flagOn: flagOn, defaultsPlan: defaultsPlan, evalFlags: evalFlags,
    syncFilter: syncFilter, bucket: bucket, verNum: verNum,
    load: load, push: push, pull: pull, apiBase: apiBase
  };
});
