'use strict';
/* #158 真机口径探测：按当前仓库里的真实配置（dist/remote-manifest.json + 随包 public-endpoint.json
   + 环境变量）生成候选列表，逐个探活，回答"现在这台机器点覆盖安装，会依次试哪些源、结果如何"。
   只发 HEAD（不支持时退化为 GET 前 1 字节），不下载整包、不启动安装。
   用法：node scripts/test-update-sources-e2e.js */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const distribute = require('../server/distribute');
const us = require('../server/update-sources');

const ROOT = path.join(__dirname, '..');
let lat = {};
try { lat = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release.latest || {}; } catch (e) {}
const pub = distribute.published();
let mirrors = [];
try { mirrors = distribute.config().mirrors || []; } catch (e) {}

const cands = us.candidates({
  versionName: lat.versionName || '1.7.86',
  manifest: {
    desktopUrl: (pub && pub.desktopUrl) || lat.downloadUrl || null,
    desktopSha256: (pub && pub.desktopSha256) || lat.desktopSha256 || null,
    desktopSize: (pub && pub.desktopSize) || lat.desktopSize || null,
    versionName: lat.versionName, versionCode: lat.versionCode
  },
  mirrors,
  envUrl: process.env.KH_UPDATE_DOWNLOAD_URL || '',
  envSha: process.env.KH_UPDATE_SHA256 || '',
  envSize: Number(process.env.KH_UPDATE_SIZE) || 0
});

console.log('版本：v' + lat.versionName + ' / #' + lat.versionCode + '（期望 SHA ' + String((pub && pub.desktopSha256) || lat.desktopSha256 || '-').slice(0, 16) + '…）');
console.log('镜像数：' + mirrors.length + '，候选数：' + cands.length + '\n');

function probe(url, timeoutMs, cb) {
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; cb(v); } };
  const req = (/^https:/i.test(url) ? https : http).request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
    res.resume();
    const len = res.headers['content-length'];
    /* HEAD 被拒（405/403）时用 1 字节 GET 探活，避免把"站点不支持 HEAD"误判成"文件不存在" */
    if (res.statusCode === 405 || res.statusCode === 403) {
      const g = (/^https:/i.test(url) ? https : http).get(url, { timeout: timeoutMs }, (r2) => {
        const l2 = r2.headers['content-length'];
        r2.destroy();
        done({ code: r2.statusCode, size: Number(l2) || 0, via: 'GET' });
      });
      g.on('error', (e) => done({ code: null, error: String(e.message || e), via: 'GET' }));
      g.on('timeout', () => { g.destroy(); done({ code: null, error: 'timeout' }); });
      return;
    }
    done({ code: res.statusCode, size: Number(len) || 0, via: 'HEAD' });
  });
  req.on('timeout', () => { req.destroy(); done({ code: null, error: 'timeout' }); });
  req.on('error', (e) => done({ code: null, error: String(e.message || e) }));
  req.end();
}

let i = 0;
(function next() {
  if (i >= cands.length) return summary();
  const c = cands[i++];
  probe(c.url, 8000, (r) => {
    const verdict = (r.code === 200) ? '可用' : ('不可用（' + (r.code ? 'HTTP ' + r.code : r.error) + '）');
    console.log(String(i).padStart(2) + '. [' + c.label + '] ' + verdict
      + (r.size ? ' · ' + r.size.toLocaleString('en-US') + ' B' : '')
      + '\n    ' + c.url
      + (r.code !== 200 ? '   ← 换源逻辑会跳过它并继续下一个' : ''));
    next();
  });
})();

function summary() {
  console.log('\n说明：以上是就本机当前配置的真实探测结果。');
  console.log('若全部为"不可用"，则 /api/update/install 会返回 502 并把每个源的原因列在 attempts 里，');
  console.log('客户端会把"试过哪些源、各报什么错"直接显示在升级状态条上，而不是只弹下载页。');
}
