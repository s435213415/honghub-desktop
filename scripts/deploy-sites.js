/* 可编程发布入口：一条命令完成「判定是否需要发 → 发布 → 公网回验」。
   用法：
     node scripts/deploy-sites.js                 # 需要就发，发完回验
     node scripts/deploy-sites.js --verify-only   # 只回验公网（不发）
     node scripts/deploy-sites.js --deep          # 回验时全量下载 exe/hap 比对 sha256
   发布通道按顺序尝试：
     1) 环境变量 KH_DEPLOY_CMD（外部命令，cwd=项目根，发布目录为 dist/public）
     2) 本机 WorkBuddy 站点发布能力（客户端 UI 触发，本脚本无法自动点，写 deploy-request.json 并明确提示）
   任何情况下都如实回报，绝不把「没发」写成「已发」。 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'dist/public');
const MAN = path.join(PUB, 'remote-manifest.json');
const REQ = path.join(ROOT, 'dist/deploy-request.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const ARG = process.argv.slice(2);
const VERIFY_ONLY = ARG.includes('--verify-only');
const DEEP = ARG.includes('--deep');

const ok = (s) => console.log('  [PASSED] ' + s);
const bad = (s) => console.log('  [FAILED] ' + s);
const info = (s) => console.log('  ' + s);

function head(url, timeoutMs, redirect) {
  redirect = redirect || 0;
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'HEAD', hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search, headers: { 'User-Agent': UA }, timeout: timeoutMs, rejectUnauthorized: false
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirect < 3) {
        res.resume();
        return head(new URL(res.headers.location, url).toString(), timeoutMs, redirect + 1).then(resolve, reject);
      }
      res.resume();
      resolve({ code: res.statusCode, len: Number(res.headers['content-length'] || 0) });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function getText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? https : http;
    mod.get({ hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' }, timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    }).on('error', reject);
  });
}

function download(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? https : http;
    mod.get({ hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: { 'User-Agent': UA }, timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      let n = 0;
      res.on('data', (d) => { chunks.push(d); n += d.length; });
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), len: n }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function localFiles(man) {
  const v = 'honghub/v' + man.versionName + '/';
  return [
    { key: 'index.html', rel: 'index.html', url: man.baseUrl + '/index.html' + man.shareQuery, size: fs.existsSync(path.join(PUB, 'index.html')) ? fs.statSync(path.join(PUB, 'index.html')).size : 0 },
    { key: 'app-page.html', rel: 'app-page.html', url: man.pageUrl, size: man.pageSize },
    { key: 'remote-manifest.json', rel: 'remote-manifest.json', url: man.baseUrl + '/remote-manifest.json' + man.shareQuery, size: fs.statSync(MAN).size },
    { key: 'desktop-setup.exe', rel: v + 'desktop-setup.exe', url: man.desktopUrl, size: man.desktopSize, sha: man.desktopSha256 },
    { key: 'HongHubMovie.hap', rel: v + 'HongHubMovie.hap', url: man.hapUrl, size: man.hapSize, sha: man.hapSha256 },
    { key: 'honghub-desktop-win.bin', rel: v + 'honghub-desktop-' + man.versionName + '-win.bin', url: man.zipUrl, size: man.zipSize, sha: man.zipSha256 }
  ];
}

async function verify(man, deep) {
  let fails = 0;
  const rows = [];
  for (const f of localFiles(man)) {
    const lp = path.join(PUB, f.rel);
    const lsize = fs.existsSync(lp) ? fs.statSync(lp).size : -1;
    try {
      const h = await head(f.url, 20000);
      let same = String(h.len) === String(lsize);
      if (deep && f.sha && same) {
        const d = await download(f.url, 180000);
        const sha = crypto.createHash('sha256').update(d.buf).digest('hex');
        same = sha === f.sha;
        if (!same) rows.push([f.key, h.code, d.len, f.sha.slice(0, 8) + '≠' + sha.slice(0, 8), false]);
      }
      const pass = h.code === 200 && same;
      if (!pass) fails++;
      if (!rows.some((r) => r[0] === f.key)) rows.push([f.key, h.code, h.len, lsize + ' / 本地', pass]);
    } catch (e) {
      fails++;
      rows.push([f.key, 'ERR', 0, lsize + ' / 本地', false]);
    }
  }
  for (const r of rows) info((r[4] ? '[PASSED] ' : '[FAILED] ') + r[0] + ' → ' + r[1] + ' · ' + r[2] + ' B vs 本地 ' + r[3]);
  return { fails, rows };
}

(async function main() {
  if (!fs.existsSync(MAN)) { bad('缺少 dist/public/remote-manifest.json，先跑 npm run ship:client'); process.exit(1); }
  const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
  console.log('=== 站点发布 ' + man.versionName + ' / #' + man.versionCode + ' ===');
  info('发布目录 ' + PUB + '（' + fs.readdirSync(PUB).length + ' 项）');
  info('公网 ' + man.baseUrl + man.shareQuery);

  if (VERIFY_ONLY) {
    const r = await verify(man, DEEP);
    console.log('\n=== 回验 ' + (r.fails ? '未通过' : '通过') + ' ===');
    process.exit(r.fails ? 1 : 0);
  }

  // 线上已是最新就不重复发（避免每次出包都覆盖一次分享链接）
  let online = null;
  try {
    const r = await getText(man.baseUrl + '/remote-manifest.json' + man.shareQuery, 20000);
    if (r.code === 200) online = JSON.parse(r.body);
  } catch (e) { /* 线上不可读，按需要发布处理 */ }
  if (online && online.versionCode === man.versionCode && online.desktopSha256 === man.desktopSha256 && online.hapSha256 === man.hapSha256) {
    ok('线上已是同版本同哈希（' + online.versionName + ' / #' + online.versionCode + '），无需重复发布');
    const v = await verify(man, DEEP);
    process.exit(v.fails ? 1 : 0);
  }
  info('线上版本 ' + (online ? online.versionName + ' / #' + online.versionCode : '不可读') + ' → 需要发布');

  const cmd = process.env.KH_DEPLOY_CMD;
  if (cmd) {
    info('发布通道：KH_DEPLOY_CMD');
    const r = spawnSync(cmd, { cwd: ROOT, shell: true, stdio: 'inherit', env: process.env });
    if (r.status !== 0) { bad('KH_DEPLOY_CMD 退出码 ' + r.status); process.exit(1); }
    ok('KH_DEPLOY_CMD 执行完成');
  } else {
    const req = {
      schema: 1, at: new Date().toISOString(),
      reason: '未配置 KH_DEPLOY_CMD，且本机无 WorkBuddy 站点发布接口',
      publishDir: PUB, entryHtml: 'index.html', language: 'static',
      deployTargetId: '993be197cb1db523', appId: 'wbapp_j8tM07CIrJ5X0krfYiVhFZ',
      title: '鸿汇影频道下发', userAskedToPublish: true,
      shareQuery: man.shareQuery, versionName: man.versionName, versionCode: man.versionCode
    };
    fs.writeFileSync(REQ, JSON.stringify(req, null, 2) + '\n');
    info('发布通道：无（已写 dist/deploy-request.json）');
    info('下一步：WorkBuddy 客户端 → 站点「鸿汇影频道下发」→ 部署目录 ' + PUB);
  }

  // 发布通道执行完/未执行都回验一次：只有真的 200 才算发出去
  await new Promise((r) => setTimeout(r, 3000));
  const v = await verify(man, DEEP);
  console.log('\n=== 回验 ' + (v.fails ? '未通过（线上仍是旧内容或 404）' : '通过') + ' ===');
  if (!cmd && !VERIFY_ONLY) info('提示：没有发布通道时回验会失败，这是事实而不是脚本坏了。');
  process.exit(v.fails ? 1 : 0);
})();
