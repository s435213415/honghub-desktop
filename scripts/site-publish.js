#!/usr/bin/env node
'use strict';
/* 鸿汇影 · 旧公网站点（workbuddy-sites）发布接入口
   站点发布能力只能由 WorkBuddy 客户端/宿主触发，脚本无法直接点，所以本脚本职责：
     1) 检查 dist/public 是否就绪（版本、三件成品、清单哈希、目录精简）
     2) 对比线上清单，判断「需要发布 / 已是最新」
     3) --ready  输出机器可读的发布准备结论（供宿主/agent 决定是否调发布工具）
        默认     输出人类可读的检查报告 + 发布要点
     4) --verify 只回验线上（版本/哈希/三件直链），发布后调用

   典型用法（升级后）：
     node scripts/site-publish.js            # 检查是否该发
     node scripts/site-publish.js --ready    # 确认 dist/public 已精简就绪
     （宿主/agent 调站点发布工具，directory=dist/public，原地覆盖，链接不变）
     node scripts/site-publish.js --verify   # 发布后回验，全绿才算接上
*/
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PUB = path.join(DIST, 'public');
const MAN = path.join(PUB, 'remote-manifest.json');
const ENDPOINT = path.join(ROOT, 'server', 'public-endpoint.json');
const READY = process.argv.includes('--ready');
const VERIFY = process.argv.includes('--verify');
const DEEP = process.argv.includes('--deep');

function j(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sha256(p) { return require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function get(url, timeout) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : require('http');
    const req = lib.get(url, { timeout: timeout || 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location, timeout));
      }
      let b = ''; res.setEncoding('utf8');
      res.on('data', (c) => b += c);
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, body: '' }); });
    req.on('error', () => resolve({ code: 0, body: '' }));
  });
}
function head(url, timeout) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : require('http');
    const req = lib.request(url, { method: 'GET', headers: { Range: 'bytes=0-31' }, timeout: timeout || 20000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ code: res.statusCode }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ code: 0 }); });
    req.on('error', () => resolve({ code: 0 }));
    req.end();
  });
}

