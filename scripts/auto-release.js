#!/usr/bin/env node
'use strict';
/* 鸿汇影 · 全自动出包后同步（一条命令干完，不需要手点）
   1) 读 dist 最新产物与版本（真相源 dist/remote-manifest.json）
   2) 补齐 dist/public 发布目录（exe / 免安装 bin / hap / app-page / manifest / latest.yml）
   3) 同步本机常驻镜像站（默认 C:\Users\admin\HongHubServer\site，可用 KH_MIRROR_DIR 覆盖）
   4) 更新桌面「客户成品」「开发端」两个文件夹，旧版本自动进历史归档
   5) 重新生成客户下载说明（含真实哈希），生成开发端版本说明模板
   用法：node scripts/auto-release.js [--no-desktop] [--no-mirror]
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUB = path.join(DIST, 'public');
const MIRROR = process.env.KH_MIRROR_DIR || 'C:\\Users\\admin\\HongHubServer\\site';
const DESKTOP = process.env.KH_DESKTOP_DIR || path.join(require('os').homedir(), 'Desktop');
const DRY = process.argv.includes('--dry');
const NO_DESKTOP = process.argv.includes('--no-desktop');
const NO_MIRROR = process.argv.includes('--no-mirror');
const log = (...a) => console.log(...a);

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function size(p) { return fs.statSync(p).size; }
function nf(n) { return n.toLocaleString('en-US'); }
/* 小文件按内容哈希判断是否相同：清单/latest.yml/页面体积一样但内容不同时，
   只比体积会把新清单当成"已是最新"跳过，镜像站就永远停在旧版本。 */
