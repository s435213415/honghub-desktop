/**
 * 鸿汇影 · 客户版静默升级（1.7.95 / 台账 P1-07 + P1-08）
 * -------------------------------------------------------------------------
 * 与开发端 dev-auto-update.js 完全分开：
 *   开发端 = 扫本机 dist / 桌面交付夹的开发端安装包（本机自用）
 *   客户版 = 只认云端清单 remote-manifest.json，按版本号 + SHA256 校验后安装
 *
 * 三段开关（userData/kh-auto-update.json 的 mode）：
 *   off        不检查（默认关闭时也不会联网）
 *   check      只检查并提示「有新版本」
 *   download   检查 + 后台下载 + 校验 SHA256，下好提示「重启安装」
 *   install    检查 + 下载 + 校验 + 静默覆盖安装并自动重启（仅 Setup 安装目录）
 *
 * 失败与回退（P1-08）：
 *   · SHA256 不符 → 删包，不安装，attempts+1，按 1h / 6h / 24h 退避
 *   · 免安装 zip 目录 → 降级为「只提示」，不执行静默覆盖（NSIS 解压到解压目录会搞乱）
 *   · 安装后启动版本没变 → 记 lastInstallNoChange，停止自动安装，只提示，避免重启死循环
 *   · 任何异常都不删旧版、不阻塞启动
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MANIFEST = 'https://wbapp-j8tm07cirj5x0krfyivhfz.app.workbuddy.host/remote-manifest.json?sharecode=E4RJGYDYNW';
const BACKOFF_MS = [0, 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];

let ctx = null;   // { app, spawn, notify } 由 start() 注入，便于纯 node 单测

/* ---------------- 纯函数（单测入口） ---------------- */
function cmp(a, b) {
  const pa = String(a || '').split('.').map((x) => Number(x) || 0);
  const pb = String(b || '').split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/* 只接受 https + 只接受 .exe，且 host 必须和清单 baseUrl 同源（防清单被换行劫持） */
function checkDownloadUrl(url, baseUrl) {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { return { ok: false, reason: '下载地址不合法' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: '下载地址不是 https，拒绝' };
  if (!/\.exe$/i.test(u.pathname)) return { ok: false, reason: '下载地址不是 .exe，拒绝' };
  try {
    const b = new URL(String(baseUrl || ''));
    if (b.host && b.host.toLowerCase() !== u.host.toLowerCase()) {
      return { ok: false, reason: '下载域名与清单域名不同（' + u.host + ' ≠ ' + b.host + '），拒绝' };
    }
  } catch (e) { /* 清单没 baseUrl 时跳过同源校验，只靠 SHA256 */ }
  return { ok: true, host: u.host, file: path.basename(u.pathname) || 'setup.exe' };
}

function sha256File(fp) {
  const buf = fs.readFileSync(fp);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* 计划：清单 + 本机状态 → 该做什么 */
function plan(manifest, state) {
  const cur = String((state && state.current) || '');
  const news = String((manifest && manifest.versionName) || '');
  if (!news) return { action: 'idle', reason: '清单没有版本号' };
  if (cmp(news, cur) <= 0) return { action: 'uptodate', current: cur, remote: news };
  const url = checkDownloadUrl(manifest.desktopUrl, manifest.baseUrl);
  if (!url.ok) return { action: 'error', reason: url.reason };
  if (!manifest.desktopSha256) return { action: 'error', reason: '清单缺 SHA256，拒绝下载' };
  const mode = ['off', 'check', 'download', 'install'].indexOf(state && state.mode) >= 0 ? state.mode : 'download';
  if (mode === 'off') return { action: 'idle', reason: '自动检查已关闭', remote: news };
  if (mode === 'check') return { action: 'notice', remote: news, current: cur };
  return {
    action: mode === 'install' ? 'install' : 'download',
    remote: news, current: cur,
    url: manifest.desktopUrl, sha256: manifest.desktopSha256,
    size: Number(manifest.desktopSize) || 0, file: url.file
  };
}

/* 退避：连续失败 1 次等 1 小时，2 次等 6 小时，3 次以上等 24 小时 */
function nextDelay(attempts) {
  const n = Math.max(0, Math.min(BACKOFF_MS.length - 1, Number(attempts) || 0));
  return BACKOFF_MS[n];
}

/* ---------------- 运行时 ---------------- */
function statePath() {
  const dir = ctx && ctx.dir ? ctx.dir : path.join(os.tmpdir(), 'kh-auto-update');
  return path.join(dir, 'kh-auto-update.json');
}

function readState() {
  const dft = { schema: 1, mode: 'download', attempts: 0, lastCheck: '', lastResult: '', current: '' };
  try { return Object.assign(dft, JSON.parse(fs.readFileSync(statePath(), 'utf8'))); } catch (e) { return dft; }
}

function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(Object.assign({ schema: 1 }, s), null, 2));
  } catch (e) { /* 写不进去不影响升级 */ }
}

