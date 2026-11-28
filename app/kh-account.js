/* kh-account.js — 1.7.95 设备码账号 / 收藏云同步 / 跨端续播 / 手机遥控（P1-01/02/03 · P2-B09/B10）
 *
 * 这套东西的诚实边界，先写清楚：
 *   · 「账号」不是手机号也不是邮箱，就是一枚 8 位设备码（ABCD-EFGH）。它本身就是凭证：
 *     知道这枚码就能在另一台设备上取回收藏 / 历史 / 片单 / 续播点。没有密码、没有找回，
 *     码丢了就等于丢了——这是轻量账号的代价，界面上必须写出来，不能假装有客服。
 *   · 同步只带四类数据：收藏、观看历史、片单（含直播收藏）、续播点。链接、本机路径、
 *     口令一律不上云（服务端还会再滤一遍）。
 *   · 跨端续播的前提是两台设备认得出同一个片源。内置片源用数字 id，能对上；
 *     自定义网址 / 影视仓条目的 id 是各设备本地的，对不上就只是「有记录、点不开」，不做假映射。
 *   · 手机遥控走中枢的指令队列：手机发、桌面轮询取、20 秒过期。中枢不可达时整块不可用，
 *     面板必须显示「不可用」而不是转圈。
 */
(function (root) {
  var api = {};

  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var K_CODE = 'kh_acct_code';
  var K_META = 'kh_acct_meta';
  var K_NICK = 'kh_acct_nick';
  var K_HUBFALLBACK = 'kh_hub_url';
  var CMDS = ['playpause', 'seekback', 'seekfwd', 'volup', 'voldown', 'next', 'prev', 'back'];
  var LIMIT = { fav: 200, hist: 200, watchlist: 100, livefav: 100 };

  /* ---------- 存储（优先用 kh-core 的统一存储，独立运行时回落 localStorage） ---------- */

  function sget(k, d) {
    try {
      if (typeof root.getStore === 'function') return root.getStore(k, d);
      var v = root.localStorage ? root.localStorage.getItem(k) : null;
      return v == null ? d : JSON.parse(v);
    } catch (e) { return d; }
  }
  function sset(k, v) {
    try {
      if (typeof root.setStore === 'function') { root.setStore(k, v); return true; }
      root.localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 设备码 ---------- */

  function normCode(input) {
    var s = String(input || '').toUpperCase().replace(/[\s\-_]/g, '');
    if (s.length !== 8) return '';
    for (var i = 0; i < s.length; i++) if (ALPHABET.indexOf(s.charAt(i)) < 0) return '';
    return s.slice(0, 4) + '-' + s.slice(4);
  }

  function genCode() {
    var s = '';
    for (var i = 0; i < 8; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return s.slice(0, 4) + '-' + s.slice(4);
  }

  /* 本机码：第一次读不到就生成一枚并落盘（只是本地标识，还没注册到中枢） */
  function localCode() {
    var c = normCode(sget(K_CODE, ''));
    if (!c) { c = genCode(); sset(K_CODE, c); }
    return c;
  }

  function setCode(code) {
    var c = normCode(code);
    if (!c) return '';
    sset(K_CODE, c);
    return c;
  }

  function nick() { return String(sget(K_NICK, '') || ''); }
  function setNick(v) { sset(K_NICK, String(v || '').slice(0, 24)); }

  /* 中枢地址：与远端配置用的是同一个（window.KH_HUB），网页模式下为空就走同源 */
  function hub() {
    try {
      if (root.KH_HUB) return String(root.KH_HUB).replace(/\/+$/, '');
    } catch (e) {}
    return String(sget(K_HUBFALLBACK, '') || '').replace(/\/+$/, '');
  }

  /* ---------- 网络 ---------- */

  function request(path, opt, base) {
    var b = String(base === undefined ? hub() : base).replace(/\/+$/, '');
    var url = b + path;
    var o = opt || {};
    o.cache = 'no-store';
    var f = null;
    try { f = (typeof root.khFetch === 'function') ? root.khFetch : ((typeof root.fetch === 'function') ? root.fetch : null); } catch (e) { f = null; }
    if (!f) return Promise.reject(new Error('当前环境没有可用的网络请求'));
    return f(url, o).then(function (r) {
      if (!r || typeof r.json !== 'function') throw new Error('响应不可读');
      return r.json();
    });
  }

  function postJson(path, payload, base) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, base);
  }

  /* ---------- 本机数据 → 云端口径 ---------- */

  function arr(k) {
    var v = sget(k, []);
    if (!Array.isArray(v)) return [];
    return v.slice(0, 200);
  }

  function profile() {
    var prog = sget('kh_prog', {});
    return {
      fav: arr('kh_fav'),
      hist: arr('kh_hist'),
      watchlist: arr('kh_watchlist'),
      livefav: arr('kh_livefav'),
      prog: (prog && typeof prog === 'object' && !Array.isArray(prog)) ? prog : {}
    };
  }

  function ids(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      var id = (x && typeof x === 'object') ? x.id : x;
      if (id === null || id === undefined || id === '') continue;
      if (out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }

  /* 云端回来 → 写回本机。续播点云端是 {pos,dur,at}，本机要的是纯秒数 */
  function applyProfile(d) {
    d = d || {};
    sset('kh_fav', ids(d.fav));
    sset('kh_hist', ids(d.hist));
    sset('kh_watchlist', ids(d.watchlist));
    sset('kh_livefav', ids(d.livefav));
    var src = (d.prog && typeof d.prog === 'object') ? d.prog : {};
    var p = {};
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      var sec = (typeof v === 'number') ? v : Number(v && v.pos);
      if (!isFinite(sec) || sec < 0) return;
      p[k] = Math.round(sec);
    });
    sset('kh_prog', p);
    var meta = {
      at: new Date().toISOString(),
      code: localCode(),
      nick: nick(),
      counts: { fav: ids(d.fav).length, hist: ids(d.hist).length, prog: Object.keys(p).length }
    };
    sset(K_META, meta);
    return meta;
  }

  function meta() { return sget(K_META, null); }

  /* ---------- 与中枢的三件事：注册 / 同步 / 拉取 ---------- */

  function register(base, code) {
    var c = normCode(code) || localCode();
    return postJson('/api/account/create', { code: c, nick: nick() }, base).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '注册失败');
      setCode(d.code);
      return { ok: true, code: d.code, existing: !!d.existing };
    });
  }

  function sync(base) {
    var code = localCode();
    return postJson('/api/account/sync', { code: code, profile: profile(), nick: nick() }, base)
      .then(function (d) {
        if (d && d.ok) { applyProfile(d.data); return { ok: true, code: d.code, rev: d.rev, merged: true }; }
        /* 中枢说没这枚码 → 先注册再同步一次（只重试一次，避免死循环） */
        if (d && d.missing) {
          return register(base, code).then(function () { return sync(base); });
        }
        throw new Error((d && d.error) || '同步失败');
      });
  }

  function pull(base) {
    var code = localCode();
    return request('/api/account/data?code=' + encodeURIComponent(code), {}, base).then(function (d) {
      if (!d || !d.ok || !d.account) throw new Error((d && d.error) || '中枢没有这枚设备码');
      return applyProfile(d.account.data);
    });
  }

  /* 换用别人的设备码（相当于「登录」）：先设码，再拉回来合并 */
  function adopt(code, base) {
    var c = normCode(code);
    if (!c) return Promise.reject(new Error('设备码格式不对（8 位字母数字，如 ABCD-EFGH）'));
    setCode(c);
    return pull(base).then(function (m) {
      return sync(base).then(function (r) { return { ok: true, code: c, meta: m, rev: r.rev }; });
    });
  }

  /* ---------- 手机遥控 ---------- */

  function pairUrl(base, code) {
    var b = String(base === undefined ? hub() : base).replace(/\/+$/, '');
    if (!b) {
      try { b = String(root.location.origin || '').replace(/\/+$/, ''); } catch (e) { b = ''; }
    }
    if (!b) return '';
    return b + '/remote?code=' + encodeURIComponent(normCode(code) || localCode());
  }

  function sendCmd(cmd, base) {
    if (CMDS.indexOf(cmd) < 0) return Promise.reject(new Error('不支持的指令'));
    return postJson('/api/remote/cmd', { code: localCode(), cmd: cmd }, base);
  }

  /* 单次轮询，抽出来便于单测 */
  function tickOnce(since, base) {
    var code = localCode();
    return request('/api/remote/poll?code=' + encodeURIComponent(code) + '&since=' + (Number(since) || 0), {}, base)
      .then(function (d) {
        if (!d || !d.ok) return { since: Number(since) || 0, cmds: [] };
        return { since: Number(d.lastId) || Number(since) || 0, cmds: (d.cmds || []) };
      });
  }

  /* 桌面端轮询：手机发来的指令在这里落到播放器动作上 */
  function startRemote(onCmd, opt) {
    opt = opt || {};
    var stopped = false, since = 0, timer = null;
    var period = Math.max(1000, Number(opt.period) || 2500);
    function loop() {
      if (stopped) return;
      tickOnce(since, opt.base).then(function (r) {
        since = r.since;
        r.cmds.forEach(function (c) {
          if (CMDS.indexOf(c.cmd) < 0) return;
          try { onCmd(c.cmd, c); } catch (e) {}
        });
      }).catch(function () { /* 中枢不可达就静默跳过这一轮，不刷错误 */ })
        .then(function () { if (!stopped) timer = setTimeout(loop, period); });
    }
    timer = setTimeout(loop, period);
    return function stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; };
  }

  api.normCode = normCode;
  api.genCode = genCode;
  api.localCode = localCode;
  api.setCode = setCode;
  api.nick = nick;
  api.setNick = setNick;
  api.hub = hub;
  api.profile = profile;
  api.applyProfile = applyProfile;
  api.meta = meta;
  api.register = register;
  api.sync = sync;
  api.pull = pull;
  api.adopt = adopt;
  api.pairUrl = pairUrl;
  api.sendCmd = sendCmd;
  api.tickOnce = tickOnce;
  api.startRemote = startRemote;
  api.CMDS = CMDS;
  api.LIMIT = LIMIT;
  api.ALPHABET = ALPHABET;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KHACCT = api;
})(typeof window !== 'undefined' ? window : globalThis);