(async function main() {
  if (!fs.existsSync(MAN)) {
    console.log(JSON.stringify({ ok: false, error: '缺少 dist/public/remote-manifest.json，先跑 npm run ship:client' }));
    process.exit(2);
  }
  const man = j(MAN);
  const ep = fs.existsSync(ENDPOINT) ? j(ENDPOINT) : {};
  const base = String(man.baseUrl || ep.baseUrl || '').replace(/\/+$/, '');
  const q = String(man.shareQuery || ep.shareQuery || '');
  const VER = String(man.versionName);
  const CODE = Number(man.versionCode);

  // ---- 本地准备检查 ----
  const hubDir = path.join(PUB, 'honghub');
  const versionDirs = fs.existsSync(hubDir)
    ? fs.readdirSync(hubDir).filter((n) => { try { return fs.statSync(path.join(hubDir, n)).isDirectory(); } catch (e) { return false; } })
    : [];
  const keep = 'v' + VER;
  const extra = versionDirs.filter((d) => d !== keep);
  const vdir = path.join(hubDir, keep);
  const artifacts = {
    exe: path.join(vdir, 'desktop-setup.exe'),
    hap: path.join(vdir, 'HongHubMovie.hap'),
    bin: path.join(vdir, 'honghub-desktop-' + VER + '-win.bin')
  };
  const local = {
    versionName: VER, versionCode: CODE, baseUrl: base,
    dirLean: extra.length === 0, extraVersions: extra,
    artifacts: {}, manifest: {}
  };
  let localOk = true;
  for (const [k, p] of Object.entries(artifacts)) {
    const exists = fs.existsSync(p);
    local.artifacts[k] = { exists, size: exists ? fs.statSync(p).size : 0, sha256: exists ? sha256(p).slice(0, 16) : '' };
    if (!exists) localOk = false;
  }
  const exeSha = local.artifacts.exe.sha256;
  const hapSha = local.artifacts.hap.sha256;
  local.manifest.desktopSha256 = String(man.desktopSha256 || '').slice(0, 16);
  local.manifest.hapSha256 = String(man.hapSha256 || '').slice(0, 16);
  const hashMatch = exeSha === local.manifest.desktopSha256 && hapSha === local.manifest.hapSha256;
  if (!hashMatch || !local.dirLean) localOk = false;

  if (VERIFY) {
    // ---- 线上回验 ----
    const r = await get(base + '/remote-manifest.json' + q);
    let online = null;
    try { online = JSON.parse(r.body); } catch (e) { }
    const onlineOk = r.code === 200 && online && Number(online.versionCode) === CODE &&
      String(online.desktopSha256 || '').slice(0, 16) === exeSha &&
      String(online.hapSha256 || '').slice(0, 16) === hapSha;
    const links = {};
    for (const [k, rel] of Object.entries({
      manifest: '/remote-manifest.json',
      exe: '/honghub/v' + VER + '/desktop-setup.exe',
      hap: '/honghub/v' + VER + '/HongHubMovie.hap',
      bin: '/honghub/v' + VER + '/honghub-desktop-' + VER + '-win.bin',
      index: '/index.html'
    })) {
      const hr = await head(base + rel + q);
      links[k] = hr.code; // 200 或 206 都算可达
    }
    const linksOk = Object.values(links).every((c) => c === 200 || c === 206);
    const result = {
      ok: !!onlineOk && linksOk,
      onlineVersion: online ? online.versionName + ' / #' + online.versionCode : '不可读',
      expectedVersion: VER + ' / #' + CODE,
      links, local
    };
    if (READY) console.log(JSON.stringify(result));
    else {
      console.log('=== 旧公站点回验 ===');
      console.log('  线上版本: ' + result.onlineVersion + ' (期望 ' + result.expectedVersion + ')');
      for (const [k, c] of Object.entries(links)) console.log('  [' + (c === 200 || c === 206 ? 'PASS' : 'FAIL') + '] ' + k + ' HTTP ' + c);
      console.log('  ' + (result.ok ? '✓ 站点已接上，线上=本地，成品可下载' : '✗ 站点未跟上，需重新发布'));
    }
    process.exit(result.ok ? 0 : 1);
  }

  // ---- 准备/判定 ----
  const r = await get(base + '/remote-manifest.json' + q);
  let online = null;
  try { online = JSON.parse(r.body); } catch (e) { }
  const upToDate = online && Number(online.versionCode) === CODE &&
    String(online.desktopSha256 || '').slice(0, 16) === exeSha &&
    String(online.hapSha256 || '').slice(0, 16) === hapSha;

  const result = {
    ok: localOk,
    ready: localOk && !upToDate,
    upToDate: !!upToDate,
    version: VER + ' / #' + CODE,
    onlineVersion: online ? online.versionName + ' / #' + online.versionCode : '不可读',
    baseUrl: base, shareQuery: q,
    publishDir: PUB,
    local
  };
  if (READY) console.log(JSON.stringify(result));
  else {
    console.log('=== 旧公站点发布检查 ===');
    console.log('  本地版本: ' + result.version + ' · 线上: ' + result.onlineVersion);
    console.log('  发布目录: ' + PUB);
    console.log('  目录精简: ' + (local.dirLean ? 'PASS（仅 ' + keep + '）' : 'FAIL（多余 ' + extra.join(', ') + '，先跑 auto-release）'));
    for (const [k, a] of Object.entries(local.artifacts)) {
      console.log('  [' + (a.exists ? 'PASS' : 'FAIL') + '] ' + k + ' ' + a.size + 'B sha=' + a.sha256);
    }
    console.log('  哈希一致: ' + (hashMatch ? 'PASS' : 'FAIL'));
    console.log('  发布判定: ' + (upToDate ? '已是最新，无需发布' : (localOk ? '需要发布（dist/public 已就绪）' : '不可发布，先修复本地检查')));
    console.log('  发布方式: WorkBuddy 宿主发布 dist/public（原地覆盖，链接不变）');
    console.log('  发布后回验: node scripts/site-publish.js --verify');
  }
  process.exit(result.upToDate || result.ready ? 0 : 2);
})();
