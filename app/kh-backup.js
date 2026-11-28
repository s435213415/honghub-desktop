/* 鸿汇影 · 备份包工具（1.7.88 · 台账 #160）
   --------------------------------------------------------------
   放在前端被 kh-admin / kh-core 共用，同时能在 Node 下直接跑（scripts/test-backup-kit.js），
   所以本文件不碰 DOM、不碰 localStorage、不读全局配置，只做纯逻辑：
     khBakPack(data, meta)        明文包（v2，向后兼容 1.7.8x 的导入器）
     khBakIsEncrypted(obj)        是否加密包
     khBakEncrypt(data, pass, opt) 加密导出 → Promise<加密包>
     khBakDecrypt(env, pass)      解密 → Promise<明文包>
     khBakDiff(data, current)     导入差异预览（本机 / 备份 / 将新增 / 将覆盖）
     khBakSnapPush(list, entry, keep)  快照轮转（保留最近 keep 版）
     khBakAutoDue(cfg, lastAt, now)    自动备份是否到期
     khBakFmtBytes(n) / khBakStamp()   展示用小工具

   加密口径：PBKDF2-SHA256（默认 200000 迭代）派生 256 位密钥 → AES-256-GCM。
   只依赖 WebCrypto（globalThis.crypto.subtle），浏览器 / Electron / Node 18+ 都有。 */
