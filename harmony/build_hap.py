#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HongHub HAP（深开鸿 KaihongOS / OpenHarmony）构建脚本
-----------------------------------------------------------
把复用的纯前端影站（桌面版 app/ 已构建好的前端）改造成可在深开鸿端运行的 HAP 工程：

  1) 把前端整体拷入 entry/src/main/resources/rawfile/www/
  2) 中和桌面专属开关（KH_DESKTOP），注入 HAP 专属适配（KH_HARMONY）
  3) 自动写入「桌面中枢（hub）」网络地址：默认取本机局域网 IP:8787，
     也可用环境变量 KH_HUB 指定（如 KH_HUB=http://192.168.1.50:8787）。
     这样 HAP 装到深开鸿设备后默认就能连上桌面端，无需手动填地址。
  4) 让 /api/* 自动走中枢；内置免代码「中枢地址」面板可随时改；
     深开鸿端因此成为桌面端的随身客户端（看片 + 远程看板 + 触发自愈/自治）。

用法：
    python build_hap.py                # 默认中枢 = 本机局域网IP:8787
    KH_HUB=http://192.168.1.50:8787 python build_hap.py

产物：
    harmony/entry/src/main/resources/rawfile/www/index.html
然后用 DevEco Studio 打开 harmony/ 工程 → 自动签名 → 运行到 KaihongOS 设备。
"""
import os, json, shutil, sys, socket

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_APP = os.path.normpath(os.path.join(ROOT, '..', 'app'))            # 桌面版已构建前端
ALT_SRC = os.path.normpath(os.path.join(ROOT, '..', '..', 'HongHubMovie',
    'entry', 'src', 'main', 'resources', 'rawfile', 'movie-site'))     # 纯净源（可选）
WWW = os.path.join(ROOT, 'entry', 'src', 'main', 'resources', 'rawfile', 'www')
FEATURES_FILE = os.path.normpath(os.path.join(ROOT, '..', 'features', 'manifest.json'))
STAMP_FILE = os.path.normpath(os.path.join(ROOT, '..', 'server', 'feature-version.json'))

PRODUCT_NAME = os.environ.get('PRODUCT_NAME') or '鸿汇影'


def lan_ip():
    """探测本机局域网 IPv4（用于默认中枢地址）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


def default_hub():
    # 环境变量优先（可填任意可达地址：局域网IP / 公网IP / DDNS 均可）
    env = (os.environ.get('KH_HUB') or '').strip().rstrip('/')
    if env:
        return env
    ip = lan_ip()
    # 防止把「受限地址」写死：拿不到真实局域网地址（仅回环）时留空，
    # 由深开鸿端「🛰️ 中枢 → 设置」面板填写，真正实现「不限网络地址」。
    if not ip or ip in ('127.0.0.1', 'localhost', '0.0.0.0'):
        return ''
    return 'http://%s:8787' % ip


def lan_ips():
    """枚举本机所有 IPv4（多网卡 / 路由器重新分配 IP 都能覆盖）。"""
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
            ip = info[4][0]
            if ip not in ('127.0.0.1', '0.0.0.0') and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        if ip not in ('127.0.0.1', '0.0.0.0') and ip not in ips:
            ips.append(ip)
    except Exception:
        pass
    finally:
        s.close()
    return ips


def hub_candidates():
    """生成供深开鸿端启动时并行探测的地址列表（注入为 JS 数组字面量）。"""
    out = []
    for ip in lan_ips():
        for port in (8787, 8788):
            u = 'http://%s:%d' % (ip, port)
            if u not in out:
                out.append(u)
    env = (os.environ.get('KH_HUB') or '').strip().rstrip('/')
    if env:
        out.insert(0, env)
    return json.dumps(out[:16], ensure_ascii=False)


HAP_BLOCK = r'''
/* ===================== 深开鸿 KaihongOS / OpenHarmony 端适配 ===================== */
(function () {
  if (!window.KH_HARMONY) return;
  var KH_HUB_DEFAULT = '__KH_HUB_DEFAULT__';
  var KH_HUB_CANDIDATES = __KH_HUB_CANDIDATES__;   // 构建时写入的本机所有可达地址
  var KH_HUB = (function () {
    try { return (localStorage.getItem('khHub') || KH_HUB_DEFAULT || '').replace(/\/+$/, ''); }
    catch (e) { return (KH_HUB_DEFAULT || ''); }
  })();
  // 始终跟随操作系统（桌面中枢）版本：本机版本基线在首次成功同步时锁定为中枢当前版本，
  // 之后只有中枢发布「更高」版本才提示更新；重装后基线随 OS 版本自动对齐。
  var khSynced = false;
  window.KH_APP_CODE = 0;

  function khAccessToken() { try { return localStorage.getItem('khHubToken') || ''; } catch (e) { return ''; } }
  function khHeaders(o) {
    o = o || {}; var t = khAccessToken();
    if (t) {
      var h = o.headers;
      if (!h || typeof h !== 'object' || typeof h.append !== 'function') {
        o.headers = Object.assign({}, (h && typeof h === 'object') ? h : {}, { 'X-KH-Access-Token': t });
      }
    }
    return o;
  }
  // 让 /api/* 请求自动路由到桌面中枢（hub）；可选口令随请求自动带上
  try {
    var _f = window.fetch ? window.fetch.bind(window) : null;
    if (_f) {
      window.fetch = function (u, o) {
        o = khHeaders(o);
        if (typeof u === 'string' && u.indexOf('/api/') === 0 && KH_HUB) {
          u = KH_HUB + u; o = o || {}; o.mode = 'cors';
        }
        return _f(u, o);
      };
    }
  } catch (e) {}

  /* 中枢自动发现：IP 变了也能自己找回来。
     候选 = 上次成功地址 + 构建注入的本机所有 IP + 中枢 /health 下发的地址缓存 + 回环，
     并行探测 /health 且校验应用标识，命中即切换并记住；全部失败则保留原地址、不阻塞页面。 */
  function khHubList() {
    var out = [], seen = {};
    function add(u) {
      if (!u) return; u = String(u).replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(u) || seen[u]) return;
      seen[u] = 1; out.push(u);
    }
    try { add(localStorage.getItem('khHub')); } catch (e) {}
    add(KH_HUB_DEFAULT);
    (KH_HUB_CANDIDATES || []).forEach(add);
    try { JSON.parse(localStorage.getItem('khHubKnown') || '[]').forEach(add); } catch (e) {}
    add('http://127.0.0.1:8787');
    return out.slice(0, 14);
  }
  function khProbe(base) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 1400);
      function fin(v) { if (done) return; done = true; try { clearTimeout(timer); } catch (e) {} resolve(v); }
      try {
        window.fetch(base + '/health', { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (d) { fin(d && d.ok && d.app === 'HongHub-Desktop' ? d : null); })
          .catch(function () { fin(null); });
      } catch (e) { fin(null); }
    });
  }
  function khRememberHubs(d) {
    if (!d || !Array.isArray(d.hubs)) return;
    try {
      var known = [];
      try { known = JSON.parse(localStorage.getItem('khHubKnown') || '[]'); } catch (e) {}
      d.hubs.forEach(function (u) { if (known.indexOf(u) < 0) known.push(u); });
      localStorage.setItem('khHubKnown', JSON.stringify(known.slice(-20)));
    } catch (e) {}
  }
  function khDiscoverHub(cb) {
    var list = khHubList();
    if (!list.length) { cb(false); return; }
    var idx = 0, active = 0, finished = false, found = false;
    function next() {
      if (finished) return;
      if (idx >= list.length) { if (active === 0 && !finished) { finished = true; cb(found); } return; }
      var base = list[idx++]; active++;
      khProbe(base).then(function (d) {
        active--;
        if (!finished && d) {
          found = true; finished = true; khRememberHubs(d);
          if (KH_HUB !== base) {
            KH_HUB = base;
            try { localStorage.setItem('khHub', base); } catch (e) {}
            try { khShowToast('🛰️ 中枢已自动切换：' + base); } catch (e) {}
          }
          cb(true); return;
        }
        next();
      });
    }
    for (var i = 0; i < Math.min(6, list.length); i++) next();
    setTimeout(function () { if (!finished) { finished = true; cb(found); } }, 6000);
  }

  // 设备画像（深开鸿端）：版本始终跟随中枢 / OS，不写死
  var khRel = (function () {
    try { var s = document.getElementById('kh-release'); return JSON.parse(s.textContent || s.innerHTML || '{}'); }
    catch (e) { return {}; }
  })();
  var khLocalVer = (khRel.latest && khRel.latest.versionName) || '1.7.0';
  var khLocalCode = Number(khRel.latest && khRel.latest.versionCode) || 0;
  // OS 版本跟随：从 ArkWeb UA 动态解析系统版本与 API 等级，不写死单一版本；
  // 回传中枢后由 device-optimizer 生成对应版本的兼容策略并自动下发同步更新。
  var khOsVer = (function(){
    var ua = navigator.userAgent || '';
    var m = /(?:KaihongOS|OpenHarmony|HarmonyOS)[\/\s]*([\d.]+)/i.exec(ua) ||
            /(?:Windows NT|Android|Mac OS X|iPhone OS)[\/\s]*([\d.]+)/i.exec(ua);
    return m ? m[1] : 'unknown';
  })();
  var khApi = (function(){ var m = /API\s*(\d+)/i.exec(navigator.userAgent || ''); return m ? Number(m[1]) : 11; })();
  var khDeviceProfile = {
    marketName: '深开鸿 KaihongOS', deviceType: 'tablet', model: 'HongHub-Harmony',
    abi: 'harmony', osFullName: 'KaihongOS ' + khOsVer, osVersion: khOsVer,
    ua: navigator.userAgent || '', apiVersion: khApi, minApi: 9, targetApi: khApi,
    tier: 'high', screenW: window.innerWidth || 1280, screenH: window.innerHeight || 720,
    densityDPI: 240, appVersion: khLocalVer + '-harmony', appCode: khLocalCode
  };
  try { window.__khSetDeviceProfile(khDeviceProfile); } catch (e) {}

  // 与桌面中枢保持同步（源清单 / 版本 / 扩展功能 / 自治状态 / 最终成品 / 反馈），无需重装
  var khLastGovern = null;
  var khLastFinal = null;      // 接收所有最终成品：中枢最近一次治理的全部产出
  var khFeedbacks = [];        // 自动反馈通道（含深开鸿端回传的成品）
  function sync() {
    if (!KH_HUB || !window.fetch) return;
    // 只要连上一次，就缓存中枢当前所有可达地址；日后 IP 变化可据此自动找回
    window.fetch(KH_HUB + '/health', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { khRememberHubs(d); }).catch(function () {});
    window.fetch(KH_HUB + '/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.sources) window.__khApplySources(JSON.stringify(d.sources));
        if (d && d.release) window.__khSetRelease(JSON.stringify(d.release));
        var lat = d && d.release && d.release.latest;
        if (lat) {
          var hubCode = Number(lat.versionCode);
          // 始终跟随操作系统版本：以最近一次同步到的中枢版本作为本机基线
          var base = 0; try { base = Number(localStorage.getItem('khFollowedCode') || 0); } catch (e) {}
          if (!base) { try { localStorage.setItem('khFollowedCode', String(hubCode)); } catch (e) {} base = hubCode; }
          window.KH_APP_CODE = base;
          khSynced = true;
          if (hubCode > base) khShowHarmonyUpdateBanner(lat);
        }
      }).catch(function () {});
    // 功能随发版同步：一次拿到版本快照 + 完整功能清单，面板显示「功能 vX · N 项」
    window.fetch(KH_HUB + '/api/features/sync', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && Array.isArray(d.features)) window.__khLoadFeatures(d.features, d.version); }).catch(function () {});
    // 拉取中枢「自动优化 / 自治」状态，深开鸿端实时呈现
    window.fetch(KH_HUB + '/api/govern', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.lastRun) { khLastGovern = d.lastRun; khRenderHub(); } }).catch(function () {});
    // 接收所有最终成品：拉取中枢治理产出 + 自动反馈通道
    window.fetch(KH_HUB + '/api/feedback', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.finalProducts) { khLastFinal = d.finalProducts; khRenderFinal(); }
        if (d && Array.isArray(d.feedback)) { khFeedbacks = d.feedback; khRenderFinal(); }
      }).catch(function () {});
  }
  khDiscoverHub(function () { sync(); });
  setInterval(sync, 15000);
  setInterval(function () { khDiscoverHub(function () {}); }, 120000);  // 每 2 分钟复核一次中枢可达性

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function khFmtTime(ts) {
    if (!ts) return '暂无';
    try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(ts); }
  }

  // 轻量提示条（优化结果反馈）
  function khShowToast(msg) {
    try {
      var t = document.getElementById('khHarmonyToast');
      if (!t) {
        t = document.createElement('div'); t.id = 'khHarmonyToast';
        t.setAttribute('style', 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9997;background:#1B2233;color:#E7ECF5;border:1px solid #3A4256;border-radius:10px;padding:8px 12px;font:12px/1.4 sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.5);max-width:92vw');
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.display = 'block';
      clearTimeout(t._t); t._t = setTimeout(function () { t.style.display = 'none'; }, 5200);
    } catch (e) {}
  }

  // 自动更新检查：发现中枢发布的新版本即提示（深开鸿端也能自动更新）
  function khHarmonyUpdateCheck() {
    if (!KH_HUB || !window.fetch || !khSynced) return;   // 先完成首次同步建立基线，避免误报
    window.fetch(KH_HUB + '/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        var lat = d && d.release && d.release.latest;
        if (!lat) return;
        if (Number(lat.versionCode) > Number(window.KH_APP_CODE || 0)) khShowHarmonyUpdateBanner(lat);
      }).catch(function () {});
  }
  function khShowHarmonyUpdateBanner(lat) {
    try {
      if (document.getElementById('khHarmonyUpdateBanner')) return;
      try { if (localStorage.getItem('khHarmonyDismissed') === String(lat.versionCode)) return; } catch (e) {}
      var url = KH_HUB + (lat.hapUrl || '/download/honghub-harmony.hap');
      var shaTip = lat.hapSha256 ? '<div style="color:#9AA6C4;font-size:11px;margin-top:4px">SHA256 ' + esc(String(lat.hapSha256).slice(0, 16)) + '… · 下载后请核对</div>' : '';
      var b = document.createElement('div'); b.id = 'khHarmonyUpdateBanner';
      b.setAttribute('style', 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9996;background:#1B2233;color:#E7ECF5;border:1px solid #3A4256;border-radius:12px;padding:10px 14px;font:13px/1.4 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:92vw');
      b.innerHTML = '🆕 发现新版本 v' + esc(lat.versionName) + '（#' + esc(lat.versionCode) + '） <button id="khUpdBtn" style="border:0;border-radius:8px;padding:4px 10px;background:#2563EB;color:#fff;cursor:pointer;margin-left:6px">⬇️ 下载更新包</button> <span id="khUpdClose" style="cursor:pointer;margin-left:6px;color:#9AA6C4">✕</span>' + shaTip +
        '<div style="color:#9AA6C4;font-size:11px;margin-top:4px">下载后由系统安装器 / hdc 完成安装（应用内不静默安装）</div>';
      document.body.appendChild(b);
      document.getElementById('khUpdBtn').onclick = function () { window.open(url, '_blank'); khShowToast('📦 更新包开始下载，请核对 SHA256 后在系统安装器中安装'); };
      document.getElementById('khUpdClose').onclick = function () { try { localStorage.setItem('khHarmonyDismissed', String(lat.versionCode)); } catch (e) {} b.style.display = 'none'; };
    } catch (e) {}
  }
  khHarmonyUpdateCheck();
  setInterval(khHarmonyUpdateCheck, 15000);

  // 设备端触发「自动优化」：驱动桌面中枢执行 提取问题→自愈→优化→发布→补装功能
  var khOptBtn = null;
  function khHarmonyOptimize() {
    if (!KH_HUB || !window.fetch) { khShowToast('⚠️ 未连接中枢，无法优化'); return; }
    if (khOptBtn) { khOptBtn.disabled = true; khOptBtn.textContent = '🤖 优化中…'; }
    window.fetch(KH_HUB + '/api/govern/run', { method: 'POST', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var res = d && d.result && d.result.result;
        if (d && d.ok && res) {
          if (res.published && res.published.skipped) {
            khShowToast('✅ 已优化：无实质变化，无需发新版（移除坏源 ' + (res.optimized && res.optimized.removed) + ' 条，新增功能 ' + ((res.featuresAdded) || []).length + ' 个）');
          } else {
            khShowToast('✅ 已优化并发布：移除坏源 ' + (res.optimized && res.optimized.removed) + ' 条，新增功能 ' + ((res.featuresAdded) || []).length + ' 个，版本升至 ' + ((res.published && res.published.versionName) || '') + '（深开鸿端将自动提示更新）');
          }
        } else {
          khShowToast('⚠️ 优化失败：' + ((d && d.result && d.result.error) || '未知错误'));
        }
        sync();
      })
      .catch(function (e) { khShowToast('⚠️ 优化请求失败：' + e); })
      .then(function () { if (khOptBtn) { khOptBtn.disabled = false; khOptBtn.textContent = '🤖 优化'; } });
  }
  // 自动优化：默认开启；每小时评估，距上次请求 > 6 小时且中枢可达才触发，避免频繁
  function khAutoOptimizeTick() {
    try { if (localStorage.getItem('khAutoOptimize') === '0') return; } catch (e) {}
    if (!KH_HUB || !window.fetch) return;
    var last = 0; try { last = Number(localStorage.getItem('khOptReqAt') || 0); } catch (e) {}
    if (Date.now() - last < 6 * 3600 * 1000) return;
    try { localStorage.setItem('khOptReqAt', String(Date.now())); } catch (e) {}
    khHarmonyOptimize();
  }
  setInterval(khAutoOptimizeTick, 60 * 60 * 1000);

  // 反馈回来：把本机诊断与「最终成品」回传中枢，并驱动中枢执行 自动优化/自动修复/自动更新 闭环
  function khHarmonyFeedback() {
    if (!KH_HUB || !window.fetch) { khShowToast('⚠️ 未连接中枢，无法反馈'); return; }
    khShowToast('📡 正在回传本机诊断与最终成品到中枢…');
    // 1) 走原有上报通道（兼容看板统计）
    var payload = {
      schema: 1, app: 'HongHubMovie',
      deviceId: 'harmony-' + (KH_HUB || 'local'), version: khLocalVer + '-harmony', device: 'KaihongOS', sentAt: Date.now(),
      issues: [{
        kind: 'harmony-heartbeat', sev: 'info',
        msg: '深开鸿端请求：自动优化 / 自动修复 / 自动更新', n: 1,
        ts: Date.now(), view: 'harmony', host: KH_HUB
      }]
    };
    try {
      window.fetch(KH_HUB + '/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (e) {}
    // 2) 接收所有最终成品：把本机产物回传中枢 /api/feedback（中枢纳入治理与反馈通道）
    try {
      var finalProducts = khLastFinal || {};
      window.fetch(KH_HUB + '/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device: 'KaihongOS', payload: {
            kind: 'harmony-final-products', sev: 'info',
            msg: '深开鸿端回传最终成品', n: 1, ts: Date.now(), view: 'harmony', host: KH_HUB,
            finalProducts: finalProducts, followedCode: window.KH_APP_CODE || 0
          }
        })
      }).catch(function () {});
    } catch (e) {}
    // 3) 驱动中枢执行 提取问题→建议提取→自动反馈→自动优化→加更新→自动更新加发布
    khHarmonyOptimize();
  }

  khHarmonyHubUI();
  khRenderHub();

  function khRenderHub() {
    try {
      var st = document.getElementById('khGovTime'); if (st) st.textContent = khFmtTime(khLastGovern && khLastGovern.finishedAt);
      var ok = document.getElementById('khGovOk'); if (ok) ok.textContent = (khLastGovern && khLastGovern.ok) ? '成功' : '未成功';
    } catch (e) {}
  }

  // 接收所有最终成品：把中枢治理产出的「建议 / 优化 / 更新 / 发布 / 反馈」在深开鸿端呈现
  function khRenderFinal() {
    try {
      var panel = document.getElementById('khFinalPanel');
      if (!panel) return;
      if (panel.style.display === 'none') return; // 用户收起时不刷新 DOM
      var h = '';
      if (khLastFinal) {
        var f = khLastFinal;
        var sugg = (f.suggestions || []).map(function (s) {
          return '<li>💡 ' + esc(s.title) + (s.detail ? ' <span style="color:#8A8FA3">（' + esc(s.detail) + '）</span>' : '') + '</li>';
        }).join('');
        var upd = f.updated || {};
        var pub = f.published || {};
        h += '<div style="font-weight:700;margin:6px 0 2px">🧠 建议提取（' + ((f.suggestions || []).length) + '）</div><ul style="margin:2px 0;padding-left:18px">' + (sugg || '<li style="color:#8A8FA3">暂无</li>') + '</ul>';
        h += '<div style="margin:4px 0;line-height:1.6">🔧 自动优化：<b style="color:#4ADE80">' + ((f.optimized && f.optimized.removed) || 0) + '</b> 条失效源已处理 · ' + ((f.optimized && f.optimized.channels) || 0) + ' 个频道<br>'
          + '🛠️ 加更新（自愈）：' + (upd.ok ? '✅ 成功' : '—') + (upd.skipped ? '（跳过：无问题）' : '') + '<br>'
          + '🚀 自动更新加发布：' + (pub.skipped ? '跳过（无实质变更，不发新版）' : (pub.ok ? ('已发布 v' + esc(pub.versionName) + ' #' + esc(pub.versionCode)) : '—')) + '</div>';
      } else {
        h += '<div style="color:#8A8FA3">尚未收到中枢产出，请先连接中枢或点击「🤖 优化」。</div>';
      }
      // 自动反馈通道（含深开鸿端回传）
      var fb = (khFeedbacks || []).slice(0, 8).map(function (x) {
        var t = khFmtTime(x.at || x.startedAt);
        var s = x.suggestions ? ('建议 ' + ((x.suggestions || []).length) + ' 条') : '';
        var ok = x.ok ? '✅' : '⚠️';
        return '<li>' + ok + ' ' + esc(t) + ' ' + esc((x.type || 'govern')) + (s ? ' · ' + esc(s) : '') + '</li>';
      }).join('');
      h += '<div style="font-weight:700;margin:6px 0 2px">📡 自动反馈（' + (khFeedbacks || []).length + '）</div><ul style="margin:2px 0;padding-left:18px">' + (fb || '<li style="color:#8A8FA3">暂无</li>') + '</ul>';
      panel.innerHTML = h;
    } catch (e) {}
  }

  function khHarmonyHubUI() {
    try {
      var bar = document.createElement('div'); bar.id = 'khHubBar';
      bar.setAttribute('style', 'position:fixed;left:8px;top:8px;z-index:9998;background:#1B2233;color:#E7ECF5;' +
        'border:1px solid #3A4256;border-radius:10px;padding:6px 8px;font:12px/1.3 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:94vw');
      var autoOn = true; try { autoOn = localStorage.getItem('khAutoOptimize') !== '0'; } catch (e) {}
      bar.innerHTML =
        '🛰️ 中枢：<span id="khHubState" style="color:#9AA6C4">' + (KH_HUB || '未连接') + '</span> ' +
        '<span id="khHubSet" style="color:#7FA8FF;cursor:pointer;margin-left:4px">设置</span><br>' +
        '🤖 自动优化：<span id="khGovTime" style="color:#9AA6C4">—</span> (<span id="khGovOk" style="color:#9AA6C4">—</span>) ' +
        '<label style="color:#9AA6C4;cursor:pointer;margin-left:4px"><input type="checkbox" id="khAutoChk"' + (autoOn ? ' checked' : '') + '>开</label> ' +
        '<button id="khOptBtn" style="border:0;border-radius:8px;padding:2px 8px;background:#2563EB;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">🤖 优化</button> ' +
        '<button id="khFbBtn" style="border:0;border-radius:8px;padding:2px 8px;background:#16A34A;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">📡 反馈</button> ' +
        '<button id="khFinalBtn" style="border:0;border-radius:8px;padding:2px 8px;background:#7C3AED;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">📋 成品</button> ' +
        '<button id="khHubDiscover" style="border:0;border-radius:8px;padding:2px 8px;background:#334155;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">🔄 重连</button> ' +
        '<button id="khHubToken" style="border:0;border-radius:8px;padding:2px 8px;background:#B45309;color:#fff;cursor:pointer;margin-left:4px;font-size:11px">🔑 口令</button>';
      document.body.appendChild(bar);
      // 全部最终成品面板（默认收起，点 📋 成品 展开）
      var panel = document.createElement('div'); panel.id = 'khFinalPanel';
      panel.setAttribute('style', 'display:none;position:fixed;left:8px;top:64px;z-index:9997;background:#12141e;color:#E7ECF5;border:1px solid #3A4256;border-radius:12px;padding:12px 14px;font:12px/1.5 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.55);max-width:min(92vw,420px);max-height:78vh;overflow:auto');
      document.body.appendChild(panel);
      var setBtn = document.getElementById('khHubSet');
      if (setBtn) setBtn.onclick = function () {
        var v = prompt('填写桌面中枢地址（支持局域网IP / 公网IP / DDNS）：', KH_HUB || 'http://');
        if (v) { try { localStorage.setItem('khHub', v.replace(/\/+$/, '')); } catch (e) {} location.reload(); }
      };
      var disco = document.getElementById('khHubDiscover');
      if (disco) disco.onclick = function () {
        khShowToast('🛰️ 正在重新发现中枢…');
        khDiscoverHub(function (ok) {
          khShowToast(ok ? ('✅ 已连接中枢：' + KH_HUB) : '⚠️ 未发现中枢，可在「设置」里填写地址');
          var st = document.getElementById('khHubState'); if (st) st.textContent = KH_HUB || '未连接';
          sync();
        });
      };
      var tokBtn = document.getElementById('khHubToken');
      if (tokBtn) tokBtn.onclick = function () {
        var v = prompt('填写中枢访问口令（中枢未开启口令时留空即可）：', khAccessToken());
        if (v === null) return;
        try { localStorage.setItem('khHubToken', v); } catch (e) {}
        khShowToast(v ? '🔑 口令已保存' : '🔑 已清除口令');
        sync();
      };
      khOptBtn = document.getElementById('khOptBtn');
      if (khOptBtn) khOptBtn.onclick = function () { khHarmonyOptimize(); };
      var fbBtn = document.getElementById('khFbBtn');
      if (fbBtn) fbBtn.onclick = function () { khHarmonyFeedback(); };
      var finalBtn = document.getElementById('khFinalBtn');
      if (finalBtn) finalBtn.onclick = function () {
        var p = document.getElementById('khFinalPanel');
        if (!p) return;
        if (p.style.display === 'none') { p.style.display = 'block'; khRenderFinal(); }
        else { p.style.display = 'none'; }
      };
      var chk = document.getElementById('khAutoChk');
      if (chk) chk.onchange = function () { try { localStorage.setItem('khAutoOptimize', chk.checked ? '1' : '0'); } catch (e) {} khShowToast(chk.checked ? '✅ 已开启自动优化' : '⏸️ 已关闭自动优化'); };
    } catch (e) {}
  }
})();
'''


def feature_snapshot():
    """把「自动添加的新功能」内嵌进 HAP：开发者端 / 设备端离线也能看到，在线清单随后覆盖。"""
    try:
        feats = json.load(open(FEATURES_FILE, encoding='utf-8'))
        if not isinstance(feats, list):
            feats = []
    except Exception:
        feats = []
    try:
        st = json.load(open(STAMP_FILE, encoding='utf-8'))
        ver = {'versionName': st.get('versionName'), 'versionCode': st.get('versionCode'),
               'count': len(feats), 'hash': st.get('hash'), 'inSync': True}
    except Exception:
        ver = {'versionName': None, 'versionCode': None, 'count': len(feats), 'hash': None, 'inSync': True}
    def safe(s):
        return json.dumps(s, ensure_ascii=False).replace('</', '<\\/')
    return safe(feats), safe(ver)


def inject(html, hub):
    # 0) 内嵌本次发版的功能清单（反馈建议自动提取的新功能随包到开发者端 / 开鸿端）
    feats_json, ver_json = feature_snapshot()
    html = html.replace('var KH_FEATURE_SNAPSHOT = [];',
                        'var KH_FEATURE_SNAPSHOT = ' + feats_json + ';', 1)
    html = html.replace('var KH_FEATURE_SNAPSHOT_VERSION = null;',
                        'var KH_FEATURE_SNAPSHOT_VERSION = ' + ver_json + ';', 1)
    # 1) 远程收集默认值：默认指向中枢 /api/report（解析时即带上默认地址）
    rep1 = "var ISSUE_REMOTE_DEFAULT = '/api/report';"
    if rep1 in html:
        html = html.replace(rep1,
            "var ISSUE_REMOTE_DEFAULT = (function(){ try { var h = localStorage.getItem('khHub') || '%s'; return h ? (h.replace(/\\/+$/,'') + '/api/report') : ''; } catch(e){ return ''; } })();" % hub,
            1)
    # 2) 中和桌面开关，改置 HAP 开关（桌面块因 KH_DESKTOP 未定义而自动 inert）
    rep2 = "window.KH_DESKTOP = true;"
    if rep2 in html:
        html = html.replace(rep2, "window.KH_HARMONY = true;", 1)
    # 3) 远程收集开关：深开鸿端只认用户自己设置过的中枢地址（khHub）。
    #    原写法 '(localStorage.getItem('khHub') || '%s' ? true : false)' 里 || 先算成字符串恒为真，
    #    等于上报开关永远打开，和"默认关闭"的注释相反。
    rep3 = "enabled: (window.KH_DESKTOP ? true : (c.enabled === true)),"
    if rep3 in html:
        html = html.replace(rep3,
            "enabled: (window.KH_HARMONY ? !!localStorage.getItem('khHub') : (c.enabled === true)),",
            1)
    # 4) 注入 HAP 块（含默认中枢地址 + 自动发现候选列表）
    anchor = "setDiag('state','ready');"
    if anchor not in html:
        raise RuntimeError('找不到 boot 收尾注入点')
    block = (HAP_BLOCK
             .replace('__KH_HUB_DEFAULT__', hub)
             .replace('__KH_HUB_CANDIDATES__', hub_candidates()))
    html = html.replace(anchor, anchor + "\n" + block, 1)
    return html


def inject_sites(html):
    """HAP 端把内置平台清单直接内嵌：深开鸿设备不连中枢时也要能看到完整平台，
    否则只认随包那 29 条基线（v1.7.13 就出现过「网页端 204 个、HAP 只有 29 个」）。"""
    man_path = os.path.normpath(os.path.join(ROOT, '..', 'server', 'manifest.json'))
    if not os.path.exists(man_path):
        print('   [平台] 未找到 manifest.json，跳过内嵌')
        return html
    try:
        man = json.load(open(man_path, encoding='utf-8'))
        sites = (man.get('sources') or {}).get('sites') or []
    except Exception as e:
        print('   [平台] manifest 读取失败，跳过内嵌：', e)
        return html
    rows = []
    for s in sites:
        if not isinstance(s, dict) or not s.get('url') or not s.get('name'):
            continue
        url = str(s['url'])
        if not url.startswith('http'):
            continue
        row = {'name': str(s['name'])[:24], 'url': url[:512],
               'color': s.get('color') or '#3B456B',
               'tag': (s.get('prov') or s.get('tag') or str(s['name'])[:1])[:2],
               'cat': (s.get('cat') or '综合视频')[:20]}
        if s.get('mobile'):
            row['mobile'] = s['mobile']
        if s.get('mode'):
            row['mode'] = s['mode']
        rows.append(row)
    js = 'var BUILTIN_SITES = [\n' + ',\n'.join(
        '{' + ','.join('%s:%s' % (k, json.dumps(v, ensure_ascii=False)) for k, v in r.items()) + '}'
        for r in rows) + '\n];'
    import re
    m = re.search(r'var BUILTIN_SITES = \[[\s\S]*?\n\];', html)
    if not m:
        print('   [平台] 页面里没有 BUILTIN_SITES 锚点，跳过内嵌')
        return html
    html = html[:m.start()] + js + html[m.end():]
    print('   [平台] 已内嵌 %d 条内置平台到 HAP 前端' % len(rows))
    return html


def main():
    if os.path.isdir(SRC_APP) and os.path.exists(os.path.join(SRC_APP, 'index.html')):
        src = SRC_APP
    elif os.path.isdir(ALT_SRC):
        src = ALT_SRC
    else:
        sys.exit('找不到前端源：' + SRC_APP)

    hub = default_hub()
    if os.path.exists(WWW):
        shutil.rmtree(WWW)
    shutil.copytree(src, WWW)
    html = open(os.path.join(WWW, 'index.html'), encoding='utf-8').read()
    html = inject(html, hub)
    html = inject_sites(html)
    open(os.path.join(WWW, 'index.html'), 'w', encoding='utf-8').write(html)

    print('OK 深开鸿 HAP 前端构建完成')
    print('   源：', src)
    print('   产物：', WWW, '/index.html')
    print('   默认中枢地址（已自动写入）：', hub)
    print('   已中和桌面开关并注入 HAP 适配（KH_HARMONY），/api 将自动走桌面中枢')
    print('   下一步：用 DevEco Studio 打开本 harmony/ 工程 → 自动签名 → 运行到 KaihongOS 设备')


if __name__ == '__main__':
    main()