const SMALL = 16 * 1024 * 1024;
function sameFile(src, dst) {
  if (!fs.existsSync(dst)) return false;
  if (size(src) !== size(dst)) return false;
  if (size(src) > SMALL) return true;
  return sha256(src) === sha256(dst);
}
function copyKeep(src, dst, skipSameSize) {
  if (!fs.existsSync(src)) throw new Error('缺少文件：' + src);
  if (sameFile(src, dst)) { log('  已是最新：' + path.basename(dst)); return dst; }
  if (DRY) { log('  [预演] 复制 ' + path.basename(src) + ' → ' + dst); return dst; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  log('  复制 ' + path.basename(src) + ' → ' + dst);
  return dst;
}
function rmDuplicates(dir) { return dir; }

const manifestPath = path.join(DIST, 'remote-manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error('缺少 dist/remote-manifest.json，请先 npm run pack');
const M = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const VER = String(M.versionName);
const rel = JSON.parse(fs.readFileSync(path.join(DIST, 'release.json'), 'utf8')).release || {};
const zipName = fs.readdirSync(DIST).find((f) => f.endsWith('.zip') && f.includes(VER));
if (!zipName) throw new Error('找不到 v' + VER + ' 的免安装 zip');

const SRC = {
  exe: path.join(PUB, 'honghub', 'v' + VER, 'desktop-setup.exe'),
  hap: path.join(PUB, 'honghub', 'v' + VER, 'HongHubMovie.hap'),
  bin: path.join(PUB, 'honghub', 'v' + VER, 'honghub-desktop-' + VER + '-win.bin')
};
const DIST_EXE = path.join(DIST, 'desktop-setup.exe');
const DIST_HAP = path.join(DIST, 'honghub-harmony.hap');
const DIST_ZIP = path.join(DIST, zipName);

log('=== 全自动同步 v' + VER + ' / #' + M.versionCode + ' ===');

/* 1) 补齐发布目录 */
log('[1/4] 发布目录 dist/public');
copyKeep(DIST_EXE, SRC.exe);
copyKeep(DIST_HAP, SRC.hap);
copyKeep(DIST_ZIP, SRC.bin);
const bytes = {
  exe: size(SRC.exe), hap: size(SRC.hap), bin: size(SRC.bin),
  exeSha: sha256(SRC.exe), hapSha: sha256(SRC.hap), binSha: sha256(SRC.bin)
};
/* 1.1 把清单的下发地址改成本机可达的镜像站（默认 http://127.0.0.1:8099）。
   原清单写的是公网隧道域名，隧道不通时客户端拉到的是 HTTP 0，自动更新等于没有。 */
const BASE = (process.env.KH_BASE_URL || 'http://127.0.0.1:8099').replace(/\/+$/, '');
M.baseUrl = BASE;
M.desktopUrl = BASE + '/honghub/v' + VER + '/desktop-setup.exe';
M.hapUrl = BASE + '/honghub/v' + VER + '/HongHubMovie.hap';
M.desktopSha256 = bytes.exeSha;
M.hapSha256 = bytes.hapSha;
M.desktopSize = bytes.exe;
M.hapSize = bytes.hap;
M.mirrorUrl = BASE;
if (!DRY) {
  fs.writeFileSync(manifestPath, JSON.stringify(M, null, 2) + '\n', 'utf8');
  log('  清单已改写下发地址：' + BASE + ' · v' + VER);
}
for (const n of ['remote-manifest.json', 'latest.yml']) {
  copyKeep(path.join(DIST, n), path.join(PUB, n));
}
copyKeep(path.join(ROOT, 'app', 'index.html'), path.join(PUB, 'app-page.html'));

/* 1.2 随包的下发端点（server/public-endpoint.json，会被打进 exe）也要跟着版本走，
   否则客户端更新检查一直去撞已经失效的旧域名和旧版本号。 */
const ENDPOINT = path.join(ROOT, 'server', 'public-endpoint.json');
if (fs.existsSync(ENDPOINT)) {
  try {
    const ep = JSON.parse(fs.readFileSync(ENDPOINT, 'utf8'));
    ep.baseUrl = BASE;
    ep.versionName = VER;
    ep.versionCode = M.versionCode;
    ep.desktopUrl = BASE + '/honghub/v' + VER + '/desktop-setup.exe';
    ep.hapUrl = BASE + '/honghub/v' + VER + '/HongHubMovie.hap';
    ep.mirrors = [];
    ep.distribution = 'local-mirror';
    if (!DRY) fs.writeFileSync(ENDPOINT, JSON.stringify(ep, null, 2) + '\n', 'utf8');
    log('  随包端点已对齐：' + BASE + ' · v' + VER);
  } catch (e) { log('  随包端点更新失败：' + e.message); }
}

/* 2) 镜像站 */
if (!NO_MIRROR) {
  log('[2/4] 本机镜像站 ' + MIRROR);
  if (!fs.existsSync(MIRROR)) {
    log('  跳过：镜像站目录不存在（' + MIRROR + '）');
  } else {
    const md = path.join(MIRROR, 'honghub', 'v' + VER);
    copyKeep(SRC.exe, path.join(md, 'desktop-setup.exe'));
    copyKeep(SRC.bin, path.join(md, 'honghub-desktop-' + VER + '-win.bin'));
    copyKeep(SRC.hap, path.join(md, 'HongHubMovie.hap'));
    copyKeep(path.join(PUB, 'remote-manifest.json'), path.join(MIRROR, 'remote-manifest.json'));
    copyKeep(path.join(PUB, 'app-page.html'), path.join(MIRROR, 'app-page.html'));
    // 下载中心首页版本与链接
    const idx = path.join(MIRROR, 'index.html');
    if (fs.existsSync(idx) && !DRY) {
      let h = fs.readFileSync(idx, 'utf8');
      const before = h;
      h = h.replace(/<span class="badge">v[\d.]+<\/span>/, '<span class="badge">v' + VER + '</span>');
      h = h.replace(/版本号 [\d.]+ \/ #\d+/, '版本号 ' + VER + ' / #' + M.versionCode);
      h = h.replace(/\/honghub\/v[\d.]+\//g, '/honghub/v' + VER + '/');
      h = h.replace(/<p>体积 [\d,]+\s*B<\/p>/g, (m2) => m2);
      h = h.replace(new RegExp('体积 ' + nf(bytes.exe) + ' B', 'g'), '体积 ' + nf(bytes.exe) + ' B');
      h = h.replace(/下载 Setup [\d.]+\.exe/g, '下载 Setup ' + VER + '.exe');
      h = h.replace(/honghub-desktop-[\d.]+-win\.bin/g, 'honghub-desktop-' + VER + '-win.bin');
      if (h !== before) { fs.writeFileSync(idx, h); log('  首页版本号/链接已更新'); }
      else log('  首页已是当前版本');
    }
  }
}

/* 3) 桌面文件夹 */
if (!NO_DESKTOP) {
  log('[3/4] 桌面文件夹 ' + DESKTOP);
  const clientDir = path.join(DESKTOP, '鸿汇影·客户成品_v' + VER);
  const devDir = path.join(DESKTOP, '鸿汇影·开发端_v' + VER);
  const archDir = path.join(DESKTOP, '鸿汇影·历史归档');
  if (!DRY) {
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(devDir, { recursive: true });
    fs.mkdirSync(archDir, { recursive: true });
  }
  copyKeep(SRC.exe, path.join(clientDir, '鸿汇影桌面版 Setup ' + VER + '.exe'));
  copyKeep(SRC.bin, path.join(clientDir, '鸿汇影桌面版 Setup ' + VER + '.zip'));
  copyKeep(SRC.hap, path.join(clientDir, 'HongHubMovie.hap'));
  copyKeep(SRC.exe, path.join(devDir, '鸿汇影桌面版 Setup ' + VER + '.exe'));
  copyKeep(SRC.hap, path.join(devDir, 'HongHubMovie.hap'));
  // 旧版本的客户成品 / 开发端夹自动归档
  if (!DRY) {
    for (const d of fs.readdirSync(DESKTOP)) {
      if (!/^鸿汇影·(客户成品|开发端)_v[\d.]+$/.test(d)) continue;
      if (d === path.basename(clientDir) || d === path.basename(devDir)) continue;
      const from = path.join(DESKTOP, d);
      const to = path.join(archDir, d);
      if (fs.existsSync(to)) continue;
      fs.renameSync(from, to);
      log('  归档旧夹 ' + d);
    }
  }
  // 客户下载说明（每次按真实哈希重写）
  const readme = [
    '鸿汇影 · 客户下载说明（v' + VER + ' / #' + M.versionCode + '）',
    '生成时间：' + new Date().toISOString().slice(0, 10),
    '本文件夹只放客户直接能用的成品，不含开发端 / 运维界面。',
    '',
    '一、装哪一个',
    '  Windows：「鸿汇影桌面版 Setup ' + VER + '.exe」双击安装；或解压「鸿汇影桌面版 Setup ' + VER + '.zip」用免安装版。',
    '  深开鸿 / OpenHarmony：装「HongHubMovie.hap」（应用市场直装，或 hdc install）。',
    '',
    '二、文件与校验值（SHA-256）',
    '  鸿汇影桌面版 Setup ' + VER + '.exe',
    '    ' + nf(bytes.exe) + ' 字节',
    '    ' + bytes.exeSha,
    '  鸿汇影桌面版 Setup ' + VER + '.zip',
    '    ' + nf(bytes.bin) + ' 字节',
    '    ' + bytes.binSha,
    '  HongHubMovie.hap',
    '    ' + nf(bytes.hap) + ' 字节',
    '    ' + bytes.hapSha,
    '',
    '校验方法（Windows）：certutil -hashfile "文件名" SHA256，或右键 → 属性 → 详细信息。',
    '',
    '三、系统适配',
    '  HAP 最低 API 11（KaihongOS / OpenHarmony 4.0 起可装），目标 API 26；',
    '  前端读系统版本自动切换安全区、手势返回与全屏策略，新老系统同一套包；',
    '  证书自 v1.7.8 固化，覆盖安装不需要先卸载。',
    '',
    '四、出问题怎么反馈',
    '  发「频道 / 大概时间 / 报错原文」，服务端按播放回传自动建单换源，修好的源随清单热更新。'
  ].join('\r\n');
  if (!DRY) fs.writeFileSync(path.join(clientDir, '客户下载说明.txt'), readme, 'utf8');
  log('  已生成客户下载说明');
  /* 说明也放一份到镜像站根目录，访问镜像站的人直接能读，不用翻桌面 */
  if (!DRY) {
    try {
      const mirrorNote = path.join(MIRROR, '客户下载说明.txt');
      if (fs.existsSync(MIRROR)) fs.writeFileSync(mirrorNote, readme, 'utf8');
    } catch (e) { log('  镜像站说明同步失败：' + e.message); }
  }
}

log('[4/4] 完成');
log('  版本 v' + VER + ' · exe ' + nf(bytes.exe) + ' B · hap ' + nf(bytes.hap) + ' B · bin ' + nf(bytes.bin) + ' B');
log('  exe sha256 ' + bytes.exeSha);
log('  hap sha256 ' + bytes.hapSha);
