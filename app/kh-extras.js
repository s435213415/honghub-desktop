/* 鸿汇影 · 增值层（1.7.97）
   五件事，全部只在本机生效，任何失败都静默，不影响播放主链路：
   1) CSP 观察：report-only 阶段只累计违规条数（kh_csp_log，最多 100 条），不改变任何行为
   2) 按片记忆倍速：kh_rate_map = {片id: 倍速}，换片自动套用，忘了就沿用全局 kh_rate
   3) 片头跳过：kh_intro_map = {片id: 秒}，已记过的片起播自动跳，按钮可手动跳/重新记
   4) A-B 循环：只在当前片内存里生效，不落盘，重开即清除
   5) 本地短评：kh_rev = {片id: {t, ts}}，最多 200 片，只存本机、不上传
   依赖 kh-core.js / kh-app.js 暴露的 window.state / els / toast（同为普通 script，顶层 var 即 window 属性）。 */
(function () {
  'use strict';
  var W = window;
  var MAP_MAX = 500;      /* 倍速/片头映射上限，防无限增长 */
  var REV_MAX = 200;      /* 短评片数上限 */

  /* 统一走 kh-core 的 getStore/setStore：kh_ 前缀的键在 1.7.83 之后带封条校验，
     绕过它直接写 localStorage 会让下次 getStore 判为损坏并回退默认值。 */
  function lsGet(k, dft) {
    try {
      if (typeof W.getStore === 'function') return W.getStore(k, dft);
      var s = W.localStorage.getItem(k);
      if (s == null) return dft;
      var v = JSON.parse(s);
      return v == null ? dft : v;
    } catch (e) { return dft; }
  }
  function lsSet(k, v) {
    try {
      if (typeof W.setStore === 'function') { W.setStore(k, v); return; }
      W.localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  }
  function movie() {
    var st = W.state;
    if (!st || !st.movie) return null;
    if (st.movie.live) return null;   /* 直播没有片头/倍速记忆的意义 */
    return st.movie;
  }
  function mid() {
    var m = movie();
    if (!m) return '';
    return String(m.id || m.title || '').slice(0, 64);
  }
  function video() { return (W.els && W.els.video) || document.getElementById('video'); }
  function tip(t) { try { if (typeof W.toast === 'function') W.toast(t); } catch (e) {} }

  /* ---------- 1) CSP 观察 ---------- */
  try {
    var cspState = { n: 0 };
    document.addEventListener('securitypolicyviolation', function (e) {
      try {
        cspState.n++;
        var log = lsGet('kh_csp_log', []);
        if (!Array.isArray(log)) log = [];
        log.unshift({ d: String(e.effectiveDirective || e.violatedDirective || '').slice(0, 40), u: String(e.blockedURI || '').slice(0, 120), t: Date.now() });
        lsSet('kh_csp_log', log.slice(0, 100));
        var dg = document.getElementById('diag');
        if (dg) dg.setAttribute('data-csp', String(cspState.n));
      } catch (e2) {}
    });
    var oldLog = lsGet('kh_csp_log', []);
    var dg0 = document.getElementById('diag');
    if (dg0) dg0.setAttribute('data-csp', String(Array.isArray(oldLog) ? oldLog.length : 0));
    W.KH_CSP = {
      count: function () { return cspState.n; },
      list: function () { return lsGet('kh_csp_log', []); },
      clear: function () { lsSet('kh_csp_log', []); }
    };
  } catch (e) {}

  /* ---------- 2) 按片倍速 ---------- */
  try {
    function rateMap() {
      var m = lsGet('kh_rate_map', {});
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    }
    function saveRate(r) {
      var id = mid(); if (!id) return;
      var m = rateMap();
      m[id] = r;
      var keys = Object.keys(m);
      if (keys.length > MAP_MAX) { for (var i = 0; i < keys.length - MAP_MAX; i++) delete m[keys[i]]; }
      lsSet('kh_rate_map', m);
    }
    function applySavedRate() {
      var v = video(), st = W.state;
      var id = mid(); if (!v || !st) return;
      var r = id ? Number(rateMap()[id]) : 0;
      if (!r || !isFinite(r) || r < 0.5 || r > 3) r = Number(st.rate) || 1;  /* 没记过就沿用当前全局值 */
      try { v.playbackRate = r; } catch (e) {}
      st.rate = r;
      var b = W.els && W.els.btnRate;
      if (b) {
        b.textContent = (Math.round(r * 100) / 100).toFixed(2).replace(/0$/, '') + '×';
        b.classList.toggle('on', Math.abs(r - 1) > 0.001);
      }
      try { if (typeof W.setDiag === 'function') W.setDiag('rate', r); } catch (e) {}
    }
    var lastAppliedId = '';
    function onMeta() { var id = mid(); if (id !== lastAppliedId) { lastAppliedId = id; applySavedRate(); } }
    var v0 = video();
    if (v0) {
      v0.addEventListener('loadedmetadata', onMeta);
      v0.addEventListener('ratechange', function () {
        var r = v0.playbackRate;
        if (!mid()) return;
        if (Math.abs(r - 1) < 0.001 || (r >= 0.5 && r <= 3)) saveRate(r);
      });
    }
  } catch (e) {}

  /* ---------- 3) 片头跳过 ---------- */
  try {
    function introMap() {
      var m = lsGet('kh_intro_map', {});
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    }
    function introOf(id) { return Number(introMap()[id]) || 0; }
    function rememberIntro(sec) {
      var id = mid(); if (!id) return false;
      var m = introMap();
      m[id] = Math.max(0, Math.round(sec));
      var keys = Object.keys(m);
      if (keys.length > MAP_MAX) { for (var i = 0; i < keys.length - MAP_MAX; i++) delete m[keys[i]]; }
      lsSet('kh_intro_map', m);
      return true;
    }
    function autoSkipIntro() {
      var v = video(); var id = mid(); if (!v || !id) return;
      var sec = introOf(id);
      if (sec > 0 && isFinite(v.duration) && v.duration > sec + 3 && v.currentTime < sec) {
        try { v.currentTime = sec; } catch (e) {}
        tip('已跳过片头 ' + sec + ' 秒');
      }
    }
    var v1 = video();
    if (v1) v1.addEventListener('loadedmetadata', autoSkipIntro);
    var btn = document.getElementById('btnIntro');
    if (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var v = video(); var id = mid();
        if (!v || !id) { tip('直播或未在播放，无法记录片头'); return; }
        var sec = introOf(id);
        if (sec > 0) {
          try { v.currentTime = sec; } catch (e) {}
          tip('已跳到片头结束（' + sec + ' 秒）。长按可重新记录当前位置为片头');
          return;
        }
        if (v.currentTime < 5) { tip('当前位置不足 5 秒，播到片头结束后再点一次即可记录'); return; }
        rememberIntro(v.currentTime);
        tip('已把 ' + Math.round(v.currentTime) + ' 秒记为本片片头，之后起播自动跳');
      });
      btn.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        var v = video(); var id = mid();
        if (!v || !id) return;
        if (v.currentTime < 5) { tip('当前位置不足 5 秒，无法记为片头'); return; }
        rememberIntro(v.currentTime);
        tip('已重新记为片头：' + Math.round(v.currentTime) + ' 秒');
      });
    }
    W.KH_INTRO = { get: introOf, set: rememberIntro, clear: function () { var id = mid(); var m = introMap(); if (id) { delete m[id]; lsSet('kh_intro_map', m); tip('已清除本片片头记录'); } } };
  } catch (e) {}

  /* ---------- 4) A-B 循环 ---------- */
  try {
    var ab = { a: 0, b: 0, on: false };
    function abLabel() {
      var btn = document.getElementById('btnAB');
      if (!btn) return;
      if (!ab.on) { btn.textContent = '🔁 A-B'; btn.classList.remove('on'); }
      else if (!ab.b) { btn.textContent = '🔁 A ' + Math.round(ab.a) + 's'; btn.classList.add('on'); }
      else { btn.textContent = '🔁 ' + Math.round(ab.a) + '–' + Math.round(ab.b) + 's'; btn.classList.add('on'); }
    }
    var btnAB = document.getElementById('btnAB');
    if (btnAB) {
      btnAB.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var v = video();
        if (!v || !mid()) { tip('直播或未在播放，A-B 不可用'); return; }
        if (!ab.on) { ab.on = true; ab.a = v.currentTime; ab.b = 0; tip('已设 A 点 ' + Math.round(ab.a) + ' 秒，再点设 B 点'); }
        else if (!ab.b) {
          if (v.currentTime <= ab.a + 1) { tip('B 点要在 A 点之后（至少差 1 秒）'); return; }
          ab.b = v.currentTime; tip('已设 B 点 ' + Math.round(ab.b) + ' 秒，开始循环');
        } else { ab.on = false; ab.a = 0; ab.b = 0; tip('已取消 A-B 循环'); }
        abLabel();
      });
    }
    var v2 = video();
    if (v2) v2.addEventListener('timeupdate', function () {
      if (!ab.on || !ab.b) return;
      if (v2.currentTime >= ab.b || v2.currentTime < ab.a - 0.5) {
        try { v2.currentTime = ab.a; } catch (e) {}
      }
    });
    abLabel();
  } catch (e) {}

  /* ---------- 5) 本地短评 ---------- */
  try {
    var box = document.getElementById('khRevBox');
    var input = document.getElementById('khRevInput');
    var saveBtn = document.getElementById('khRevSave');
    var lastEl = document.getElementById('khRevLast');
    var shownId = '';

    function revMap() {
      var m = lsGet('kh_rev', {});
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    }
    function renderRev() {
      var id = mid();
      if (!id) { if (box) box.style.display = 'none'; shownId = ''; return; }
      if (box) box.style.display = '';
      if (id !== shownId) { shownId = id; if (input) input.value = ''; }
      var rec = revMap()[id];
      if (lastEl) {
        lastEl.innerHTML = rec && rec.t
          ? '我的短评：<b>' + String(rec.t).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }) + '</b>' +
            (rec.ts ? ' <span style="opacity:.6">· ' + new Date(rec.ts).toLocaleDateString('zh-CN') + '</span>' : '')
          : '<span style="opacity:.65">本片还没有短评，写一句留给自己看</span>';
      }
    }
    function saveRev() {
      var id = mid(); if (!id || !input) return;
      var t = String(input.value || '').trim().slice(0, 60);
      if (!t) { tip('短评不能为空'); return; }
      var m = revMap();
      m[id] = { t: t, ts: Date.now() };
      var keys = Object.keys(m);
      if (keys.length > REV_MAX) {
        /* 超上限时丢最老的记录，而不是随机丢 */
        keys.sort(function (x, y) { return (m[x].ts || 0) - (m[y].ts || 0); });
        for (var i = 0; i < keys.length - REV_MAX; i++) delete m[keys[i]];
      }
      lsSet('kh_rev', m);
      tip('短评已保存到本机');
      shownId = ''; renderRev();
    }
    if (saveBtn) saveBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); saveRev(); });
    if (input) input.addEventListener('keydown', function (ev) {
      ev.stopPropagation();   /* 别让空格/方向键触发播放器快捷键 */
      if (ev.key === 'Enter') { ev.preventDefault(); saveRev(); }
    });
    var v3 = video();
    if (v3) v3.addEventListener('loadedmetadata', function () { shownId = ''; renderRev(); });
    setInterval(renderRev, 600);
    W.KH_REVIEW = { get: function (id) { return revMap()[id || mid()] || null; }, all: revMap, remove: function (id) { var m = revMap(); delete m[id || mid()]; lsSet('kh_rev', m); shownId = ''; renderRev(); } };
  } catch (e) {}
})();
