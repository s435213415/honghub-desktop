/* 鸿汇影 · P2 能力模块（1.7.89 · 台账 #161 性能 / 无障碍 / 安全）
   --------------------------------------------------------------
   与 kh-backup.js 同一约定：纯逻辑、不碰 DOM 与 localStorage，
   浏览器直接用全局，Node 下可 require（scripts/test-p2-kit.js 跑断言）。

   性能
     khP2Net(cfg)                 读超时 / 重试 / 并发三项 → {conc, timeoutMs, retry}
     khP2Queue(conc, onIdle)      并发上限调度器（push(fn) → Promise，stats() 看峰值）
     khP2Retry(fn, opt)           超时 + 重试（失败明细挂在 err.attempts）
     khP2Fetch(url, opt)          带策略的 fetch（GET 幂等重试，4xx 不重试）
     khP2LiveQuality(v)           直播默认清晰度档位
     khP2CardMin(density)         卡片最小宽度（密度档位）

   无障碍
     khP2Focus(v)                 焦点框 {color, width, offset}（跟随主题 / 高对比）
     khP2VolTarget(v)             音量键归属：app / system
     khP2SubExtra(cfg)            字幕字体与描边 {font, stroke}

   安全
     khP2NormalizePath(p) / khP2PathAllowed(p, dirs)   本地目录白名单
     khP2HostAllowed(url, hosts, opt)                  Webhook / 回调域名白名单
     khP2Seal(text) / khP2Verify(seal, text)           配置存储完整性封条
     khP2SubFontCss(font) / khP2SubStrokeCss(stroke)  字幕样式落地值
*/

