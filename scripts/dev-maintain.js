#!/usr/bin/env node
'use strict';
/* 开发者端维护体检（只读，不改任何产物）
   跑一次把「版本 / 成品哈希 / 镜像站 / 隧道域名漂移」四件事核清，输出 PASS/FAIL 汇总。
   用法：npm run maintain        全部检查
         npm run maintain -- --quick   跳过公网下载探测（不联网也能跑）
   退出码：全 PASS 为 0，有 FAIL 为 1。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const QUICK = process.argv.includes('--quick');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? ' — ' + detail : ''));
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function sha256File(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch (e) { return null; }
}

function get(url, timeoutMs) {
  return new Promise((resolve) => {
    const mod = /^https:/i.test(url) ? https : http;
    const req = mod.get(url, { timeout: timeoutMs || 15000, headers: { 'user-agent': 'HongHubMaintain/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(get(next, timeoutMs));
      }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => { size += c.length; if (chunks.length < 32) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, size, body: Buffer.concat(chunks) }));
      res.on('error', () => resolve({ status: 0, size: 0, body: null }));
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ status: 0, size: 0, body: null, timeout: true }); });
    req.on('error', () => resolve({ status: 0, size: 0, body: null }));
  });
}

function findCustomerNote() {
  const desktop = path.join(os.homedir(), 'Desktop');
  let names = [];
  try { names = fs.readdirSync(desktop); } catch (e) { return null; }
  /* 现在的交付结构是桌面「鸿汇影·客户成品_v<ver>」；旧的「*交付中心/客户成品」也兼容 */
  const direct = names.filter((n) => /鸿汇影·客户成品_v[\d.]+/.test(n)).sort().reverse();
  for (const d of direct) {
    const note = path.join(desktop, d, '客户下载说明.txt');
    if (fs.existsSync(note)) return note;
  }
  const centers = names.filter((n) => /交付中心/.test(n) && !/历史归档/.test(n)).sort().reverse();
  for (const c of centers) {
    let subs = [];
    try { subs = fs.readdirSync(path.join(desktop, c)); } catch (e) { continue; }
    for (const s of subs) {
      if (!/客户成品/.test(s)) continue;
      const note = path.join(desktop, c, s, '客户下载说明.txt');
      if (fs.existsSync(note)) return note;
    }
  }
  return null;
}

