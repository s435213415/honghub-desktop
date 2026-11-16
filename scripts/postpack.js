#!/usr/bin/env node
'use strict';
/* 打包后同步「自动更新」下载产物到 dist/，并生成本次发版的校验清单。
   桌面端下载 /download/desktop-setup.exe，深开鸿端下载 /download/honghub-harmony.hap。
   桌面安装包用硬链接生成别名，避免 dist/ 里出现两份 77MB 的相同文件。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const UPDATES = path.join(DIST, 'win-unpacked', 'resources', 'app', 'updates');
if (!fs.existsSync(DIST)) { console.error('dist 目录不存在，请先完成构建'); process.exit(1); }

function list() { return fs.readdirSync(DIST); }
function newest(re) {
  return list().filter(n => re.test(n))
    .map(n => ({ n: n, t: fs.statSync(path.join(DIST, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
}
// 同卷硬链接 → 不额外占磁盘；跨卷/失败回退为复制
function alias(src, dstName) {
  const srcPath = typeof src === 'string' ? src : path.join(DIST, src.n);
  const dst = path.join(DIST, dstName);
  if (path.resolve(srcPath) === path.resolve(dst)) return '同一文件（无需别名）';
  try { if (fs.existsSync(dst)) fs.unlinkSync(dst); } catch (e) {}
  try { fs.linkSync(srcPath, dst); return '硬链接'; }
  catch (e) { fs.copyFileSync(srcPath, dst); return '复制'; }
}
function shaOf(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function writeSha(name, hex) {
  const txt = hex + '  ' + name + '\n';
  fs.writeFileSync(path.join(DIST, name + '.sha256'), txt);
  if (fs.existsSync(UPDATES)) fs.writeFileSync(path.join(UPDATES, name + '.sha256'), txt);
}

console.log('=== 同步自动更新下载产物 ===');

// 1) 桌面安装包 → 固定别名（清单里的 downloadUrl 指向它）
// 必须精确匹配真正的安装包：别名 desktop-setup.exe 自身也含 "setup.exe"，泛匹配会把它当源。
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const EXACT = path.join(DIST, '鸿汇影桌面版 Setup ' + VERSION + '.exe');
let setupPath = fs.existsSync(EXACT) ? EXACT : null;
if (!setupPath) {
  const found = newest(/^鸿汇影桌面版 Setup .*\.exe$/i);
  if (found) setupPath = path.join(DIST, found.n);
}
if (!setupPath) { console.error('未找到安装包 Setup.exe，已阻断'); process.exit(1); }
const how = alias(setupPath, 'desktop-setup.exe');
const setupName = path.basename(setupPath);
const setupSha = shaOf(setupPath);
writeSha('desktop-setup.exe', setupSha);
console.log('  [桌面] ' + setupName + ' → desktop-setup.exe (' + fs.statSync(setupPath).size + ' B, ' + how + ')');
console.log('  [校验] desktop sha256 ' + setupSha.slice(0, 24) + '…');

// 2) 深开鸿 HAP：只认本次 hap-sign.js 签出的产物。
//    旧版把桌面「新建文件夹 (6)/sign」排在 dist 前面，会把上一版旧 HAP 盖回本次发版 ——
//    由于 sha256 是按旧文件重算的，验收会误判通过。这里改为「优先本次构建 + 包内版本强校验」。
let RELEASE_CODE = 0;
try { RELEASE_CODE = Number(JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release.latest.versionCode); } catch (e) {}
const zipRead = require('./lib/zip-read');
function freshHap(p) {
  if (!fs.existsSync(p)) return false;
  /* 包内前端目录以实际壳包为准：v1.7.8 起统一为 resources/rawfile/www/，
     早期壳包曾用 movie-site，这里两个都试，避免路径变更把新鲜度判定打哑。 */
  for (const entry of ['resources/rawfile/www/index.html', 'resources/rawfile/movie-site/index.html']) {
    try {
      const html = zipRead.readText(p, entry);
      const m = html.match(/var KH_APP_CODE\s*=\s*(\d+)/);
      if (m && Number(m[1]) === RELEASE_CODE && html.indexOf('KH_HARMONY') >= 0) return true;
    } catch (e) { /* 换下一个候选路径 */ }
  }
  return false;
}
const buildStamp = (function () { try { return JSON.parse(fs.readFileSync(path.join(DIST, '.hap-build.json'), 'utf8')); } catch (e) { return null; } })();
const builtSha = buildStamp && buildStamp.sha256;
const stampCode = buildStamp ? Number(buildStamp.versionCode || (buildStamp.versions && buildStamp.versions.versionCode) || 0) : 0;
const candidates = [
  path.join(ROOT, 'harmony', 'signing', 'keys', 'sign', 'HongHubMovie.hap'),  // resign_hap.py 本次签名源
  path.join(ROOT, 'harmony', 'signing', 'sign', 'HongHubMovie.hap'),         // 旧签名链产物
  path.join(DIST, 'honghub-harmony.hap'),
  path.join(DIST, 'HongHubMovie.hap'),
  path.join(ROOT, 'harmony', 'HongHubMovie.hap'),
  path.join(os.homedir(), 'Desktop', 'HongHubMovie.hap')
];
// 同版本重复签名会改变 sha256，所以「新鲜」必须由本次构建指纹判定，不能只看包内版本号
let hap = null;
if (builtSha && (stampCode === 0 || stampCode === RELEASE_CODE)) {
  hap = candidates.find(p => freshHap(p) && shaOf(p) === builtSha) || null;
}
if (!hap) {
  console.error('未找到与本次构建指纹一致的新鲜 HAP，已阻断（请先 npm run hap:sign，再重跑 pack）');
  process.exit(1);
}
console.log('  [新鲜度] 已匹配本次构建指纹 ' + builtSha.slice(0, 16) + '…');
let hapSha = '';
{
  const buf = fs.readFileSync(hap);
  for (const name of ['honghub-harmony.hap', 'HongHubMovie.hap']) {
    if (path.resolve(hap) !== path.resolve(path.join(DIST, name))) fs.writeFileSync(path.join(DIST, name), buf);
  }
  hapSha = crypto.createHash('sha256').update(buf).digest('hex');
  writeSha('HongHubMovie.hap', hapSha);
  writeSha('honghub-harmony.hap', hapSha);
  console.log('  [开鸿] ' + path.basename(hap) + ' → honghub-harmony.hap (' + buf.length + ' B · 新鲜度 #' + RELEASE_CODE + ')');
  console.log('  [校验] hap sha256 ' + hapSha.slice(0, 24) + '…');
}