(function (root) {
  'use strict';

  var P2_V = 1;

  var P2_DEF = {
    netConc: 6,          // 并发请求数
    netTimeout: 15,      // 秒
    netRetry: 2,         // 重试次数（不含首次）
    liveQuality: 'auto', // auto | hd | sd
    liveAutoStart: 0,    // 1 = 打开即进上次直播
    cardDensity: 'std',  // compact | std | loose
    focusRing: 'theme',  // theme | contrast | white | blue
    volKeys: 'app',      // app | system
    subFont: 'system',   // system | hei | song | round
    subStroke: 'thin',   // none | thin | thick
    subPos: 8,           // 字幕贴底距离（百分比：4 / 8 / 12 / 18 / 26）
    localDirs: [],       // 已授权的本地目录（绝对路径）
    webhookHosts: [],    // 允许外发的域名（*.example.com 支持）
    storeHarden: 1       // 1 = 配置写入带封条
  };

  var NET_CONC = [2, 4, 6, 8, 12];
  var NET_TIMEOUT = [10, 15, 20, 30, 60];
  var NET_RETRY = [0, 1, 2, 3];
  var LIVE_QUAL = ['auto', 'hd', 'sd'];
  var CARD_DENSITY = ['compact', 'std', 'loose'];
  var FOCUS_RING = ['theme', 'contrast', 'white', 'blue'];
  var VOL_KEYS = ['app', 'system'];
  var SUB_FONT = ['system', 'hei', 'song', 'round'];
  var SUB_STROKE = ['none', 'thin', 'thick'];
  var SUB_POS = [4, 8, 12, 18, 26];

  function pick(v, list, def) {
    v = String(v == null ? '' : v);
    return list.indexOf(v) >= 0 ? v : def;
  }
  function num(v, list, def) {
    var n = Number(v);
    return list.indexOf(n) >= 0 ? n : def;
  }
  function arr(v, max) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length && out.length < (max || 24); i++) {
      var s = String(v[i] == null ? '' : v[i]).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }

  /* 把外部读到的对象规范成完整配置：缺项补默认，非法值回落默认 */
  function khP2Norm(raw) {
    raw = (raw && typeof raw === 'object') ? raw : {};
    return {
      netConc: num(raw.netConc, NET_CONC, P2_DEF.netConc),
      netTimeout: num(raw.netTimeout, NET_TIMEOUT, P2_DEF.netTimeout),
      netRetry: num(raw.netRetry, NET_RETRY, P2_DEF.netRetry),
      liveQuality: pick(raw.liveQuality, LIVE_QUAL, P2_DEF.liveQuality),
      liveAutoStart: Number(raw.liveAutoStart) ? 1 : 0,
      cardDensity: pick(raw.cardDensity, CARD_DENSITY, P2_DEF.cardDensity),
      focusRing: pick(raw.focusRing, FOCUS_RING, P2_DEF.focusRing),
      volKeys: pick(raw.volKeys, VOL_KEYS, P2_DEF.volKeys),
      subFont: pick(raw.subFont, SUB_FONT, P2_DEF.subFont),
      subStroke: pick(raw.subStroke, SUB_STROKE, P2_DEF.subStroke),
      subPos: num(raw.subPos, SUB_POS, P2_DEF.subPos),
      localDirs: arr(raw.localDirs),
      webhookHosts: arr(raw.webhookHosts),
      storeHarden: Number(raw.storeHarden) === 0 ? 0 : 1
    };
  }

  /* ---------------- 性能 ---------------- */

  function khP2Net(cfg) {
    var c = khP2Norm(cfg);
    return { conc: c.netConc, timeoutMs: c.netTimeout * 1000, retry: c.netRetry };
  }

  /* 并发上限调度：同一时刻最多 conc 个任务在跑，其余排队；
     peak 是真的观测峰值，用来断言「没有越过上限」。 */
  function khP2Queue(conc, onIdle) {
    var limit = Math.max(1, Math.min(32, Number(conc) || 6));
    var active = 0, waiting = [], peak = 0, done = 0, failed = 0, closed = false;

    function pump() {
      while (active < limit && waiting.length) {
        var it = waiting.shift();
        active += 1;
        if (active > peak) peak = active;
        Promise.resolve()
          .then(it.fn)
          .then(function (v) { return v; }, function (e) { throw e; })
          .then(
            function (v) { active -= 1; done += 1; it.res(v); pump(); },
            function (e) { active -= 1; failed += 1; it.rej(e); pump(); }
          );
      }
      if (!active && !waiting.length && onIdle && !closed) {
        closed = true;
        try { onIdle(stats()); } catch (e) {}
      }
    }
    function stats() {
      return { limit: limit, active: active, waiting: waiting.length, peak: peak, done: done, failed: failed };
    }
    return {
      push: function (fn) {
        return new Promise(function (res, rej) { waiting.push({ fn: fn, res: res, rej: rej }); pump(); });
      },
      stats: stats
    };
  }

  /* 超时 + 重试：fn(attempt) 返回 Promise。retry 是「重试次数」，总尝试 = retry + 1。
     err.attempts = [{attempt, error}]，与 #158 更新源那套报错口径一致。 */
  function khP2Retry(fn, opt) {
    opt = opt || {};
    var retry = Math.max(0, Math.min(10, Number(opt.retry == null ? 2 : opt.retry)));
    var timeoutMs = Math.max(500, Math.min(180000, Number(opt.timeoutMs || 15000)));
    var attempt = 0, errors = [];

    return new Promise(function (resolve, reject) {
      function run() {
        attempt += 1;
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          errors.push({ attempt: attempt, error: 'timeout(' + timeoutMs + 'ms)' });
          step();
        }, timeoutMs);
        var pr;
        try { pr = Promise.resolve(fn(attempt)); } catch (e) { pr = Promise.reject(e); }
        pr.then(
          function (v) { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
          function (e) {
            if (settled) return;
            settled = true; clearTimeout(timer);
            var msg = String((e && e.message) || e || 'error').slice(0, 80);
            errors.push({ attempt: attempt, error: msg });
            step();
          }
        );
      }
      function step() {
        if (attempt > retry) {
          var err = new Error('重试 ' + retry + ' 次仍失败');
          err.attempts = errors;
          reject(err);
          return;
        }
        run();
      }
      run();
    });
  }

  var _queue = null, _qkey = '';

  function queueFor(conc) {
    var key = String(conc);
    if (!_queue || _qkey !== key) { _queue = khP2Queue(conc); _qkey = key; }
    return _queue;
  }

  /* 带策略的 fetch：并发受控 + 超时 + 仅对网络错误 / 5xx / 429 重试。
     opt: {cfg, init, retry, timeoutMs, raw} —— raw=true 时不排队（下载 / 流式）。 */
  function khP2Fetch(url, opt) {
    opt = opt || {};
    var policy = khP2Net(opt.cfg);
    var init = opt.init || {};
    var method = String(init.method || 'GET').toUpperCase();
    var idem = method === 'GET' || method === 'HEAD';
    var retry = opt.retry != null ? Number(opt.retry) : (idem ? policy.retry : 0);
    var timeoutMs = Number(opt.timeoutMs || policy.timeoutMs);
    var f = (typeof fetch === 'function') ? fetch : (root && root.fetch);

    var task = function (attempt) {
      return khP2Retry(function () {
        if (!f) throw new Error('当前环境不支持 fetch');
        return f(url, init);
      }, { retry: retry, timeoutMs: timeoutMs }).then(function (res) {
        if (!res) throw new Error('空响应');
        if (idem && (res.status >= 500 || res.status === 429)) {
          throw new Error('HTTP ' + res.status);
        }
        return res;
      });
    };

    if (opt.raw) return task(1);
    return queueFor(policy.conc).push(function () { return task(1); });
  }

  function khP2LiveQuality(v) {
    return pick(v, LIVE_QUAL, P2_DEF.liveQuality);
  }
  var CARD_MIN = { compact: 132, std: 158, loose: 196 };
  function khP2CardMin(density) {
    return CARD_MIN[pick(density, CARD_DENSITY, P2_DEF.cardDensity)];
  }

  /* ---------------- 无障碍 ---------------- */

  var FOCUS_MAP = {
    theme:    { color: 'var(--accent)', width: 3, offset: 3 },
    contrast: { color: '#ffd400',       width: 4, offset: 2 },
    white:    { color: '#ffffff',       width: 4, offset: 2 },
    blue:     { color: '#4da3ff',       width: 4, offset: 2 }
  };
  function khP2Focus(v) {
    return FOCUS_MAP[pick(v, FOCUS_RING, P2_DEF.focusRing)];
  }

  function khP2VolTarget(v) {
    return pick(v, VOL_KEYS, P2_DEF.volKeys);
  }

  var SUB_FONT_CSS = {
    system: '"Noto Sans SC","Microsoft YaHei","PingFang SC",system-ui,sans-serif',
    hei:    '"Microsoft YaHei","Heiti SC","Noto Sans SC",sans-serif',
    song:   '"SimSun","Songti SC","Noto Serif SC",serif',
    round:  '"YouYuan","Hiragino Sans GB","Noto Sans SC",sans-serif'
  };
  var SUB_STROKE_CSS = {
    none:  '0 0 0 transparent',
    thin:  '0 1px 2px rgba(0,0,0,.85)',
    thick: '0 2px 3px #000,0 0 6px rgba(0,0,0,.9)'
  };
  function khP2SubFontCss(font) { return SUB_FONT_CSS[pick(font, SUB_FONT, P2_DEF.subFont)]; }
  function khP2SubStrokeCss(stroke) { return SUB_STROKE_CSS[pick(stroke, SUB_STROKE, P2_DEF.subStroke)]; }
  /* 字幕贴底距离：数值档（4/8/12/18/26）→ CSS 百分比；非法值回默认 8% */
  function khP2SubPosCss(pos) { return num(pos, SUB_POS, P2_DEF.subPos) + '%'; }

  function khP2SubExtra(cfg) {
    var c = khP2Norm(cfg);
    return {
      font: c.subFont,
      stroke: c.subStroke,
      pos: c.subPos,
      fontCss: khP2SubFontCss(c.subFont),
      strokeCss: khP2SubStrokeCss(c.subStroke),
      bottomCss: khP2SubPosCss(c.subPos)
    };
  }

  /* ---------------- 安全 ---------------- */

  /* 路径规范化：统一斜杠、去掉空段与 .、压掉尾部斜杠；.. 原样保留（由白名单校验拒绝）。
     不折叠大小写 —— Windows 比对时在调用处统一转小写。 */
  function khP2NormalizePath(p) {
    var raw = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+/g, '/');
    var prefix = raw.charAt(0) === '/' ? '/' : '';
    var parts = raw.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === '.') continue;
      out.push(seg);
    }
    return prefix + out.join('/');
  }
  function isAbs(p) {
    return /^[A-Za-z]:\//.test(p) || p.charAt(0) === '/';
  }
  /* 本地目录白名单：点播本机文件前必须过这一关。
     拒绝：非绝对路径、含 ..、空表（未授权任何目录）。 */
  function khP2PathAllowed(p, dirs) {
    var path = khP2NormalizePath(p);
    if (!path) return { ok: false, reason: '路径为空' };
    if (path.indexOf('..') >= 0) return { ok: false, reason: '路径含 ..，拒绝' };
    if (!isAbs(path)) return { ok: false, reason: '不是绝对路径' };
    var list = arr(dirs);
    if (!list.length) return { ok: false, reason: '还没有授权任何本地目录' };
    var lower = path.toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var d = khP2NormalizePath(list[i]);
      if (!d) continue;
      var dl = d.toLowerCase();
      if (lower === dl || lower.indexOf(dl + '/') === 0) return { ok: true, dir: d };
    }
    return { ok: false, reason: '不在已授权目录内' };
  }

  /* 域名白名单：默认只允许 https；allowHttp 可选放开（本机回环始终允许）。
     支持精确 host 与 *.example.com 后缀式；空表 = 全拒（安全默认）。 */
  function khP2HostAllowed(url, hosts, opt) {
    opt = opt || {};
    var s = String(url == null ? '' : url).trim();
    if (!s) return { ok: false, reason: '地址为空' };
    var m = /^(https?):\/\/([^\/?#]+)/i.exec(s);
    if (!m) return { ok: false, reason: '不是 http(s) 地址' };
    var proto = m[1].toLowerCase();
    var host = m[2].toLowerCase();
    var hostname = host.split(':')[0];
    var loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    if (proto !== 'https' && !loopback && !opt.allowHttp) {
      return { ok: false, reason: '非 https，且未允许明文外发' };
    }
    var list = arr(hosts);
    if (!list.length) return loopback ? { ok: true, host: hostname, loopback: true } : { ok: false, reason: '白名单为空（安全默认全拒）' };
    for (var i = 0; i < list.length; i++) {
      var rule = String(list[i]).trim().toLowerCase();
      if (!rule) continue;
      if (rule === hostname) return { ok: true, host: hostname, rule: rule };
      if (rule.indexOf('*.') === 0) {
        var suffix = rule.slice(1); // .example.com
        if (hostname.length > suffix.length && hostname.slice(-suffix.length) === suffix) {
          return { ok: true, host: hostname, rule: rule };
        }
      }
    }
    return { ok: false, reason: '域名不在白名单：' + hostname };
  }

  /* 配置存储封条：双向滚动校验和（FNV-1a 变体 + 乘法滚动），
     目的是「发现截断 / 手改 / 乱码并回退」，不是加密，也不是防对抗强度 —— 如实标注。 */
  function khP2Sum(text) {
    var s = String(text == null ? '' : text);
    var a = 2166136261, b = 2654435761;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      a = ((a ^ c) * 16777619) >>> 0;
      b = ((b ^ (c + i)) * 2246822519) >>> 0;
    }
    return ('0000000' + a.toString(16)).slice(-8) + ('0000000' + b.toString(16)).slice(-8);
  }
  function khP2Seal(text) {
    var s = String(text == null ? '' : text);
    return { v: P2_V, len: s.length, sum: khP2Sum(s), at: new Date().toISOString() };
  }
  function khP2Verify(seal, text) {
    var s = String(text == null ? '' : text);
    if (!seal || typeof seal !== 'object') return { ok: false, reason: '无封条' };
    if (Number(seal.len) !== s.length) return { ok: false, reason: '长度不符（可能被截断）' };
    if (String(seal.sum) !== khP2Sum(s)) return { ok: false, reason: '校验和不符（可能被手改）' };
    return { ok: true };
  }

  var api = {
    V: P2_V,
    DEF: P2_DEF,
    OPTIONS: {
      netConc: NET_CONC, netTimeout: NET_TIMEOUT, netRetry: NET_RETRY,
      liveQuality: LIVE_QUAL, cardDensity: CARD_DENSITY, focusRing: FOCUS_RING,
      volKeys: VOL_KEYS, subFont: SUB_FONT, subStroke: SUB_STROKE, subPos: SUB_POS
    },
    norm: khP2Norm,
    net: khP2Net,
    queue: khP2Queue,
    retry: khP2Retry,
    fetch: khP2Fetch,
    liveQuality: khP2LiveQuality,
    cardMin: khP2CardMin,
    focus: khP2Focus,
    volTarget: khP2VolTarget,
    subExtra: khP2SubExtra,
    subFontCss: khP2SubFontCss,
    subStrokeCss: khP2SubStrokeCss,
    subPosCss: khP2SubPosCss,
    normPath: khP2NormalizePath,
    pathAllowed: khP2PathAllowed,
    hostAllowed: khP2HostAllowed,
    sum: khP2Sum,
    seal: khP2Seal,
    verify: khP2Verify
  };

  root.KHP2 = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
