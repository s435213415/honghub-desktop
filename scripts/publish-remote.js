#!/usr/bin/env node
'use strict';
/* 公网发布适配器：生成公网更新清单 + 发布产物。
   两种通道：
   A) workbuddy-sites（默认，无需任何凭证）：dist/public/ 由站点发布能力托管；
      逐个探测远端清单/安装包/HAP 真实可达且版本一致后，才报 published。
   B) S3 兼容对象存储：需 KH_PUBLISH_BUCKET + 本机 aws CLI。
   未配置端点 → SKIP；产物备好但未上传 → prepared-local。绝不谎报「已发布」。 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');
const env = require('./lib/env');
const distribute = require('../server/distribute');

const ROOT = env.ROOT;
env.apply();
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'remote-manifest.json');

function finish(status, detail) {
  console.log('  [公网分发] ' + status.toUpperCase() + ' — ' + detail);
  process.exit(0);   // 可插拔：不阻断发版
}

const c = distribute.config();
if (!c.enabled) {
  finish('skipped', '未配置 KH_PUBLIC_BASE_URL / server/public-endpoint.json，当前仍为局域网本地分发（配置见 .env.example）');
}
const MODE = String(process.env.KH_PUBLISH_MODE || c.distribution || '');
const SITES = MODE === 'workbuddy-sites';
const relFile = path.join(DIST, 'release.json');
if (!fs.existsSync(relFile)) finish('skipped', '缺少 dist/release.json');
const rel = JSON.parse(fs.readFileSync(relFile, 'utf8'));
const v = rel.versionName, code = rel.versionCode;
const desktop = rel.artifacts && rel.artifacts.desktop;
const hap = rel.artifacts && rel.artifacts.hap;
if (!desktop || !hap) finish('skipped', 'release.json 缺产物信息');

const prefix = 'honghub/v' + v;
// 托管站点可能要求每个资源请求都带访问码（例如站点发布的 ?sharecode=）。
// shareQuery 会原样附加到每个下载 URL，保证客户端拿到的是可直链下载的真实地址。
const shareQuery = String(process.env.KH_PUBLIC_SHARE_QUERY || c.shareQuery || '');
const asset = (relPath) => c.baseUrl + '/' + relPath + shareQuery;
const manifest = {
  schema: 1, versionName: v, versionCode: code,
  publishedAt: new Date().toISOString(),
  baseUrl: c.baseUrl,
  shareQuery: shareQuery || null,
  distribution: SITES ? 'workbuddy-sites' : (c.bucket ? 's3' : 'remote'),
  desktopUrl: asset(prefix + '/desktop-setup.exe'),
  hapUrl: asset(prefix + '/HongHubMovie.hap'),
  desktopSha256: desktop.sha256, hapSha256: hap.sha256,
  desktopSize: desktop.size, hapSize: hap.size,
  features: rel.features || null
  // 回滚索引 releases/index.json 属开发端内部资料，不对外发布，故不下发 rollbackUrl
};
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

// 准备静态发布目录（复制，不改归档原件；index.html 若已存在则保留）
const pub = path.join(DIST, 'public');
fs.mkdirSync(path.join(pub, prefix), { recursive: true });
const files = [
  [path.join(DIST, 'desktop-setup.exe'), path.join(pub, prefix, 'desktop-setup.exe')],
  [path.join(DIST, 'honghub-harmony.hap'), path.join(pub, prefix, 'HongHubMovie.hap')],
  // 内部资料（回滚索引 / 下发通道清单 / OS 适配矩阵 / 架构清单）一律不上公网
  [OUT, path.join(pub, 'remote-manifest.json')]
];
for (const [s, d] of files) {
  if (!fs.existsSync(s)) continue;
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
}
console.log('  已准备静态发布目录 dist/public/（清单、成品、回滚索引与下发矩阵）');

function head(url) {
  return new Promise((resolve) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const r = lib.request(url, { method: 'GET', timeout: 15000, headers: { Range: 'bytes=0-63' } }, (res) => {
      let n = 0;
      let body = '';
      res.on('data', (d) => { n += d.length; if (body.length < 400) body += d.toString('utf8'); });
      res.on('end', () => resolve({ code: res.statusCode, len: n, body, type: res.headers['content-type'] }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ code: 0, len: 0, body: 'timeout' }); });
    r.on('error', (e) => resolve({ code: 0, len: 0, body: e.message }));
    r.end();
  });
}

function getJson(url) {
  return new Promise((resolve) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const r = lib.get(url, { timeout: 20000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 200000) body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
      });
    });
    r.on('timeout', () => { r.destroy(); resolve(null); });
    r.on('error', () => resolve(null));
    r.end();
  });
}

(async () => {
  if (SITES) {
    const probeManifest = await head(asset('remote-manifest.json'));
    if (probeManifest.code !== 200 || !/"versionCode"/.test(probeManifest.body)) {
      finish('prepared-local', '静态目录已备好，但远端清单尚不可达（' + asset('remote-manifest.json') +
        ' → HTTP ' + probeManifest.code + '）：请先重新发布 dist/public/ 站点，再重跑本命令');
    }
    let remote = null;
    try { remote = JSON.parse(probeManifest.body); } catch (e) {}
    const probeHap = await head(asset(prefix + '/HongHubMovie.hap'));
    const probeExe = await head(asset(prefix + '/desktop-setup.exe'));
    const exeOk = probeExe.code === 200 || probeExe.code === 206;
    const hapOk = probeHap.code === 200 || probeHap.code === 206;
    if (!exeOk || !hapOk) {
      finish('prepared-local', '清单可达但成品未同步：exe HTTP ' + probeExe.code + ' / HAP HTTP ' + probeHap.code +
        '；重新发布 dist/public/ 后再重跑本命令');
    }
    // Range 探测会截断 JSON，完整拉一次清单才能核对版本与哈希。
    // 补丁重出包后远端仍是上一版 exe，只比版本号会误报 published。
    const full = await getJson(asset('remote-manifest.json'));
    if (!full) {
      finish('prepared-local', '远端清单完整读取失败：重新发布 dist/public/ 后再重跑本命令');
    }
    const versionOk = Number(full.versionCode) === Number(code);
    const shaOk = full.desktopSha256 === desktop.sha256 && full.hapSha256 === hap.sha256;
    if (!versionOk || !shaOk) {
      finish('prepared-local', '远端仍是上一版（版本' + (versionOk ? '一致' : '不同') +
        ' / 哈希' + (shaOk ? '一致' : '不同') + '，本地 desktop=' + String(desktop.sha256).slice(0, 12) +
        '… 远端=' + String(full.desktopSha256).slice(0, 12) + '…）：请先重新发布 dist/public/ 站点，再重跑本命令');
    }
    finish('published', 'v' + v + ' / #' + code + ' 已在公网可达（exe ' + (exeOk ? '200/206' : 'x') +
      ' · HAP ' + (hapOk ? '200/206' : 'x') + ' · 清单版本与 SHA256 均一致' +
      '）→ ' + c.baseUrl);
  }

  if (!c.bucket) {
    finish('prepared-local', '未配置 KH_PUBLISH_BUCKET：产物已备好，可由 Nginx 托管 dist/public/ 或设 KH_PUBLISH_MODE=workbuddy-sites');
  }
  const aws = spawnSync(process.platform === 'win32' ? 'aws.cmd' : 'aws', ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (aws.status !== 0) {
    finish('prepared-local', '本机无 aws CLI：产物已备好但未上传；可由 Nginx 托管 dist/public/ 或安装 aws CLI 后重跑');
  }
  const args = ['s3', 'cp', pub, 's3://' + c.bucket + '/', '--recursive'];
  if (c.endpoint) args.push('--endpoint-url', c.endpoint);
  if (c.region && c.region !== 'auto') args.push('--region', c.region);
  const up = spawnSync(process.platform === 'win32' ? 'aws.cmd' : 'aws', args, { encoding: 'utf8', timeout: 600000 });
  if (up.status !== 0) finish('failed', '上传失败：' + String(up.stderr || up.stdout || '').trim().slice(0, 200));
  console.log('  已上传到 s3://' + c.bucket + '/');
  finish('published', 'v' + v + ' / #' + code + ' 已上传到对象存储 → ' + c.baseUrl);
})();