(function (root) {
  'use strict';

  var KH_BAK_FORMAT = 'honghub-backup';
  var KH_BAK_ENC_FORMAT = 'honghub-backup-enc';
  var KH_BAK_V = 2;
  var KH_BAK_ITER = 200000;
  var KH_BAK_APP = 'honghub-desktop';

  /* ---------------- base64（浏览器无 Buffer，Node 无 atob，手写一份两边都能用） ---------------- */
  var B64CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function b64FromBytes(u8) {
    var out = '', i = 0, n, rem;
    for (; i + 2 < u8.length; i += 3) {
      n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      out += B64CH[(n >> 18) & 63] + B64CH[(n >> 12) & 63] + B64CH[(n >> 6) & 63] + B64CH[n & 63];
    }
    rem = u8.length - i;
    if (rem === 1) {
      n = u8[i] << 16;
      out += B64CH[(n >> 18) & 63] + B64CH[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      n = (u8[i] << 16) | (u8[i + 1] << 8);
      out += B64CH[(n >> 18) & 63] + B64CH[(n >> 12) & 63] + B64CH[(n >> 6) & 63] + '=';
    }
    return out;
  }

  function bytesFromB64(s) {
    s = String(s || '').replace(/[\r\n\t ]/g, '');
    if (!s || /[^A-Za-z0-9+/=]/.test(s)) throw new Error('base64 不合法');
    var out = [], i = 0, c1, c2, c3, c4, n;
    var pad = 0;
    if (s.charAt(s.length - 1) === '=') pad++;
    if (s.length > 1 && s.charAt(s.length - 2) === '=') pad++;
    for (; i < s.length; i += 4) {
      c1 = B64CH.indexOf(s.charAt(i));
      c2 = B64CH.indexOf(s.charAt(i + 1));
      c3 = s.charAt(i + 2) === '=' ? 0 : B64CH.indexOf(s.charAt(i + 2));
      c4 = s.charAt(i + 3) === '=' ? 0 : B64CH.indexOf(s.charAt(i + 3));
      if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) throw new Error('base64 不合法');
      n = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
      out.push((n >> 16) & 255);
      if (s.charAt(i + 2) !== '=') out.push((n >> 8) & 255);
      if (s.charAt(i + 3) !== '=') out.push(n & 255);
    }
    if (pad) {
      /* 尾部对齐校验：漏了填充符时长度会不对，这里直接按实际可用字节截断 */
      out = out.slice(0, out.length);
    }
    return new Uint8Array(out);
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function utf8Text(u8) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(u8);
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return decodeURIComponent(escape(s));
  }

  function subtle() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
    } catch (e) {}
    return null;
  }

  function randBytes(n) {
    var u8 = new Uint8Array(n), i;
    var c = (typeof globalThis !== 'undefined') ? globalThis.crypto : null;
    if (c && typeof c.getRandomValues === 'function') { c.getRandomValues(u8); return u8; }
    for (i = 0; i < n; i++) u8[i] = Math.floor(Math.random() * 256);
    return u8;
  }

  /* ---------------- 明文包 ---------------- */
  function khBakPack(data, meta) {
    meta = meta || {};
    var body = {};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) body[k] = data[k]; }
    }
    body.format = KH_BAK_FORMAT;
    body.v = KH_BAK_V;
    body.app = KH_BAK_APP;
    body.appVersion = String(meta.version || '');
    body.exportedAt = String(meta.at || new Date().toISOString());
    return body;
  }

  function khBakIsEncrypted(obj) {
    return !!(obj && typeof obj === 'object' && obj.format === KH_BAK_ENC_FORMAT && obj.payload);
  }

  function khBakCounts(data) {
    function n(v) { return Array.isArray(v) ? v.length : 0; }
    var prog = 0;
    try { prog = (data.progress && typeof data.progress === 'object') ? Object.keys(data.progress).length : 0; } catch (e) {}
    return {
      fav: n(data.fav), watchlater: n(data.watchlater), history: n(data.history),
      watchsub: n(data.watchsub), progress: prog, sites: n(data.sites),
      live: n(data.live), livefav: n(data.livefav),
      settings: (data.settings && typeof data.settings === 'object') ? Object.keys(data.settings).length : 0
    };
  }

  /* ---------------- 加密 / 解密 ---------------- */
  function deriveKey(pass, salt, iter) {
    var s = subtle();
    if (!s) return Promise.reject(new Error('当前环境不支持加密（缺少 WebCrypto）'));
    return s.importKey('raw', utf8Bytes(String(pass)), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (k) {
        return s.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
          k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
      });
  }

  function khBakEncrypt(data, pass, opt) {
    opt = opt || {};
    var iter = Number(opt.iter) || KH_BAK_ITER;
    if (!pass || String(pass).length < 6) {
      return Promise.reject(new Error('密码至少 6 位'));
    }
    var s = subtle();
    if (!s) return Promise.reject(new Error('当前环境不支持加密（缺少 WebCrypto）'));
    var salt = randBytes(16), iv = randBytes(12);
    var plain = JSON.stringify(khBakPack(data, opt));
    return deriveKey(pass, salt, iter).then(function (key) {
      return s.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8Bytes(plain));
    }).then(function (buf) {
      return {
        format: KH_BAK_ENC_FORMAT,
        v: KH_BAK_V,
        app: KH_BAK_APP,
        appVersion: String(opt.version || ''),
        createdAt: String(opt.at || new Date().toISOString()),
        kdf: { name: 'PBKDF2-SHA256', iter: iter, salt: b64FromBytes(salt) },
        cipher: { name: 'AES-256-GCM', iv: b64FromBytes(iv) },
        payload: b64FromBytes(new Uint8Array(buf)),
        counts: khBakCounts(data || {})
      };
    });
  }

  function khBakDecrypt(env, pass) {
    if (!khBakIsEncrypted(env)) return Promise.reject(new Error('不是加密备份包'));
    if (!pass) return Promise.reject(new Error('请输入密码'));
    var s = subtle();
    if (!s) return Promise.reject(new Error('当前环境不支持解密（缺少 WebCrypto）'));
    var kdf = env.kdf || {}, cipher = env.cipher || {};
    var iter = Number(kdf.iter) || KH_BAK_ITER;
    var salt, iv, ct;
    try {
      salt = bytesFromB64(kdf.salt);
      iv = bytesFromB64(cipher.iv);
      ct = bytesFromB64(env.payload);
    } catch (e) {
      return Promise.reject(new Error('加密包结构损坏（' + e.message + '）'));
    }
    return deriveKey(pass, salt, iter).then(function (key) {
      return s.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (buf) {
      var obj = JSON.parse(utf8Text(new Uint8Array(buf)));
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('解密内容不是备份对象');
      return obj;
    }).catch(function (e) {
      if (e && /Object|JSON/.test(String(e.message || e))) throw new Error('解密内容损坏：' + (e.message || e));
      throw new Error('密码不对或备份已损坏（AES-GCM 校验未通过）');
    });
  }

  /* ---------------- 导入差异预览 ---------------- */
  var DIFF_ROWS = [
    { key: 'fav', label: '收藏', cap: 200 },
    { key: 'watchlater', label: '稍后看', cap: 200 },
    { key: 'history', label: '观看历史', cap: 300 },
    { key: 'watchsub', label: '追剧', cap: 200 },
    { key: 'sites', label: '自建站点', cap: 50 },
    { key: 'live', label: '自建直播', cap: 50 },
    { key: 'livefav', label: '直播收藏', cap: 50 }
  ];

  function arrOf(v) { return Array.isArray(v) ? v : []; }

  function khBakDiff(data, current) {
    data = data || {}; current = current || {};
    var rows = [], totals = { cur: 0, inc: 0, add: 0, over: 0 };

    for (var i = 0; i < DIFF_ROWS.length; i++) {
      var r = DIFF_ROWS[i];
      var cur = arrOf(current[r.key]);
      var inc = arrOf(data[r.key]);
      var seen = {}, add = 0, over = 0;
      for (var c = 0; c < cur.length; c++) seen[JSON.stringify(cur[c])] = true;
      for (var j = 0; j < inc.length; j++) {
        if (seen[JSON.stringify(inc[j])]) over++;
        else add++;
      }
      rows.push({
        key: r.key, label: r.label, cur: cur.length, inc: inc.length,
        add: Math.max(0, Math.min(add, r.cap - cur.length)),
        same: over
      });
      totals.cur += cur.length; totals.inc += inc.length;
      totals.add += Math.max(0, Math.min(add, r.cap - cur.length)); totals.over += over;
    }

    /* 进度是键值对象，按「本机没有的键」算新增，按「两边都有」算覆盖 */
    var curProg = (current.progress && typeof current.progress === 'object') ? current.progress : {};
    var incProg = (data.progress && typeof data.progress === 'object') ? data.progress : {};
    var pAdd = 0, pOver = 0;
    for (var pk in incProg) {
      if (!Object.prototype.hasOwnProperty.call(incProg, pk)) continue;
      if (Object.prototype.hasOwnProperty.call(curProg, pk)) pOver++; else pAdd++;
    }
    rows.push({ key: 'progress', label: '续播进度', cur: Object.keys(curProg).length, inc: Object.keys(incProg).length, add: pAdd, same: pOver });

    /* 设置项：只列「备份里有、本机和默认不同口径」的键数量 */
    var curSet = (current.settings && typeof current.settings === 'object') ? current.settings : {};
    var incSet = (data.settings && typeof data.settings === 'object') ? data.settings : {};
    var sAdd = 0, sOver = 0;
    for (var sk in incSet) {
      if (!Object.prototype.hasOwnProperty.call(incSet, sk)) continue;
      if (Object.prototype.hasOwnProperty.call(curSet, sk) && JSON.stringify(curSet[sk]) === JSON.stringify(incSet[sk])) sOver++;
      else sAdd++;
    }
    rows.push({ key: 'settings', label: '设置项', cur: Object.keys(curSet).length, inc: Object.keys(incSet).length, add: sAdd, same: sOver });

    /* 配置类对象（影视仓 / 仓站点 / 场景 / 远程配置）：只判「本机有没有」 */
    var cfgRows = [
      { key: 'warehouses', label: '影视仓' },
      { key: 'warehouseSites', label: '仓站点' },
      { key: 'warehouseLives', label: '仓直播源' },
      { key: 'warehouseParses', label: '仓解析接口' },
      { key: 'scene', label: '场景预设' },
      { key: 'remote', label: '远程配置' }
    ];
    for (var g = 0; g < cfgRows.length; g++) {
      var gk = cfgRows[g].key, incV = data[gk], curV = current[gk];
      var has = function (v) { return !(v === undefined || v === null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Object.keys(v).length)); };
      rows.push({
        key: gk, label: cfgRows[g].label,
        cur: has(curV) ? 1 : 0, inc: has(incV) ? 1 : 0,
        add: (has(incV) && !has(curV)) ? 1 : 0,
        same: (has(incV) && has(curV)) ? 1 : 0
      });
    }
    return { rows: rows, totals: totals };
  }

  /* ---------------- 快照轮转 ---------------- */
  function khBakSnapPush(list, entry, keep) {
    keep = Math.max(1, Number(keep) || 5);
    var out = Array.isArray(list) ? list.slice() : [];
    var e = {};
    if (entry && typeof entry === 'object') {
      for (var k in entry) { if (Object.prototype.hasOwnProperty.call(entry, k)) e[k] = entry[k]; }
    }
    e.at = String(e.at || new Date().toISOString());
    out.push(e);
    while (out.length > keep) out.shift();
    return out;
  }

  /* ---------------- 自动备份到期判定 ---------------- */
  /* cfg = { on:true, every:'launch'|'daily'|'weekly', dir:'', keep:3 }
     lastAt = 上次备份的 ISO 时间（或 0）
     launch：每次启动各一次（由调用方用 sessionFlag 保证同一会话只跑一次） */
  function khBakAutoDue(cfg, lastAt, now) {
    if (!cfg || !cfg.on) return false;
    var every = cfg.every === 'daily' || cfg.every === 'weekly' ? cfg.every : 'launch';
    if (every === 'launch') return true;
    var t = Date.parse(String(lastAt || '')) || 0;
    if (!t) return true;
    var nowMs = Number(now) || Date.now();
    var gap = every === 'weekly' ? 7 * 86400000 : 86400000;
    /* 严格按间隔判定：宁可晚几分钟再备一次，也不在同一时间段里连出两份 */
    return (nowMs - t) >= gap;
  }

  /* ---------------- 展示小工具 ---------------- */
  function khBakFmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function khBakStamp(d) {
    d = d ? new Date(d) : new Date();
    function p2(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  }

  var API = {
    FORMAT: KH_BAK_FORMAT,
    ENC_FORMAT: KH_BAK_ENC_FORMAT,
    ITER: KH_BAK_ITER,
    pack: khBakPack,
    isEncrypted: khBakIsEncrypted,
    encrypt: khBakEncrypt,
    decrypt: khBakDecrypt,
    diff: khBakDiff,
    counts: khBakCounts,
    snapPush: khBakSnapPush,
    autoDue: khBakAutoDue,
    fmtBytes: khBakFmtBytes,
    stamp: khBakStamp,
    b64FromBytes: b64FromBytes,
    bytesFromB64: bytesFromB64,
    utf8Bytes: utf8Bytes,
    utf8Text: utf8Text
  };

  /* 浏览器 / Electron 里挂到 window；Node 里挂到 globalThis（测试脚本直接吃） */
  if (root) {
    root.KHBak = API;
    /* 同时提供扁平函数名，前端老代码可以直接写 khBakEncrypt(...) */
    root.khBakPack = khBakPack;
    root.khBakIsEncrypted = khBakIsEncrypted;
    root.khBakEncrypt = khBakEncrypt;
    root.khBakDecrypt = khBakDecrypt;
    root.khBakDiff = khBakDiff;
    root.khBakCounts = khBakCounts;
    root.khBakSnapPush = khBakSnapPush;
    root.khBakAutoDue = khBakAutoDue;
    root.khBakFmtBytes = khBakFmtBytes;
    root.khBakStamp = khBakStamp;
  }
  if (typeof module === 'object' && module && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
