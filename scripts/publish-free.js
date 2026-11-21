#!/usr/bin/env node
'use strict';
/**
 * 一键零积分公网下发（客户端成品）
 *
 * 目标：把已签发好的两渠道成品（客户版 Setup / 免安装 zip / 深开鸿 HAP）
 *       走「本机镜像站 8099 + Cloudflare 隧道」发布到公网，全程不消耗平台积分。
 *
 * 与现有脚本的关系（不重复造轮子）：
 *   - oneclick-release.js 负责「签发 + 出包 + 本地镜像站同步」（step 7 调 auto-release.js）
 *   - 本脚本负责签发之后的「上传闭环 + 公网回下验证 + 交付链接输出」，可单独反复运行：
 *       node scripts/publish-free.js            # 上传 + 公网验证 + 输出链接
 *       node scripts/publish-free.js --verify   # 只验证，不重新上传
 *       node scripts/publish-free.js --json     # 机器可读摘要
 *
 * 零积分原理：
 *   成品写到本机 C:\Users\admin\HongHubServer\site（本地文件写入，无平台 API 消耗），
 *   8099 提供服务，Cloudflare 隧道（current-url.txt）把本机端口暴露成公网 https 直链。
 *   公网下载走隧道流量，不走 WorkBuddy Sites 发布能力，因此不消耗积分。
 *
 * 「上传」两种实现，按可用性自动选择：
 *   A) 本机同源写入（默认）：把 dist 成品复制进镜像站目录 —— 零依赖、最稳。
 *   B) 鉴权上传 API：若配置 KH_UPLOAD_ENDPOINT + 令牌，则 POST /api/upload（网关模式）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE = process.env.KH_MIRROR_DIR || path.join(os.homedir(), 'HongHubServer', 'site');
const CURRENT_URL = path.join(os.homedir(), 'HongHubServer', 'current-url.txt');
const ARGS = process.argv.slice(2);
const VERIFY_ONLY = ARGS.includes('--verify');
const JSON_OUT = ARGS.includes('--json');

function log(s) { if (!JSON_OUT) console.log(s); }
function sha256File(p) {
  const h = crypto.createHash('sha256');
  const buf = fs.readFileSync(p);
  h.update(buf);
  return { sha: h.digest('hex'), size: buf.length };
}
function tunnelUrl() {
  try {
    return fs.readFileSync(CURRENT_URL, 'utf8').replace(/^\uFEFF/, '').trim().replace(/\/+$/, '');
  } catch (e) { return ''; }
}
function httpGet(url, timeout) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const r = lib.get(url, { timeout: timeout || 20000, headers: { Range: 'bytes=0-63' } }, (res) => {
      let bytes = 0;
      res.on('data', (d) => { bytes += d.length; });
      res.on('end', () => resolve({ code: res.statusCode, bytes, headers: res.headers }));
      res.resume();
    });
    r.on('timeout', () => { r.destroy(); resolve({ code: 0, bytes: 0, error: 'timeout' }); });
    r.on('error', (e) => resolve({ code: 0, bytes: 0, error: e.message }));
  });
}

// 产物清单：与 auto-release.js 的 SRC 同源，发布目录在 dist/public/honghub/v<版本>/，
// 回退 dist/honghub/v<版本>/ 与 dist/ 根别名，兼容不同出包习惯。
function artifacts(version) {
  const dirs = [
    path.join(DIST, 'public', 'honghub', 'v' + version),
    path.join(DIST, 'honghub', 'v' + version),
    DIST
  ];
  const pick = (name) => {
    for (const d of dirs) {
      const p = path.join(d, name);
      if (fs.existsSync(p)) return p;
    }
    return path.join(dirs[0], name); // 都不存在时返回首选路径，交由上层报"源缺失"
  };
  return {
    exe: pick('desktop-setup.exe'),
    hap: pick('HongHubMovie.hap'),
    bin: pick('honghub-desktop-' + version + '-win.bin')
  };
}

async function main() {
  const rel = JSON.parse(fs.readFileSync(path.join(DIST, 'release.json'), 'utf8'));
  const v = rel.versionName;
  const art = artifacts(v);
  const result = { schema: 1, at: new Date().toISOString(), version: v, mode: VERIFY_ONLY ? 'verify' : 'publish', checks: [], links: {} };

  // ---- 1) 上传 / 同步到镜像站（本地写入，零积分）
  log('\n=== 零积分公网下发 v' + v + ' ===');
  if (!VERIFY_ONLY) {
    log('[1/3] 同步成品到本机镜像站 ' + SITE);
    if (!fs.existsSync(SITE)) { log('  镜像站目录不存在，跳过写入：' + SITE); }
    else {
      const md = path.join(SITE, 'honghub', 'v' + v);
      fs.mkdirSync(md, { recursive: true });
      const pairs = [
        [art.exe, path.join(md, 'desktop-setup.exe')],
        [art.hap, path.join(md, 'HongHubMovie.hap')],
        [art.bin, path.join(md, 'honghub-desktop-' + v + '-win.bin')],
        [path.join(DIST, 'public', 'remote-manifest.json'), path.join(SITE, 'remote-manifest.json')],
        [path.join(DIST, 'public', 'app-page.html'), path.join(SITE, 'app-page.html')],
        // 客户页外链 js：必须与 app-page.html 同目录下发，否则镜像站是空壳
        ...['kh-config.js', 'kh-core.js', 'kh-src.js', 'kh-admin.js', 'kh-player.js', 'kh-app.js']
          .map((js) => [path.join(ROOT, 'app', js), path.join(SITE, js)])
      ];
      for (const [src, dst] of pairs) {
        if (!fs.existsSync(src)) { log('  跳过（源缺失）：' + path.basename(src)); continue; }
        const a = sha256File(src);
        const b = fs.existsSync(dst) ? sha256File(dst) : { sha: '', size: -1 };
        if (a.sha !== b.sha) {
          fs.copyFileSync(src, dst);
          log('  已写入 ' + path.basename(dst) + ' (' + a.size + ' B)');
        } else {
          log('  已一致 ' + path.basename(dst));
        }
      }
      result.checks.push({ name: '本地镜像站同步', ok: true });
    }
  } else {
    log('[1/3] --verify：跳过写入');
  }

  // ---- 2) 公网回下验证（隧道直链）
  log('[2/3] 公网回下验证');
  const base = tunnelUrl();
  if (!base || !base.startsWith('https://')) {
    log('  ✘ 未找到公网隧道地址（HongHubServer/current-url.txt）');
    result.checks.push({ name: '公网隧道地址', ok: false, detail: 'missing' });
  } else {
    log('  隧道：' + base);
    const routes = [
      ['清单', '/remote-manifest.json'],
      ['安装包', '/honghub/v' + v + '/desktop-setup.exe'],
      ['HAP', '/honghub/v' + v + '/HongHubMovie.hap']
    ];
    let allOk = true;
    for (const [name, route] of routes) {
      const r = await httpGet(base + route, 25000);
      const ok = (r.code === 200 || r.code === 206);
      allOk = allOk && ok;
      log('  ' + (ok ? '✔' : '✘') + ' ' + name + ' HTTP ' + r.code + ' (' + r.bytes + ' B 抽样)');
      result.checks.push({ name: '公网·' + name, ok, code: r.code });
    }
    result.links = {
      downloadPage: base + '/',
      manifest: base + '/remote-manifest.json',
      setup: base + '/honghub/v' + v + '/desktop-setup.exe',
      hap: base + '/honghub/v' + v + '/HongHubMovie.hap'
    };
    result.checks.push({ name: '公网可达', ok: allOk });
  }

  // ---- 3) 输出交付链接
  log('[3/3] 交付链接（不消耗积分）');
  if (Object.keys(result.links).length) {
    log('  下载中心：' + result.links.downloadPage);
    log('  Windows 安装包：' + result.links.setup);
    log('  深开鸿 HAP：' + result.links.hap);
    log('  更新清单：' + result.links.manifest);
  }
  const ok = result.checks.every((c) => c.ok);
  result.ok = ok;
  try {
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'logs', 'publish-free.json'), JSON.stringify(result, null, 2) + '\n');
  } catch (e) {}
  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  else log('\n' + (ok ? '✔ 零积分公网下发完成' : '✘ 存在失败项，详见 logs/publish-free.json'));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('发布失败：' + (e && e.stack || e)); process.exit(1); });