// 3) 本次发版清单：版本 + 产物校验 + 功能快照（服务端 /api/update/install 与自检都读它）
let rel = { latest: {} }, stamp = null, feats = [];
try { rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release; } catch (e) {}
try { stamp = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'feature-version.json'), 'utf8')); } catch (e) {}
try { feats = JSON.parse(fs.readFileSync(path.join(ROOT, 'features', 'manifest.json'), 'utf8')); } catch (e) {}
const latest = rel.latest || {};
const releaseInfo = {
  schema: 1,
  versionName: latest.versionName || null,
  versionCode: latest.versionCode || null,
  publishedAt: latest.publishedAt || null,
  buildAt: new Date().toISOString(),
  artifacts: {
    desktop: { file: 'desktop-setup.exe', size: fs.statSync(setupPath).size, sha256: setupSha },
    hap: hap ? { file: 'honghub-harmony.hap', size: fs.statSync(path.join(DIST, 'honghub-harmony.hap')).size, sha256: hapSha } : null
  },
  features: {
    versionName: stamp && stamp.versionName,
    versionCode: stamp && stamp.versionCode,
    count: Array.isArray(feats) ? feats.length : 0,
    hash: stamp && stamp.hash,
    ids: Array.isArray(feats) ? feats.map(f => String(f && f.id || '')) : []
  }
};
const relTxt = JSON.stringify(releaseInfo, null, 2) + '\n';
fs.writeFileSync(path.join(DIST, 'release.json'), relTxt);
if (fs.existsSync(UPDATES)) fs.writeFileSync(path.join(UPDATES, 'release.json'), relTxt);
console.log('  [清单] release.json v' + releaseInfo.versionName + ' #' + releaseInfo.versionCode +
  ' · 功能 ' + releaseInfo.features.count + ' 项');
console.log('产物同步完成');
