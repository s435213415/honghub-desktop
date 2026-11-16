#!/usr/bin/env node
'use strict';
/* 打包前自检：脚本语法 / 按钮函数 / 页面元素 / 版本基线 / 运行时执行。
   任何一项失败即 exit(1) 阻断打包 —— 防止「一行括号写错导致所有按钮全废」再次流出。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const errs = [];
// 静态模式供 CI / pre-commit 使用：不校验 dist 产物、不改写页面，纯只读断言
const STATIC = process.env.KH_CHECK_STATIC === '1';
const fail = (m) => { errs.push(m); console.error('  [失败] ' + m); };
const pass = (m) => console.log('  [通过] ' + m);
const at = (p) => path.join(ROOT, p);

const PAGES = ['app/index.html', 'harmony/entry/src/main/resources/rawfile/www/index.html'];
const MANIFEST = 'server/manifest.json';

function scriptsOf(html) {
  return Array.from(html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))
    .filter(m => !/application\/json/.test(m[1]) && m[2].trim())
    .map(m => m[2]);
}

function checkSyntax(label, html) {
  const list = scriptsOf(html);
  list.forEach((code, i) => {
    try { new vm.Script(code); }
    catch (e) { fail(label + ' 第 ' + (i + 1) + ' 段脚本语法错误：' + e.message); }
  });
  if (list.length) pass(label + ' ' + list.length + ' 段脚本语法正常');
  return list;
}

console.log('=== 打包前自检 ===');

// 1) 版本基线：客户端 KH_APP_CODE 必须等于中枢 release.versionCode，否则一启动就误报更新
let targetCode = null;
try {
  const m = JSON.parse(fs.readFileSync(at(MANIFEST), 'utf8'));
  targetCode = Number(m.release.latest.versionCode);
  if (!Number.isFinite(targetCode)) throw new Error('versionCode 非法');
} catch (e) { fail('读取中枢版本失败：' + e.message); }

if (targetCode) {
  for (const p of PAGES) {
    let s = fs.readFileSync(at(p), 'utf8');
    const m = s.match(/var KH_APP_CODE\s*=\s*(\d+)/);
    if (!m) continue;
    if (Number(m[1]) !== targetCode) {
      if (STATIC) { fail(p + ' 版本基线 ' + m[1] + ' ≠ 中枢 ' + targetCode + '（请重跑发版）'); continue; }
      s = s.replace(/var KH_APP_CODE\s*=\s*\d+/, 'var KH_APP_CODE = ' + targetCode);
      fs.writeFileSync(at(p), s);
      pass('自动同步 ' + p + ' 版本基线 → ' + targetCode);
    } else pass(p + ' 版本基线一致（' + targetCode + '）');
  }
}

// 2) 静态页面脚本语法（影站 + 开鸿端）
for (const p of PAGES) checkSyntax(p, fs.readFileSync(at(p), 'utf8'));

// 2.5) HAP 新鲜度阻断：包内前端版本必须等于本次发版，防止「版本号升了但沿用旧 HAP」
//      旧包会被 postpack 重新计算 sha256 伪装成新产物，所以必须在打包前从包内读真实内容核对
if (!STATIC) {
  try {
    const zipRead = require('./lib/zip-read');
    const f = at('dist/honghub-harmony.hap');
    if (!fs.existsSync(f)) fail('缺少本次发版 HAP（dist/honghub-harmony.hap）');
    else {
      const html = zipRead.readText(f, 'resources/rawfile/movie-site/index.html');
      const mm = html.match(/var KH_APP_CODE\s*=\s*(\d+)/);
      if (!mm) fail('HAP 包内前端缺少 KH_APP_CODE');
      else if (Number(mm[1]) !== targetCode) fail('HAP 包内前端 #' + mm[1] + ' ≠ 发版 #' + targetCode + '（疑似沿用旧 HAP）');
      else if (html.indexOf('KH_HARMONY') < 0) fail('HAP 包内缺少深开鸿适配标记');
      else pass('HAP 新鲜度一致（#' + targetCode + ' · 包内前端为本次发版）');
    }
  } catch (e) { fail('HAP 新鲜度检查失败：' + e.message); }
}

// 3) 起临时中枢，抓真实看板页面做端到端检查
const PORT = 9400 + Math.floor(Math.random() * 200);
const srv = spawn(process.execPath, [at('server/server.js')], {
  cwd: ROOT,
  env: Object.assign({}, process.env, {
    PORT: String(PORT), AUTO_RUN_ENABLED: '0', AUTO_OPTIMIZE: '0', AUTO_GOVERN: '0'
  }),
  stdio: 'ignore'
});

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout: 1500 }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  let healthy = false;
  for (let i = 0; i < 25 && !healthy; i++) {
    try { const r = await get('/health'); healthy = r.code === 200 && /"ok":true/.test(r.body); } catch (e) { /* 等下一轮 */ }
    if (!healthy) await new Promise(r => setTimeout(r, 200));
  }
  if (!healthy) fail('临时中枢未能启动');
  else {
    pass('临时中枢启动正常');
    const r = await get('/');
    const html = r.body;
    const list = checkSyntax('在线看板', html);
    const js = list[list.length - 1] || '';

    const calls = new Set(Array.from(html.matchAll(/onclick="([A-Za-z_$][\w$]*)\s*\(/g)).map(m => m[1]));
    const defs = new Set(Array.from(js.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)).map(m => m[1]));
    const missing = Array.from(calls).filter(n => !defs.has(n));
    if (missing.length) fail('按钮函数未定义：' + missing.join(', '));
    else pass(calls.size + ' 个按钮函数全部已定义');

    const ids = new Set(Array.from(html.matchAll(/id="([^"]+)"/g)).map(m => m[1]));
    const used = new Set(Array.from(js.matchAll(/getElementById\("([^"]+)"\)/g)).map(m => m[1]));
    const noId = Array.from(used).filter(n => !ids.has(n));
    if (noId.length) fail('页面元素缺失：' + noId.join(', '));
    else pass(used.size + ' 个页面元素引用完整');

    try {
      const mkEl = () => ({ innerHTML: '', textContent: '', value: '', style: {}, disabled: false, checked: false, placeholder: '', querySelectorAll: () => [], focus() {}, closest() { return null; }, getAttribute() { return ''; } });
      const els = {};
      const ctx = {
        document: { getElementById: id => els[id] || (els[id] = mkEl()), querySelector: mkEl },
        window: { open() {}, location: {} },
        fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
        setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {},
        confirm: () => true, prompt: () => '', alert: () => {},
        console, Date, JSON, Math, String, Array, Object, Number, parseInt, isNaN, RegExp
      };
      vm.createContext(ctx);
      new vm.Script(js).runInContext(ctx, { timeout: 3000 });
      const bad = Array.from(calls).filter(n => typeof ctx[n] !== 'function');
      if (bad.length) fail('运行时函数不可用：' + bad.join(', '));
      else pass('看板脚本运行时执行正常');
    } catch (e) { fail('看板脚本运行时异常：' + e.message); }

    // 4) 发版一致性：内嵌 kh-release、功能快照必须与中枢版本一致（否则离线兜底会误报更新）
    let releaseCode = null;
    try {
      const mf = JSON.parse(fs.readFileSync(at(MANIFEST), 'utf8'));
      releaseCode = Number(mf.release.latest.versionCode);
      for (const p of PAGES) {
        const s = fs.readFileSync(at(p), 'utf8');
        const mm = s.match(/<script id="kh-release" type="application\/json">([\s\S]*?)<\/script>/);
        if (!mm) { fail(p + ' 缺少 kh-release 内嵌清单'); continue; }
        const c = Number(JSON.parse(mm[1]).latest.versionCode);
        if (c !== releaseCode) fail(p + ' 内嵌版本 ' + c + ' ≠ 中枢 ' + releaseCode);
      }
      const pkgVer = JSON.parse(fs.readFileSync(at('package.json'), 'utf8')).version;
      const relVer = String(mf.release.latest.versionName || '');
      if (pkgVer !== relVer) fail('package.json.version ' + pkgVer + ' ≠ 发版版本 ' + relVer + '（安装包名会与客户端版本不一致，请重跑发版）');
      else pass('安装包版本与发版版本一致（v' + pkgVer + '）');
      const stamp = JSON.parse(fs.readFileSync(at('server/feature-version.json'), 'utf8'));
      const feats = JSON.parse(fs.readFileSync(at('features/manifest.json'), 'utf8'));
      const h = require('crypto').createHash('sha256').update(JSON.stringify(feats)).digest('hex');
      if (stamp.hash !== h.slice(0, 16) || Number(stamp.versionCode) !== releaseCode) fail('功能快照与当前清单不一致（请重跑发版）');
      else pass('功能快照 v' + stamp.versionName + ' · ' + stamp.count + ' 项与发版一致');
    } catch (e) { fail('发版一致性检查失败：' + e.message); }

    // 5) 功能接口版本 + 中枢自发现能力
    try {
      const f = JSON.parse((await get('/api/features')).body);
      const s = JSON.parse((await get('/api/features/sync')).body);
      if (!f.version || Number(f.version.versionCode) !== releaseCode) fail('/api/features 未带正确版本');
      else if (!s.ok || !s.version || Number(s.version.versionCode) !== releaseCode) fail('/api/features/sync 版本不同步');
      else pass('功能接口版本已随发版同步（#' + releaseCode + '）');
    } catch (e) { fail('功能接口检查失败：' + e.message); }
    try {
      const h = JSON.parse((await get('/health')).body);
      if (!Array.isArray(h.hubs) || !h.hubs.length) fail('/health 未返回中枢候选地址');
      else pass('/health 返回 ' + h.hubs.length + ' 个中枢候选地址');
    } catch (e) { fail('中枢发现检查失败：' + e.message); }

    // 6) 自动下发成品 + OS 版本检测回传闭环 —— 模块、端点、两端前端实现
    for (const m of ['server/delivery-plan.js', 'server/device-optimizer.js']) {
      try { new vm.Script(fs.readFileSync(at(m), 'utf8')); pass(m + ' 脚本语法正常'); }
      catch (e) { fail(m + ' 语法错误：' + e.message); }
    }
    try {
      const d = JSON.parse((await get('/api/delivery')).body);
      const p = JSON.parse((await get('/api/delivery/plan?arch=x64&mem=512MB&os=Windows&code=' + (releaseCode - 1))).body);
      if (!d.ok || !d.delivery || !d.delivery.channels || !d.delivery.memoryTiers) fail('/api/delivery 未返回下发清单');
      else if (!d.delivery.devicePolicy.unrestricted || !d.delivery.autoUpdate.contentAlwaysLatest) fail('下发清单缺「不限设备 / 自动更新」策略');
      else if (p.channel !== 'lite' || p.install !== false || p.playback.maxBufferSize > 6 * 1000 * 1000) fail('低内存设备未自动保底免安装轻量版');
      else if (!p.update || !p.update.autoContentUpdate || !p.device.unrestricted) fail('自动更新 / 不限设备策略缺失');
      else if (!p.osProfile || !p.osProfile.family) fail('/api/delivery/plan 未附带 OS 版本适配结果');
      else pass('不限设备 / 不限内存自动下发与自动更新端点正常（含 OS 适配）');
    } catch (e) { fail('下发端点检查失败：' + e.message); }
    try {
      const o = JSON.parse((await get('/api/device/optimization')).body);
      const dv = JSON.parse((await get('/api/devices')).body);
      const all = o.optimization || {};
      if (!o.ok || !all.followAllOSVersions || Object.keys(all.families || {}).length < 7) fail('OS 版本适配矩阵未覆盖所有系统家族');
      else if (!dv.ok || !dv.followAllOSVersions) fail('/api/devices 未返回设备与系统版本清单');
      else pass('OS 版本检测回传闭环可用：' + Object.keys(all.families).length + ' 个系统家族 / ' +
        (all.summary.osVersions || 0) + ' 个版本 · 人工项 0');
    } catch (e) { fail('OS 版本检测端点检查失败：' + e.message); }
    for (const p of PAGES) {
      const s = fs.readFileSync(at(p), 'utf8');
      const fns = ['khPlayerProfile', 'khHlsConfig', 'khMemoryGuard', 'khApplyDeliveryPlan',
        'khFeatureMemory', 'khFeatureAutoUpdate', 'KH_MEM_TIERS',
        'khReportDevice', 'khDevicePayload', 'khFeatureOS'];
      const miss = fns.filter(n => s.indexOf(n) < 0);
      if (miss.length) fail(p + ' 缺少内存自适应 / 自动更新 / OS 回传实现：' + miss.join(', '));
      else pass(p + ' 内存档、自动下发与 OS 版本回传能力齐备');
    }
  }
  try { srv.kill(); } catch (e) { /* 已退出 */ }
  if (errs.length) {
    console.error('\n打包前自检未通过（' + errs.length + ' 项），已阻断打包。');
    process.exit(1);
  }
  console.log('\n打包前自检全部通过');
  process.exit(0);
})();
