#!/usr/bin/env node
'use strict';
/* 公网分发验收：清单可达 + 成品可达 + 哈希一致 + Range 可用
   —— 对应「分发前必须过的 6 项」里的第 3、4 项。它只做只读 GET，不上传、不改远端。

   用法：
     node scripts/release/verify-public-dist.js --base https://your.site
     node scripts/release/verify-public-dist.js --base https://your.site --no-hash   # 只验状态与 Range
     node scripts/release/verify-public-dist.js --base https://your.site --full     # 还要校验 exe/hap 的完整 sha256
   env：KH_PUBLIC_BASE 可作为 --base 的替代；KH_VERIFY_TIMEOUT 毫秒（默认 15000）

   退出码：0 全通过；1 有失败；2 参数/网络前置不满足
*/
const crypto = require('crypto');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const BASE = String(arg('--base', process.env.KH_PUBLIC_BASE || '')).replace(/\/+$/, '');
const TIMEOUT = Number(process.env.KH_VERIFY_TIMEOUT || 15000);
const SKIP_HASH = process.argv.includes('--no-hash');
const FULL = process.argv.includes('--full');
if (!/^https:\/\//i.test(BASE)) {
  console.error('需要 --base https://… 或环境变量 KH_PUBLIC_BASE（必须 https）');
  process.exit(2);
}

const out = [];
const ok = (m) => { out.push(['OK  ', m]); };
const bad = (m) => { out.push(['FAIL', m]); };
const info = (m) => { out.push(['INFO', m]); };

async function head(url, headers) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { method: 'GET', headers, signal: ac.signal, redirect: 'follow' });
    return r;
  } finally { clearTimeout(t); }
}

async function sha256Of(url) {
  const r = await head(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const h = crypto.createHash('sha256');
  let n = 0;
  for await (const chunk of r.body) { h.update(chunk); n += chunk.length; }
  return { sha: h.digest('hex'), size: n };
}

(async () => {
  // 1) 清单
  let man = null;
  try {
    const r = await head(BASE + '/remote-manifest.json');
    if (!r.ok) { bad('清单 remote-manifest.json HTTP ' + r.status); }
    else {
      man = await r.json();
      ok('清单可达 · ' + (man.versionName || man.version || '?') + ' / #' + (man.versionCode || '?'));
    }
  } catch (e) { bad('清单请求失败：' + e.message); }

  if (!man) { report(); process.exit(1); }

  const items = [];
  const d = man.desktop || {};
  const h = man.hap || {};
  if (d.url) items.push(['桌面安装包', d.url, d.size, d.sha256]);
  if (d.path && !d.url) items.push(['桌面安装包', BASE + '/' + String(d.path).replace(/^\/+/, ''), d.size, d.sha256]);
  if (h.url) items.push(['HAP', h.url, h.size, h.sha256]);
  if (h.path && !h.url) items.push(['HAP', BASE + '/' + String(h.path).replace(/^\/+/, ''), h.size, h.sha256]);
  /* 清单字段名各版本可能不同，兜底直接试约定路径 */
  if (!items.length) {
    const v = man.versionName || man.version;
    items.push(['桌面安装包（约定路径）', BASE + '/honghub/v' + v + '/desktop-setup.exe', null, null]);
    items.push(['HAP（约定路径）', BASE + '/honghub/v' + v + '/HongHubMovie.hap', null, null]);
  }

  for (const [label, url, size, sha] of items) {
    try {
      const r = await head(url, { Range: 'bytes=0-63' });
      if (r.status === 206) {
        const cr = r.headers.get('content-range') || '';
        ok(label + ' 支持 Range（206 · ' + cr + '）');
      } else if (r.status === 200) {
        ok(label + ' 可达（200，但未返回 206，Range 可能被 CDN 忽略）');
      } else if (r.status === 404) {
        bad(label + ' 404 —— 成品没同步到站点（这就是「清单 200、包 404」的典型状态）：' + url);
        continue;
      } else {
        bad(label + ' HTTP ' + r.status + '：' + url);
        continue;
      }
      const len = Number(r.headers.get('content-length') || 0);
      if (size && Number(size) !== Number(len) && r.status === 200) {
        bad(label + ' 大小与清单不符：清单 ' + size + ' / 实际 ' + len);
      }
    } catch (e) { bad(label + ' 请求失败：' + e.message); }

    if (!SKIP_HASH && sha) {
      if (!FULL) { info(label + ' 哈希校验已跳过（加 --full 做整包下载比对，约 ' + (size ? Math.round(size / 1048576) + ' MB' : '较大') + '）'); continue; }
      try {
        const got = await sha256Of(url);
        if (got.sha !== String(sha).toLowerCase()) bad(label + ' sha256 不一致：清单 ' + String(sha).slice(0, 12) + ' / 实际 ' + got.sha.slice(0, 12));
        else ok(label + ' sha256 一致 · ' + got.size + ' B · ' + got.sha.slice(0, 12));
      } catch (e) { bad(label + ' 整包下载失败：' + e.message); }
    }
  }

  report();
  const fails = out.filter((x) => x[0] === 'FAIL').length;
  process.exit(fails ? 1 : 0);

  function report() {
    console.log('\n=== 公网站点验收 · ' + BASE + ' ===');
    for (const [lvl, m] of out) console.log('  [' + lvl + '] ' + m);
    console.log('  ' + (out.filter((x) => x[0] === 'FAIL').length ? '存在失败项，先别对外发链接' : '全部通过'));
  }
})();