function emit(type, payload) {
  try { if (ctx && typeof ctx.notify === 'function') ctx.notify(type, payload); } catch (e) {}
}

function fetchJson(url, cb) {
  let done = false;
  const finish = (err, obj) => { if (done) return; done = true; cb(err, obj); };
  try {
    const mod = /^https:/i.test(url) ? require('https') : require('http');
    const req = mod.get(url, { timeout: 15000, headers: { 'user-agent': 'HongHubAutoUpdate/1.0', 'cache-control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 512 * 1024) { try { res.destroy(); } catch (e) {} finish(new Error('清单过大')); } });
      res.on('end', () => {
        try { finish(null, JSON.parse(body)); } catch (e) { finish(new Error('清单不是合法 JSON')); }
      });
      res.on('error', finish);
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} finish(new Error('清单请求超时')); });
    req.on('error', (e) => finish(e));
  } catch (e) { finish(e); }
}

function download(url, dest, cb) {
  let done = false;
  const finish = (err) => { if (done) return; done = true; cb(err); };
  try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (e) {}
  const part = dest + '.part';
  try { fs.unlinkSync(part); } catch (e) {}
  try {
    const req = require('https').get(url, { timeout: 300000, headers: { 'user-agent': 'HongHubAutoUpdate/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
        res.resume();
        const next = res.headers.location;
        let abs; try { abs = new URL(next, url).toString(); } catch (e) { return finish(new Error('跳转地址非法')); }
        if (!/^https:/i.test(abs)) return finish(new Error('跳转后不是 https，拒绝'));
        done = true;   // 交给下一跳
        return download(abs, dest, cb);
      }
      if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
      const out = fs.createWriteStream(part);
      res.pipe(out);
      out.on('finish', () => {
        try { fs.renameSync(part, dest); } catch (e) { return finish(e); }
        finish(null);
      });
      out.on('error', finish);
      res.on('error', finish);
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} finish(new Error('下载超时')); });
    req.on('error', finish);
  } catch (e) { finish(e); }
}

function isSetupDir(appDir) {
  try { return fs.readdirSync(appDir).some((f) => /^Uninstall.*\.exe$/i.test(f)); } catch (e) { return false; }
}