(async function main() {
  console.log('=== 开发者端维护体检 ===');
  console.log('  工程：' + ROOT);
  console.log('  时间：' + new Date().toLocaleString('zh-CN', { hour12: false }));

  /* 1. 版本一致性 */
  console.log('\n[1/5] 版本一致性');
  const v = spawnSync(process.execPath, [path.join(__dirname, 'version.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  check('version.js --check', v.status === 0, (String(v.stdout || '').trim().split(/\r?\n/).pop() || '').slice(0, 120));

  const pkg = readJson(path.join(ROOT, 'package.json')) || {};
  const manifest = readJson(path.join(ROOT, 'server', 'manifest.json')) || {};
  const latest = (manifest.release && manifest.release.latest) || {};
  check('package.json 与 manifest 版本一致',
    pkg.version && latest.versionName && String(pkg.version) === String(latest.versionName),
    'package=' + pkg.version + ' manifest=' + latest.versionName + ' / #' + latest.versionCode);

  /* 2. 三件成品与桌面基线 */
  console.log('\n[2/5] 成品与基线');
  const art = [
    ['exe', path.join(DIST, 'desktop-setup.exe')],
    ['hap', path.join(DIST, 'HongHubMovie.hap')],
    ['zip', path.join(DIST, '鸿汇影桌面版 Setup ' + (pkg.version || '') + '.zip')]
  ];
  const notePath = findCustomerNote();
  if (!notePath) {
    check('找到客户下载说明基线', false, '桌面上没找到「*交付中心/*客户成品*/客户下载说明.txt」');
  } else {
    const note = fs.readFileSync(notePath, 'utf8');
    const vm = note.match(/v(\d+\.\d+\.\d+)\s*\/\s*#(\d+)/);
    check('基线说明版本 = 当前版本',
      vm && vm[1] === String(pkg.version) && String(vm[2]) === String(latest.versionCode),
      vm ? 'v' + vm[1] + ' / #' + vm[2] : '说明里没写版本行');
    const hashes = {};
    for (const line of note.split(/\r?\n/)) {
      const m = line.match(/^(exe|hap|zip)\s+([0-9a-f]{64})/i);
      if (m) hashes[m[1].toLowerCase()] = m[2].toLowerCase();
    }
    for (const [kind, p] of art) {
      const sha = sha256File(p);
      if (!sha) { check(kind + ' 产物存在', false, p + ' 读不到'); continue; }
      const expect = hashes[kind];
      check(kind + ' 哈希与基线一致', !expect || expect === sha,
        expect ? (sha.slice(0, 16) + ' vs 基线 ' + expect.slice(0, 16)) : '说明里没有该条哈希（跳过比对）');
    }
  }

  /* 3. 镜像站与清单 */
  console.log('\n[3/5] 镜像站与更新清单');
  const endpoint = readJson(path.join(ROOT, 'server', 'public-endpoint.json')) || {};
  const base = String(endpoint.baseUrl || '').replace(/\/+$/, '');
  check('public-endpoint.json 有 baseUrl', !!base, base || '缺失');
  if (base && !QUICK) {
    const m = await get(base + '/remote-manifest.json' + (endpoint.shareQuery || ''));
    let rj = null;
    try { rj = JSON.parse(m.body ? m.body.toString('utf8') : 'null'); } catch (e) { rj = null; }
    check('远端清单可达', m.status === 200 && !!rj, 'HTTP ' + m.status + ' · ' + m.size + ' B');
    if (rj) {
      check('远端清单版本 = 本地版本',
        Number(rj.versionCode) === Number(latest.versionCode),
        '远端 v' + rj.versionName + ' / #' + rj.versionCode + ' · 本地 v' + latest.versionName + ' / #' + latest.versionCode);
      check('远端清单未指向旧域名（域名未漂移）',
        String(rj.baseUrl || '').replace(/\/+$/, '') === base,
        '清单 baseUrl=' + (rj.baseUrl || '-') + ' · 配置 baseUrl=' + base);
      for (const [label, p] of art) {
        const field = label === 'hap' ? rj.hapSha256 : (label === 'exe' ? rj.desktopSha256 : null);
        const sha = sha256File(p);
        if (!field) continue;
        check('远端 ' + label + ' 哈希 = 本地', !!sha && sha === String(field).toLowerCase(), String(field).slice(0, 16));
      }
      const urls = ['/index.html', '/remote-manifest.json', '/app-page.html']
        .map((p) => base + p)
        .concat([rj.desktopUrl, rj.hapUrl].filter(Boolean));
      for (const u of urls) {
        const r = await get(u);
        check('GET ' + u.replace(base, '') + ' → 200', r.status === 200, 'HTTP ' + r.status + ' · ' + r.size + ' B');
      }
    }
  } else if (QUICK) {
    console.log('  （--quick：跳过公网探测）');
  }

  /* 4. 更新能力 */
  console.log('\n[4/5] 自动升级能力');
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  check('本机无包时能从镜像站下载安装', /KH_UPDATE_ALLOW_DOWNLOAD/.test(serverSrc) && /downloadToFile/.test(serverSrc));
  check('发布后自动回装开关（仅开发端）', /KH_AUTO_REINSTALL/.test(serverSrc) && /DEV_MODE && String\(process\.env\.KH_AUTO_REINSTALL/.test(serverSrc));
  check('安装前 sha256 + 体积校验', /SHA256 校验失败/.test(serverSrc) && /体积与清单不符/.test(serverSrc));

  const fail = results.filter((r) => !r.ok);  console.log('\n=== 结果：' + (results.length - fail.length) + '/' + results.length + ' 通过 ===');
  if (fail.length) {
    for (const f of fail) console.log('  ✗ ' + f.name + (f.detail ? ' — ' + f.detail : ''));
    process.exit(1);
  }
})();
