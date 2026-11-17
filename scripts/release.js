#!/usr/bin/env node
'use strict';
/* 发版：一次构建 = 一次真实版本（npm run pack 的第一步）。
   1) 递增 server/manifest.json 的 release.latest（versionCode +1 / patch +1）
   2) 把新版本同步写进 app/index.html 与 harmony 前端的 kh-release 内嵌清单、
      KH_APP_CODE、设备画像版本 —— 保证「新装用户不误报更新」
   3) 生成 server/feature-version.json（功能清单随版本发布的快照）
   4) 把「自动安装」宣传文案改成与真实能力一致
   5) 同步 package.json.version —— 安装包文件名 / 主程序版本信息跟随本次发版
   KH_RELEASE_BUMP=1 才递增版本号（默认不涨，避免调试打包把版本刷高；正式发版显式 bump）。
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'server', 'manifest.json');
const FEATURES = path.join(ROOT, 'features', 'manifest.json');
const STAMP = path.join(ROOT, 'server', 'feature-version.json');
const PAGES = [
  path.join(ROOT, 'app', 'index.html'),
  path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www', 'index.html')
];

const NOTES = '自动更新：发现新版本后下载更新包 → 核对 SHA256 → 由用户在安装向导 / 系统安装器确认安装（应用内不静默安装）';

function syncPage(p, latest) {
  if (!fs.existsSync(p)) return false;
  let s = fs.readFileSync(p, 'utf8');
  const re = /(<script id="kh-release" type="application\/json">)([\s\S]*?)(<\/script>)/;
  if (re.test(s)) {
    s = s.replace(re, function (_, a, b, c) {
      let obj;
      try { obj = JSON.parse(b); } catch (e) { obj = { schema: 1, latest: {} }; }
      if (!obj.latest || typeof obj.latest !== 'object') obj.latest = {};
      obj.latest = Object.assign({}, obj.latest, latest);
      obj.generatedAt = latest.publishedAt;
      return a + JSON.stringify(obj) + c;
    });
  }
  s = s.replace(/var KH_APP_CODE\s*=\s*\d+\s*;/, 'var KH_APP_CODE = ' + latest.versionCode + ';');
  s = s.replace(/appCode:\s*\d+/, 'appCode: ' + latest.versionCode);
  s = s.replace(/appVersion:\s*'[^']*-desktop'/, "appVersion: '" + latest.versionName + "-desktop'");
  fs.writeFileSync(p, s);
  return true;
}

console.log('=== 发版：版本号随构建产物递增 ===');
// 发版第一步先把反馈 / 建议里的新功能自动提取并加进开发者端功能清单（零人工复核），
// 随后生成的功能快照与两端内嵌清单才会包含这次长出来的新能力。
try {
  const mined = require(path.join(ROOT, 'server', 'feature-miner.js')).run();
  console.log('  反馈自动提取新功能：扫描 ' + mined.scannedTexts + ' 条 · 命中 ' + mined.candidates.length +
    ' 项 · 自动添加 ' + mined.added.length + ' 项（无需人工复核）');
} catch (e) { console.warn('  反馈自动提取跳过：' + (e && e.message || e)); }
const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
if (!m.release || !m.release.latest) { console.error('清单缺少 release.latest，已中止'); process.exit(1); }
const latest = m.release.latest;
const bump = process.env.KH_RELEASE_BUMP === '1';
if (bump) {
  const oldCode = Number(latest.versionCode) || 0;
  latest.versionCode = oldCode + 1;
  const parts = String(latest.versionName || '0.0.0').split('.');
  parts[parts.length - 1] = String((Number(parts[parts.length - 1]) || 0) + 1);
  latest.versionName = parts.join('.');
}
const nowIso = new Date().toISOString();
latest.publishedAt = nowIso;
latest.generatedAt = nowIso;
latest.downloadUrl = '/download/desktop-setup.exe';
latest.hapUrl = '/download/honghub-harmony.hap';
latest.notes = NOTES;
latest.hapAutoInstall = false;           // 真实能力：需用户在安装器中确认
m.release.generatedAt = nowIso;
fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
console.log('  ' + (bump ? '新版本' : '沿用版本') + ' v' + latest.versionName + ' #' + latest.versionCode + ' @ ' + nowIso);

// 安装包文件名（electron-builder 默认 ${productName} Setup ${version}.exe）与
// 主程序版本信息都读 package.json.version，必须和本次发版一致，否则会出现
// 「装的是 Setup 1.7.0、应用里显示 v1.7.1」这类误判。
const PKG = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
if (pkg.version !== latest.versionName) {
  pkg.version = latest.versionName;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  已同步 package.json.version → ' + latest.versionName);
} else console.log('  package.json.version 已一致（' + latest.versionName + '）');

for (const p of PAGES) {
  if (syncPage(p, latest)) console.log('  已同步 ' + path.relative(ROOT, p));
}

// 统一版本收口：release.js 历史上的遗漏（public-endpoint.json、releases/index.json、
// harmony 端 KH_APP_CODE）由此统一补齐。version.js --sync 以 manifest.release.latest
// 为真相源对齐全部 9 处版本字段，幂等且不改任何成品哈希。任何发版入口都会经此收口。
try {
  const r = require('child_process').spawnSync(process.execPath,
    [path.join(__dirname, 'version.js'), '--sync'],
    { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  if (r.status === 0) console.log('  版本全端对齐：' + String(r.stdout || '').trim().split(/\r?\n/).pop());
  else console.warn('  版本对齐告警：' + String(r.stderr || r.stdout || '').trim().slice(0, 200));
} catch (e) { console.warn('  版本对齐跳过：' + (e && e.message || e)); }

// 功能清单随本次发版一并打快照，供 /api/features 与自检校验
let feats = [];
try { feats = JSON.parse(fs.readFileSync(FEATURES, 'utf8')); } catch (e) { /* 空清单 */ }
if (!Array.isArray(feats)) feats = [];
const hash = crypto.createHash('sha256').update(JSON.stringify(feats)).digest('hex');
fs.writeFileSync(STAMP, JSON.stringify({
  versionName: latest.versionName,
  versionCode: latest.versionCode,
  publishedAt: nowIso,
  count: feats.length,
  ids: feats.map(f => String(f && f.id || '')),
  hash: hash.slice(0, 16),
  fullHash: hash
}, null, 2) + '\n');
console.log('  功能快照：' + feats.length + ' 项 · hash ' + hash.slice(0, 16));
console.log('发版完成');
