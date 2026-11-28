#!/usr/bin/env node
'use strict';
/* 出包链产物一致性总检（台账 #159 的兜底闸门）。
   目的：把「同一个版本号下 dist / 归档 / 清单 / 架构表 / 镜像 / HAP 多处产物互相不一致」当场抓出来。
   1.7.87 踩过的坑都在这里覆盖：
     · 归档把开发端 exe 当客户包（回滚会装到带 /admin 的包）
     · archs.json 记开发端尺寸、dist 别名被中间产物覆盖
     · HAP 没编译原生改动却「版本对、哈希自洽」
   用法：node scripts/check-artifacts.js [--quiet]
   只读：不改任何产物、不修哈希，发现问题就报；有 fail 则退出码 1。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const clientStamp = require('./lib/client-stamp');
const hapSymbols = require('./lib/hap-symbols');

const QUIET_ARG = process.argv.includes('--quiet');
function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function exists(p) { return fs.existsSync(p); }
function size(p) { return fs.statSync(p).size; }
function sha(p) { return clientStamp.sha256File(p); }

function run(opts) {
  const quiet = !!(opts && opts.quiet) || QUIET_ARG;
  const fails = [], warns = [], oks = [];
  const bad = (m) => fails.push(m);
  const warn = (m) => warns.push(m);
  const ok = (m) => { oks.push(m); };

  /* —— 0) 版本真相源 —— */
  const man = readJson(path.join(ROOT, 'server', 'manifest.json'));
  const V = man && man.release && man.release.latest ? String(man.release.latest.versionName || '') : '';
  const C = man && man.release && man.release.latest ? Number(man.release.latest.versionCode || 0) : 0;
  if (!V || !C) {
    bad('server/manifest.json 取不到 release.latest（版本真相源不可用）');
    return finish();
  }
  const release = readJson(path.join(DIST, 'release.json'));
  if (!release) bad('dist/release.json 缺失');
  else if (String(release.versionName) !== V || Number(release.versionCode) !== C) {
    bad('dist/release.json 版本 ' + release.versionName + '/#' + release.versionCode + ' ≠ manifest ' + V + '/#' + C);
  } else ok('版本真相源：' + V + ' / #' + C);

  /* —— 1) x64 客户包：指纹 + dist/client + dist 别名 + 归档 + release.json —— */
  const setupName = '鸿汇影桌面版 Setup ' + V + '.exe';
  const x64Stamp = clientStamp.read(DIST, 'x64');
  if (!x64Stamp) bad('缺少 x64 客户版指纹 dist/client/.client-build-x64.json（先跑 build-client-exe.js）');
  else if (String(x64Stamp.version) !== V) bad('x64 客户版指纹版本 ' + x64Stamp.version + ' ≠ ' + V);

  const x64Client = path.join(DIST, 'client', setupName);
  const x64Alias = path.join(DIST, 'desktop-setup.exe');
  const x64Root = path.join(DIST, setupName);
  const x64Arc = path.join(ROOT, 'releases', 'v' + V, setupName);
  const x64Pairs = [
    ['dist/client/' + setupName, x64Client, true],
    ['dist/' + setupName, x64Root, true],
    ['dist/desktop-setup.exe', x64Alias, true],
    ['releases/v' + V + '/' + setupName, x64Arc, false]
  ];
  let x64Sha = '';
  for (const [tag, p, required] of x64Pairs) {
    if (!exists(p)) { required ? bad('缺少 ' + tag) : warn('缺少归档件 ' + tag); continue; }
    const s = sha(p);
    if (!x64Sha) x64Sha = s;
    else if (s !== x64Sha) bad('x64 产物互相不一致：' + tag + '（' + s.slice(0, 12) + '… ≠ ' + x64Sha.slice(0, 12) + '…）');
    if (x64Stamp && x64Stamp.setup && s !== String(x64Stamp.setup.sha256).toLowerCase()) {
      bad(tag + ' 与客户版指纹不符（疑似开发端包或中间产物混入）');
    }
  }
  if (x64Sha) {
    const a = release && release.artifacts && release.artifacts.desktop;
    if (!a) bad('dist/release.json 缺 artifacts.desktop');
    else {
      const ap = path.join(DIST, a.file || 'desktop-setup.exe');
      if (!exists(ap)) bad('release.json 指向的产物不存在：' + (a.file || 'desktop-setup.exe'));
      else if (String(a.sha256).toLowerCase() !== x64Sha || Number(a.size) !== size(ap)) {
        bad('release.json artifacts.desktop 与实际 x64 产物不一致（清单里 ' + Number(a.size) + ' B / ' + String(a.sha256).slice(0, 12) + '…）');
      } else ok('x64 客户包四处一致（client / dist 根 / 别名 / 归档 / 清单）：' + size(x64Client) + ' B · ' + x64Sha.slice(0, 16) + '…');
    }
    const sf = x64Alias + '.sha256';
    if (exists(sf)) {
      const want = String(fs.readFileSync(sf, 'utf8')).trim().split(/\s+/)[0].toLowerCase();
      if (want !== x64Sha) bad('dist/desktop-setup.exe.sha256 与产物哈希不符（' + want.slice(0, 12) + '… ≠ ' + x64Sha.slice(0, 12) + '…）');
      else ok('dist/desktop-setup.exe.sha256 与产物一致');
    } else bad('缺少 dist/desktop-setup.exe.sha256');
  }

  /* —— 2) arm64 —— */
  const armName = '鸿汇影桌面版 Setup ' + V + '-arm64.exe';
  const armClient = path.join(DIST, 'client', armName);
  const armRoot = path.join(DIST, armName);
  const armArc = path.join(ROOT, 'releases', 'v' + V, armName);
  const armStamp = clientStamp.read(DIST, 'arm64');
  if (!exists(armClient)) warn('arm64 客户包不存在（dist/client/' + armName + '），ARM 设备无原生包可回滚');
  else {
    if (!armStamp) warn('缺少 arm64 客户版指纹 dist/client/.client-build-arm64.json');
    else if (String(armStamp.version) !== V) bad('arm64 客户版指纹版本 ' + armStamp.version + ' ≠ ' + V);
    else {
      const vr = clientStamp.verify(armStamp, armClient);
      if (!vr.ok) bad('arm64 客户包与指纹不符：' + vr.reason);
      else ok('arm64 客户包与指纹一致：' + vr.size + ' B · ' + vr.sha256.slice(0, 16) + '…');
    }
    const armSha = sha(armClient);
    if (exists(armRoot) && sha(armRoot) !== armSha) bad('dist/' + armName + ' 与 dist/client 的 arm64 包不一致');
    if (exists(armArc) && sha(armArc) !== armSha) warn('归档件 releases/v' + V + '/' + armName + ' 与 dist/client 不一致（旧归档残留）');
  }

  /* —— 3) 免安装 zip（client 原件 + dist 根别名） —— */
  const zipChecks = [
    ['client x64 zip', path.join(DIST, 'client', '鸿汇影免安装 ' + V + '.zip')],
    ['dist 根 x64 别名 zip', path.join(DIST, '鸿汇影桌面版 Setup ' + V + '.zip')],
    ['client arm64 zip', path.join(DIST, 'client', '鸿汇影免安装 ' + V + '-arm64.zip')],
    ['dist 根 arm64 别名 zip', path.join(DIST, '鸿汇影桌面版 Setup ' + V + '-arm64.zip')]
  ];
  for (const [tag, p] of zipChecks) {
    if (!exists(p)) { (tag.indexOf('arm64') >= 0 ? warn : bad)('缺少 ' + tag + '：' + rel(p)); continue; }
    if (x64Stamp && x64Stamp.zip && tag === 'client x64 zip' && sha(p) !== String(x64Stamp.zip.sha256).toLowerCase()) {
      bad('client x64 zip 与指纹不符');
    }
    if (armStamp && armStamp.zip && tag === 'client arm64 zip' && sha(p) !== String(armStamp.zip.sha256).toLowerCase()) {
      bad('client arm64 zip 与指纹不符');
    }
  }
  const zx = path.join(DIST, 'client', '鸿汇影免安装 ' + V + '.zip');
  const zxa = path.join(DIST, '鸿汇影桌面版 Setup ' + V + '.zip');
  if (exists(zx) && exists(zxa) && sha(zx) !== sha(zxa)) bad('x64 免安装 zip 与 dist 根别名内容不一致');
  else if (exists(zx) && exists(zxa)) ok('x64 免安装 zip 与 dist 别名一致：' + size(zx) + ' B');
  const zaz = path.join(DIST, 'client', '鸿汇影免安装 ' + V + '-arm64.zip');
  const zaa = path.join(DIST, '鸿汇影桌面版 Setup ' + V + '-arm64.zip');
  if (exists(zaz) && exists(zaa) && sha(zaz) !== sha(zaa)) bad('arm64 免安装 zip 与 dist 根别名内容不一致');

  /* —— 4) archs.json 与实际产物 —— */
  const archs = readJson(path.join(DIST, 'archs.json'));
  if (!archs || !archs.archs) bad('dist/archs.json 缺失或结构异常');
  else {
    const ax = archs.archs.x64, aa = archs.archs.arm64;
    if (!ax) bad('archs.json 缺 x64 条目');
    else if (ax.status === 'ready') {
      const f = path.join(DIST, ax.file || '');
      if (!exists(f)) bad('archs.json x64 指向的文件不存在：' + ax.file);
      else if (Number(ax.size) !== size(f) || String(ax.sha256).toLowerCase() !== sha(f)) {
        bad('archs.json x64 记录与实物不符（记 ' + Number(ax.size) + ' B / ' + String(ax.sha256).slice(0, 12) + '…，实物 ' + size(f) + ' B / ' + sha(f).slice(0, 12) + '…）');
      } else ok('archs.json x64 与实物一致：' + ax.file + ' · ' + Number(ax.size) + ' B');
    }
    if (aa && aa.status === 'ready') {
      if (!exists(armClient)) bad('archs.json 标 arm64 ready，但 dist/client 没有 arm64 客户包');
      else if (Number(aa.size) !== size(armClient) || String(aa.sha256).toLowerCase() !== sha(armClient)) {
        bad('archs.json arm64 记录与客户包不一致');
      } else ok('archs.json arm64 与客户包一致');
    } else if (aa && aa.status === 'fallback') {
      warn('archs.json 标 arm64=fallback（本版没有原生 arm64 包，ARM 用户走 x64 转译）');
    }
    const ah = archs.hap;
    const hp = path.join(DIST, 'honghub-harmony.hap');
    if (!ah) warn('archs.json 缺 hap 条目');
    else if (!exists(hp)) bad('dist/honghub-harmony.hap 缺失');
    else if (Number(ah.size) !== size(hp) || String(ah.sha256).toLowerCase() !== sha(hp)) {
      bad('archs.json hap 记录与实际 HAP 不符');
    } else ok('archs.json hap 与实物一致');
  }

  /* —— 5) HAP 三处副本 + 出包指纹 + 原生符号 —— */
  const stampFile = path.join(DIST, '.hap-build.json');
  const hapStamp = readJson(stampFile);
  const hapMain = path.join(DIST, 'honghub-harmony.hap');
  const hapPub = path.join(DIST, 'public', 'honghub', 'v' + V, 'HongHubMovie.hap');
  const hapAlias = path.join(DIST, 'HongHubMovie.hap');
  if (!hapStamp) bad('dist/.hap-build.json 缺失');
  else {
    if (Number(hapStamp.versionCode) !== C || String(hapStamp.versionName) !== V) {
      bad('.hap-build.json 版本 #' + hapStamp.versionCode + ' ≠ ' + C + '（' + V + '）');
    } else ok('HAP 出包指纹版本对齐 #' + C);
    if (!exists(hapMain)) bad('dist/honghub-harmony.hap 缺失');
    else {
      const s = sha(hapMain);
      if (String(hapStamp.sha256).toLowerCase() !== s || Number(hapStamp.size) !== size(hapMain)) {
        bad('HAP 与 .hap-build.json 指纹不符（疑似旧包混入）');
      } else {
        ok('HAP 与出包指纹一致：' + size(hapMain) + ' B · ' + s.slice(0, 16) + '…');
        if (exists(hapAlias) && sha(hapAlias) !== s) bad('dist/HongHubMovie.hap 与 honghub-harmony.hap 不一致');
        if (exists(hapPub) && sha(hapPub) !== s) bad('dist/public 下发布的 HAP 与 dist 产物不一致');
        else if (exists(hapPub)) ok('dist/public 下发布的 HAP 与产物一致');
        try {
          const res = hapSymbols.check(hapMain, hapSymbols.loadSymbols(ROOT));
          if (res.missing.length) bad('HAP 包内缺少原生符号：' + res.missing.join('、') + '（源码改了没编译进壳包）');
          else ok('HAP 原生符号齐备：' + res.symbols.join('、') + '（检查 ' + res.entries + ' 个条目）');
        } catch (e) { bad('HAP 符号检查失败：' + e.message); }
      }
    }
  }

  /* —— 6) 开发端 HAP 变体 —— */
  const devStamp = readJson(path.join(DIST, '.hap-build-dev.json'));
  const devHap = path.join(DIST, 'honghub-harmony-dev.hap');
  if (!devStamp) warn('dist/.hap-build-dev.json 缺失（本版可能没出开发端变体）');
  else {
    if (Number(devStamp.versionCode) !== C + 100) bad('开发端 HAP 版本码 #' + devStamp.versionCode + ' ≠ 发版 +100（' + (C + 100) + '）');
    else ok('开发端 HAP 版本码偏移正确 #' + devStamp.versionCode);
    if (!exists(devHap)) bad('dist/honghub-harmony-dev.hap 缺失');
    else if (String(devStamp.sha256).toLowerCase() !== sha(devHap)) bad('开发端 HAP 与指纹不符');
    else {
      ok('开发端 HAP 与指纹一致：' + size(devHap) + ' B');
      try {
        const res = hapSymbols.check(devHap, hapSymbols.loadSymbols(ROOT));
        if (res.missing.length) bad('开发端 HAP 包内缺少原生符号：' + res.missing.join('、'));
        else ok('开发端 HAP 原生符号齐备');
      } catch (e) { bad('开发端 HAP 符号检查失败：' + e.message); }
    }
  }

  /* —— 7) 公网发布目录（存在才查，不存在说明本版没下发） —— */
  const pubDir = path.join(DIST, 'public', 'honghub', 'v' + V);
  if (exists(pubDir)) {
    const map = [
      ['desktop-setup.exe', x64Client],
      ['HongHubMovie.hap', hapMain]
    ];
    for (const [n, src] of map) {
      const p = path.join(pubDir, n);
      if (!exists(p)) bad('发布目录缺 ' + n);
      else if (exists(src) && sha(p) !== sha(src)) bad('发布目录 ' + n + ' 与 dist 产物不一致');
    }
    ok('发布目录 dist/public/honghub/v' + V + ' 与 dist 产物一致');
  } else warn('dist/public/honghub/v' + V + ' 不存在（本版尚未组装发布目录）');

  return finish();

  function finish() {
    if (!quiet) {
      for (const m of oks) console.log('  [PASS] ' + m);
    }
    for (const m of warns) console.log('  [WARN] ' + m);
    for (const m of fails) console.log('  [FAIL] ' + m);
    console.log('\n产物一致性总检：' + oks.length + ' 项通过 / ' + warns.length + ' 警告 / ' + fails.length + ' 失败' +
      (fails.length ? '——未通过' : '——全部通过'));
    return { fails, warns, oks, code: fails.length ? 1 : 0 };
  }
}

module.exports = { run };

if (require.main === module) {
  const r = run({ quiet: QUIET_ARG });
  process.exit(r.code);
}
