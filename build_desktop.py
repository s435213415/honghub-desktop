#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HongHub-Desktop 构建脚本
--------------------------------
从 HongHubMovie 工程复用纯前端影站（movie-site），注入桌面适配：
  1) 默认开启脱敏远程收集，端点指向本地收集服务的 /api/report
  2) 启动时从同域 /api/manifest 拉取最新源/版本清单（实时更新，无需重装）
  3) 从 /api/features 拉取可插拔扩展功能，渲染「🧩 扩展工具」悬浮入口
并导出 server/manifest.json（源清单 + 版本清单），供收集服务做实时更新源。

用法：python build_desktop.py
"""
import os, json, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(ROOT, '..', 'HongHubMovie',
    'entry', 'src', 'main', 'resources', 'rawfile', 'movie-site'))
APP = os.path.join(ROOT, 'app')
SERVER = os.path.join(ROOT, 'server')

# 产品名（改名只需改这里；看板 / 托盘 / 标题会统一跟随）
PRODUCT_NAME = os.environ.get('PRODUCT_NAME') or '鸿汇影'


def extract_json_block(s, block_id):
    """提取 <script id="<id>" type="application/json">...</script> 内的 JSON。"""
    idx = s.find('id="%s"' % block_id)
    if idx < 0:
        raise RuntimeError('找不到 %s 清单块' % block_id)
    start = s.rfind('<script', 0, idx)
    end = s.find('</script>', idx)
    if start < 0 or end < 0:
        raise RuntimeError('%s 清单块标签不完整' % block_id)
    inner = s[start:end]
    gt = inner.find('>')
    return inner[gt + 1:].strip()


DESKTOP_BLOCK = r'''
/* ===================== 桌面版 HongHub-Desktop 适配 ===================== */
/* 说明：window.KH_DESKTOP 已置 true；ISSUE_REMOTE_DEFAULT 已指向 /api/report，
   远程收集默认开启（用户可在「问题」中心暂停）。以下实现：实时拉取清单/功能 + 扩展工具入口。 */

var KH_APP_CODE = __KH_APP_CODE__;   // 当前客户端版本号（构建时由上游 release 注入），用于自动更新比对
var KH_PRODUCT = '__KH_PRODUCT__';   // 产品名（单点配置，改名只需改 build_desktop.py 顶部 PRODUCT_NAME）

function khShowUpdateBanner(lat) {
  try {
    if (document.getElementById('khUpdateBanner')) return;
    try { if (localStorage.getItem('khDismissedVer') === String(lat.versionCode)) return; } catch (e) {}
    var b = document.createElement('div'); b.id = 'khUpdateBanner';
    b.setAttribute('style', 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9995;background:#1B2233;color:#E7ECF5;border:1px solid #3A4256;border-radius:12px;padding:10px 14px;font:13px/1.4 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:92vw');
    b.innerHTML = '🆕 发现新版本 v' + esc(lat.versionName) + '（#' + esc(lat.versionCode) + '） <span style="color:#9CC5FF;font-size:11px;margin-left:6px">内容已自动更新；本体覆盖安装无需卸载</span> <button id="khUpdBtn" style="border:0;border-radius:8px;padding:4px 10px;background:#16A34A;color:#fff;cursor:pointer;margin-left:6px">覆盖安装（免卸载）</button> <span id="khUpdClose" style="cursor:pointer;margin-left:6px;color:#9AA6C4">✕</span>';
    document.body.appendChild(b);
    document.getElementById('khUpdBtn').onclick = function () { window.open(lat.downloadUrl || '/download/desktop-setup.exe', '_blank'); };
    document.getElementById('khUpdClose').onclick = function () { try { localStorage.setItem('khDismissedVer', String(lat.versionCode)); } catch (e) {} b.style.display = 'none'; };
  } catch (e) {}
}

window.__khLoadFeatures = function (list) {
  try {
    window.KH_FEATURES = list || [];
    var btn = document.getElementById('khToolsBtn');
    if (!btn) {
      btn = document.createElement('button'); btn.id = 'khToolsBtn'; btn.textContent = '🧩 扩展工具';
      btn.setAttribute('style', 'position:fixed;right:14px;bottom:14px;z-index:9990;border:0;border-radius:20px;' +
        'padding:10px 16px;background:#FF4D5E;color:#fff;font:13px/1 sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)');
      document.body.appendChild(btn);
      btn.onclick = function () {
        var p = document.getElementById('khToolsPanel');
        if (p) { p.style.display = (p.style.display === 'none' ? 'block' : 'none'); return; }
        khRenderTools();
      };
    }
    if (document.getElementById('khToolsPanel')) khRenderTools();
  } catch (e) {}
};

function khRenderTools() {
  try {
    var p = document.getElementById('khToolsPanel');
    if (!p) { p = document.createElement('div'); p.id = 'khToolsPanel'; document.body.appendChild(p); }
    p.setAttribute('style', 'position:fixed;right:14px;bottom:64px;z-index:9991;width:330px;max-height:72vh;overflow:auto;' +
      'background:#12151F;color:#E7ECF5;border:1px solid #2A2F40;border-radius:14px;padding:14px;' +
      'font:13px/1.5 sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)');
    var items = (window.KH_FEATURES || []).map(function (f) {
      return '<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)">' +
        '<div style="font-weight:700">' + esc(f.name || f.id || '工具') + '</div>' +
        '<div style="color:#9AA6C4;font-size:12px;margin:4px 0 8px">' + esc(f.desc || '') + '</div>' +
        '<button data-fid="' + esc(f.id || '') + '" style="border:0;border-radius:10px;padding:6px 12px;' +
        'background:#262B3B;color:#E7ECF5;cursor:pointer">打开</button></div>';
    }).join('') || '<div style="color:#9AA6C4">暂无扩展功能（在 server/features 增加即可在线生效）</div>';
    p.innerHTML = '<div style="font-weight:700;margin-bottom:6px">🧩 扩展工具（免重装在线新增）</div>' + items +
      '<div style="text-align:right;margin-top:6px"><span id="khToolsManage" style="color:#7FA8FF;cursor:pointer;margin-right:10px">功能管理</span><span id="khToolsClose" style="color:#9AA6C4;cursor:pointer">收起</span></div>';
    var mgr = document.getElementById('khToolsManage');
    if (mgr) mgr.onclick = function () { window.open('/', '_blank'); };
    var close = document.getElementById('khToolsClose');
    if (close) close.onclick = function () { p.style.display = 'none'; };
    Array.prototype.forEach.call(p.querySelectorAll('button[data-fid]'), function (b) {
      b.onclick = function () {
        var f = (window.KH_FEATURES || []).filter(function (x) { return x.id === b.getAttribute('data-fid'); })[0];
        if (f) khRunFeature(f);
      };
    });
  } catch (e) {}
}

function khRunFeature(f) {
  try {
    var a = f.action || '';
    if (a === 'open' && f.url) {
      if (f.url.indexOf('http') === 0) window.open(f.url, '_blank'); else location.href = f.url;
      return;
    }
    if (a.indexOf('builtin:') === 0) {
      if (a === 'builtin:report') { copyIssueText(issueReport(), '诊断报告'); return; }
      if (a === 'builtin:sourcespeed') { khFeatureSourceSpeed(); return; }
      if (a === 'builtin:fix') { khFeatureFix(); return; }
      if (a === 'builtin:updatepublish') { khFeatureUpdatePublish(); return; }
    if (a === 'builtin:automation') { khFeatureAutomation(); return; }
    if (a === 'builtin:govern') { khFeatureGovern(); return; }
    if (a === 'builtin:updatecheck') { khFeatureUpdateCheck(); return; }
    toast('未识别的内置功能：' + a); return;
    }
    if (a === 'script' || a === 'webhook') {
      if (f.confirm) { try { if (!confirm('确认运行功能「' + (f.name || f.id) + '」？')) return; } catch (e) {} }
      toast('正在运行：' + (f.name || f.id) + ' …');
      fetch('/api/feature/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) { toast('运行失败：' + String(d && d.error || '').slice(0, 120)); return; }
          if (d.action === 'open') { window.open(d.url, '_blank'); return; }
          if (d.stdout !== undefined) toast('✅ 完成（退出码 ' + (d.code || 0) + '）：\n' + String(d.stdout || '').slice(0, 300));
          else if (d.status !== undefined) toast('✅ 接口返回 ' + d.status + (d.body ? ('：' + String(d.body).slice(0, 200)) : ''));
          else toast('✅ 已运行');
        }).catch(function (e) { toast('请求失败：' + (e && e.message || e)); });
      return;
    }
    toast('未识别的功能动作：' + a);
  } catch (e) { toast('功能执行失败：' + (e && e.message || e)); }
}

function khFeatureSourceSpeed() {
  try {
    var chs = window.LIVE_CHANNELS || [], rows = [];
    for (var i = 0; i < chs.length; i++) {
      rows.push({ n: chs[i].name, n_src: (chs[i].sources || []).length, group: chs[i].group || '' });
    }
    rows.sort(function (a, b) { return b.n_src - a.n_src; });
    var txt = '源线路排行（按可用线路数，共 ' + chs.length + ' 频道）：\n' +
      rows.slice(0, 30).map(function (r, i) {
        return (i + 1) + '. [' + r.group + '] ' + r.n + '：' + r.n_src + ' 条线路';
      }).join('\n');
    alert(txt);
  } catch (e) { toast('排行失败：' + (e && e.message || e)); }
}

function khFeatureFix() {
  toast('正在向收集服务请求一键自愈（重排源 / 刷新清单）…');
  fetch('/api/fix', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      toast(d.ok ? ('自愈完成：' + String(d.msg || '').slice(0, 80)) : ('自愈失败：' + String(d.error || '').slice(0, 80)));
      setTimeout(function () {
        fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
          .then(function (m) { if (m && m.sources) window.__khApplySources(JSON.stringify(m.sources)); });
      }, 1500);
    }).catch(function (e) { toast('自愈请求失败：' + (e && e.message || e)); });
}

function khFeatureUpdatePublish() {
  try { if (!confirm('确认同时执行「更新（重排源 / 刷新清单）+ 发布（升级版本号）」？\n所有桌面端将实时拉取新版本。')) return; } catch (e) {}
  toast('正在向收集服务请求：更新 + 发布…');
  fetch('/api/update-publish', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) {
        toast('已更新并发布 v' + d.publish.versionName + ' (#' + d.publish.versionCode + ') · 源清单 v' + d.update.v);
        setTimeout(function () {
          fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
            .then(function (m) {
              if (m && m.sources) window.__khApplySources(JSON.stringify(m.sources));
              if (m && m.release) window.__khSetRelease(JSON.stringify(m.release));
            });
        }, 1500);
      } else {
        toast('更新发布失败：' + String(d && d.error || '').slice(0, 100));
      }
    }).catch(function (e) { toast('请求失败：' + (e && e.message || e)); });
}

function khFeatureAutomation() {
  fetch('/api/automation', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      var s = (d.enabled ? '✅ 自动化已开启' : '⛔ 自动化已关闭') + '\n';
      s += '下次运行：' + new Date(d.nextRunAt || 0).toLocaleString('zh-CN', { hour12: false }) + '\n';
      var lr = d.lastRun;
      s += '上次运行：' + (lr ? (new Date(lr.startedAt).toLocaleString('zh-CN', { hour12: false }) + ' ' + (lr.ok ? '成功' : '失败')) : '无') + '\n';
      s += '运行次数：' + (d.recent ? d.recent.length : 0);
      if (!confirm(s + '\n\n是否立即触发一次自动化（更新+发布）？')) return;
      toast('正在触发自动化运行…');
      fetch('/api/automation/run', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
        .then(function (o) { toast(o.ok ? '自动化运行完成（更新 v' + (o.result && o.result.update && o.result.update.v) + ' / 发布 ' + (o.result && o.result.publish && o.result.publish.versionName) + '）' : ('自动化失败：' + String(o.error || '').slice(0, 100))); })
        .catch(function (e) { toast('触发失败：' + (e && e.message || e)); });
    }).catch(function (e) { toast('读取自动化状态失败：' + (e && e.message || e)); });
}

function khFeatureGovern() {
  try { if (!confirm('确认运行「智能自治循环」（自动提取问题→修复→优化→发布→新增功能）？')) return; } catch (e) {}
  toast('正在运行智能自治循环…');
  fetch('/api/govern/run', { method: 'POST', cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      var res = d.result || {};
      toast(d.ok ? ('自治完成：修复 ' + (res.fixed && res.fixed.ok ? '✅' : '❌') + ' / 优化剔除 ' + (res.optimized ? res.optimized.removed : 0) + ' / 新增功能 ' + (res.featuresAdded || []).length + ' / 发布 ' + (res.published && res.published.versionName || '-')) : ('自治失败：' + String(d.error || '').slice(0, 100)));
    }).catch(function (e) { toast('请求失败：' + (e && e.message || e)); });
}

function khFeatureUpdateCheck() {
  fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) {
      var lat = d && d.release && d.release.latest;
      if (!lat) { toast('未获取到版本信息'); return; }
      if (Number(lat.versionCode) > Number(KH_APP_CODE)) { khShowUpdateBanner(lat); toast('发现新版本 v' + lat.versionName + '，可点击顶部横幅下载'); }
      else toast('已是最新 v' + lat.versionName + '（#' + lat.versionCode + '）');
    }).catch(function (e) { toast('检查失败：' + (e && e.message || e)); });
}

(function () {
  if (!window.KH_DESKTOP) return;
  try {
    window.__khSetDeviceProfile({
      marketName: '桌面版 Desktop', deviceType: 'desktop', model: 'HongHub-Desktop',
      abi: 'web', osFullName: navigator.userAgent, apiVersion: 26, minApi: 12, targetApi: 26,
      tier: 'high', screenW: window.innerWidth || 1280, screenH: window.innerHeight || 720,
      densityDPI: 96, appVersion: '1.7.0-desktop', appCode: 1000114
    });
  } catch (e) {}
  function deskUpdate() {
    fetch('/api/manifest', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.sources) window.__khApplySources(JSON.stringify(d.sources));
        if (d && d.release) window.__khSetRelease(JSON.stringify(d.release));
      }).catch(function () {});
  }
  deskUpdate();
  setTimeout(deskUpdate, 9000);
  fetch('/api/features', { cache: 'no-store' }).then(function (r) { return r.json(); })
    .then(function (d) { if (d && Array.isArray(d.features)) window.__khLoadFeatures(d.features); })
    .catch(function () {});
})();
'''


def inject(html, release):
    rep1 = "var ISSUE_REMOTE_DEFAULT = '';"
    if rep1 not in html:
        raise RuntimeError('找不到 ISSUE_REMOTE_DEFAULT 注入点')
    html = html.replace(rep1, "var ISSUE_REMOTE_DEFAULT = '/api/report';\nwindow.KH_DESKTOP = true;", 1)

    rep2 = "enabled: c.enabled === true,"
    if rep2 not in html:
        raise RuntimeError('找不到 issueRemoteCfg 注入点')
    html = html.replace(rep2, "enabled: (window.KH_DESKTOP ? true : (c.enabled === true)),", 1)

    anchor = "setDiag('state','ready');"
    if anchor not in html:
        raise RuntimeError('找不到 boot 收尾注入点')
    html = html.replace(anchor, anchor + "\n" + DESKTOP_BLOCK, 1)

    # 注入真实版本号与产品名（自动更新比对 + 统一改名）
    vcode = str(release.get('latest', {}).get('versionCode'))
    html = html.replace('__KH_APP_CODE__', vcode)
    html = html.replace('__KH_PRODUCT__', PRODUCT_NAME)
    return html


def main():
    if not os.path.isdir(SRC):
        sys.exit('源影站目录不存在：' + SRC)
    html = open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()

    sources = json.loads(extract_json_block(html, 'kh-sources'))
    release = json.loads(extract_json_block(html, 'kh-release'))
    manifest = {'sources': sources, 'release': release}
    os.makedirs(SERVER, exist_ok=True)
    open(os.path.join(SERVER, 'manifest.json'), 'w', encoding='utf-8') \
        .write(json.dumps(manifest, ensure_ascii=False, indent=2))

    if os.path.exists(APP):
        shutil.rmtree(APP)
    shutil.copytree(SRC, APP)
    new = inject(html, release)
    open(os.path.join(APP, 'index.html'), 'w', encoding='utf-8').write(new)

    print('OK 桌面版构建完成')
    print('   源清单 v%s · %d 频道 / %d 源 · 平台 %d' % (
        sources.get('v'), len(sources.get('channels', [])),
        sum(len(c.get('sources', [])) for c in sources.get('channels', [])),
        len(sources.get('sites', []))))
    print('   版本 %s / code %s' % (release.get('latest', {}).get('versionName'),
                                    release.get('latest', {}).get('versionCode')))
    print('   应用：app/index.html（已注入桌面适配） · server/manifest.json')
    print('   远程收集默认端点：/api/report（已默认开启）')


if __name__ == '__main__':
    main()
