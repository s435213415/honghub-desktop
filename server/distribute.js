'use strict';
/* 公网分发配置（可插拔）：未配置时保持纯局域网本地分发，不假装已发布。

   读取优先级：环境变量 > server/public-endpoint.json（随包携带，让打包应用也能生效）。
   后者只含公开下载域名/分享码，不含任何密钥；打包应用没有 dist/ 目录，
   因此必须支持从随包配置读取，否则客户装好的应用仍会走局域网。

   自引用约束：安装包内不能写死「安装包自身的 SHA256 / 体积」——
   那份配置是 exe 的一部分，写进去就会让 exe 哈希再次变化，永远对不上。
   因此随包配置只给端点，真实校验值在运行时从公网 remote-manifest.json 拉取并缓存。 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const ENDPOINT_FILE = path.join(__dirname, 'public-endpoint.json');

function fileConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
    return j && j.enabled !== false ? j : {};
  } catch (e) { return {}; }
}

function config() {
  const f = fileConfig();
  const base = String(process.env.KH_PUBLIC_BASE_URL || f.baseUrl || '').replace(/\/+$/, '');
  const shareQuery = String(process.env.KH_PUBLIC_SHARE_QUERY || f.shareQuery || '');
  /* 多源清单：主源 + 备用源（f.mirrors）。任一存活即可完成更新检查，
     避免单一临时域名失效后客户端彻底失去更新能力。 */
  const mirrors = [];
  if (base) mirrors.push({ baseUrl: base, shareQuery });
  if (Array.isArray(f.mirrors)) {
    f.mirrors.forEach(function (m) {
      const u = String((m && (m.baseUrl || m)) || '').replace(/\/+$/, '');
      if (!u || mirrors.some(function (x) { return x.baseUrl === u; })) return;
      mirrors.push({ baseUrl: u, shareQuery: String((m && m.shareQuery) || '') });
    });
  }
  return {
    enabled: !!base,
    baseUrl: base,
    shareQuery,
    mirrors,
    bucket: String(process.env.KH_PUBLISH_BUCKET || ''),
    endpoint: String(process.env.KH_PUBLISH_ENDPOINT || ''),
    region: String(process.env.KH_PUBLISH_REGION || 'auto'),
    distribution: f.distribution || 'remote'
  };
}

// ---- 运行时公网清单：启动拉一次 + 周期刷新，请求处理保持同步、零阻塞 ----
let remoteCache = null;
function publicManifestUrls() {
  const c = config();
  if (!c.enabled) return [];
  return (c.mirrors || []).map(function (m) {
    return m.baseUrl + '/remote-manifest.json' + (m.shareQuery || '');
  });
}
function publicManifestUrl() {
  const list = publicManifestUrls();
  return list.length ? list[0] : null;
}
function fetchJson(url, timeoutMs, cb) {
  const lib = url.indexOf('https:') === 0 ? https : http;
  let settled = false;
  const done = (v) => { if (settled) return; settled = true; if (cb) cb(v); };
  const req = lib.get(url, { timeout: timeoutMs || 6000 }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { if (body.length < 200000) body += d; });
    res.on('end', () => {
      if (res.statusCode !== 200) return done(null);
      try {
        const j = JSON.parse(body);
        if (j && j.versionCode && j.desktopUrl) return done(j);
      } catch (e) { /* 落到 null */ }
      done(null);
    });
  });
  req.on('timeout', () => { req.destroy(); done(null); });
  req.on('error', () => done(null));
}
/* 依次尝试主源与备用源，命中第一个可用清单即返回；全部失败则保留旧缓存 */
function refreshPublicManifest(cb, timeoutMs) {
  const urls = publicManifestUrls();
  if (!urls.length) { if (cb) cb(null); return; }
  (function next(i) {
    if (i >= urls.length) { if (cb) cb(remoteCache); return; }
    fetchJson(urls[i], timeoutMs, function (j) {
      if (j) { remoteCache = j; if (cb) cb(j); return; }
      next(i + 1);
    });
  })(0);
}
function startAutoRefresh(ms) {
  refreshPublicManifest();
  const t = setInterval(() => refreshPublicManifest(), Math.max(60000, Number(ms) || 5 * 60 * 1000));
  if (t.unref) t.unref();
  return t;
}

// 发布清单：本地构建产物 > 运行时公网清单 > 随包端点（只给地址，不给自身哈希）
function published() {
  const tries = [
    path.join(ROOT, 'dist', 'remote-manifest.json'),
    path.join(ROOT, 'updates', 'remote-manifest.json')
  ];
  for (const p of tries) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.desktopUrl) return j;
    } catch (e) { /* 下一个候选 */ }
  }
  if (remoteCache) return remoteCache;
  const f = fileConfig();
  if (!f.enabled || !f.desktopUrl) return null;
  return {
    schema: 1, versionName: f.versionName, versionCode: f.versionCode,
    publishedAt: f.publishedAt || null, baseUrl: f.baseUrl,
    desktopUrl: f.desktopUrl, hapUrl: f.hapUrl,
    // 安装包自身的校验值不可随包写死；只在字段存在时透传（兼容旧版配置）
    desktopSha256: f.desktopSha256 || null, hapSha256: f.hapSha256 || null,
    desktopSize: f.desktopSize || null, hapSize: f.hapSize || null,
    rollbackUrl: f.rollbackUrl || null,
    source: 'bundled-public-endpoint'
  };
}

// 只有「已配置 + 有公网下载地址」才改写 latest；远端版本更旧时绝不回退。
// 远端版本更新时同步抬升 versionCode，让已安装客户端也能发现公网新版本。
function applyToLatest(latest) {
  const c = config(), p = published();
  if (!c.enabled || !p || !p.desktopUrl) return latest;
  const lv = Number(latest && latest.versionCode) || 0;
  const pv = Number(p.versionCode) || 0;
  if (pv && pv < lv) return latest;
  const out = Object.assign({}, latest, {
    downloadUrl: p.desktopUrl,
    hapUrl: p.hapUrl || latest.hapUrl,
    publicBase: c.baseUrl,
    distribution: 'remote',
    manifestUrl: publicManifestUrl()
  });
  if (p.desktopSha256) out.desktopSha256 = p.desktopSha256;
  if (p.hapSha256) out.hapSha256 = p.hapSha256;
  if (pv > lv) {
    out.versionName = p.versionName || latest.versionName;
    out.versionCode = pv;
    out.publishedAt = p.publishedAt || latest.publishedAt;
    out.remoteVersion = true;
  }
  return out;
}

module.exports = {
  config, published, applyToLatest, fileConfig,
  publicManifestUrl, refreshPublicManifest, startAutoRefresh
};