function installSilent(file, appDir, relaunch) {
  const cmd = 'timeout /t 3 /nobreak >nul & "' + file + '" /S /D=' + appDir +
    ' & timeout /t 2 /nobreak >nul & start "" "' + relaunch + '"';
  ctx.spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/* 主流程：检查一次 */
function checkOnce(opts) {
  const o = opts || {};
  const st = readState();
  st.current = String(o.current || st.current || '');
  const manifestUrl = String(o.manifestUrl || st.manifestUrl || DEFAULT_MANIFEST);
  return new Promise((resolve) => {
    fetchJson(manifestUrl, (err, m) => {
      st.lastCheck = new Date().toISOString();
      if (err) {
        st.attempts = (Number(st.attempts) || 0) + 1;
        st.lastResult = '检查失败：' + err.message;
        writeState(st);
        emit('check-failed', { reason: err.message, attempts: st.attempts });
        return resolve({ ok: false, reason: err.message, attempts: st.attempts, retryIn: nextDelay(st.attempts) });
      }
      const p = plan(m, st);
      st.lastResult = p.action;
      if (p.action !== 'download' && p.action !== 'install') {
        st.attempts = 0;
        writeState(st);
        if (p.action === 'notice' || p.action === 'uptodate') emit(p.action === 'notice' ? 'update-available' : 'uptodate', { remote: p.remote || '', current: p.current || '' });
        return resolve({ ok: true, plan: p });
      }
      st.attempts = 0;
      writeState(st);
      const dir = String(o.updateDir || st.updateDir || path.join(os.tmpdir(), 'kh-updates'));
      st.updateDir = dir;
      const dest = path.join(dir, p.file);
      emit('download-start', { remote: p.remote, url: p.url });
      download(p.url, dest, (e2) => {
        if (e2) {
          st.attempts = 1;
          st.lastResult = '下载失败：' + e2.message;
          writeState(st);
          emit('download-failed', { reason: e2.message });
          return resolve({ ok: false, reason: e2.message, attempts: 1, retryIn: nextDelay(1) });
        }
        let got = '';
        try { got = sha256File(dest); } catch (e3) { got = ''; }
        if (got.toLowerCase() !== String(p.sha256).toLowerCase()) {
          try { fs.unlinkSync(dest); } catch (e4) {}
          st.attempts = 1;
          st.lastResult = 'SHA256 不符，已删除安装包';
          writeState(st);
          emit('verify-failed', { expect: p.sha256, got: got });
          return resolve({ ok: false, reason: 'SHA256 不符（期望 ' + p.sha256.slice(0, 12) + '… 实得 ' + got.slice(0, 12) + '…），已删除安装包', attempts: 1 });
        }
        st.lastResult = '已下载并校验通过 v' + p.remote;
        writeState(st);
        emit('ready', { version: p.remote, file: dest });
        if (p.action === 'install' && o.autoInstall !== false) {
          const appDir = String(o.appDir || '');
          if (!appDir || !isSetupDir(appDir)) {
            emit('install-skipped', { reason: '当前是免安装版目录，已降级为「下载好等你手动装」' });
            return resolve({ ok: true, plan: p, ready: true, installed: false, reason: '免安装版目录，不执行静默覆盖' });
          }
          if (st.lastInstallNoChange) {
            emit('install-skipped', { reason: '上次安装后版本没变，已停止自动安装（只提示）' });
            return resolve({ ok: true, plan: p, ready: true, installed: false, reason: '上次安装未生效，停止自动安装' });
          }
          installSilent(dest, appDir, String(o.relaunch || ''));
          st.lastResult = '已触发静默安装 v' + p.remote;
          writeState(st);
          return resolve({ ok: true, plan: p, ready: true, installed: true });
        }
        resolve({ ok: true, plan: p, ready: true, installed: false });
      });
    });
  });
}

/* 启动后自检：上次装了但版本没变 → 记下来，停止自动安装 */
function detectInstallNoChange(current, state) {
  const st = state || readState();
  const pending = String(st.lastResult || '');
  if (/已触发静默安装 v/.test(pending)) {
    const want = pending.replace(/.*v/, '');
    st.lastInstallNoChange = (cmp(current, want) < 0);
    st.lastResult = st.lastInstallNoChange ? '上次安装未生效（仍为 v' + current + '）' : '升级已完成 v' + current;
    writeState(st);
  }
  return st;
}

function start(opts) {
  ctx = {
    app: opts.app, spawn: opts.spawn, notify: opts.notify,
    dir: opts.dir || (opts.app && opts.app.getPath ? opts.app.getPath('userData') : path.join(os.tmpdir(), 'kh-auto-update'))
  };
  const st = readState();
  if (String(st.mode) === 'off') return { ok: false, reason: '自动检查已关闭' };
  const cur = String(opts.version || '');
  detectInstallNoChange(cur, st);
  const interval = Math.max(30, Number(opts.intervalMin || 360)) * 60 * 1000;
  const first = setTimeout(() => { checkOnce({ current: cur, appDir: opts.appDir, relaunch: opts.relaunch, updateDir: opts.updateDir, autoInstall: opts.autoInstall }); }, Number(opts.firstDelayMs || 180000));
  if (first.unref) first.unref();
  const timer = setInterval(() => { checkOnce({ current: cur, appDir: opts.appDir, relaunch: opts.relaunch, updateDir: opts.updateDir, autoInstall: opts.autoInstall }); }, interval);
  if (timer.unref) timer.unref();
  return { ok: true, intervalMin: Math.round(interval / 60000), mode: st.mode };
}

module.exports = { cmp, checkDownloadUrl, sha256File, plan, nextDelay, checkOnce, detectInstallNoChange, start, readState, writeState, DEFAULT_MANIFEST };
