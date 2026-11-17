/* 开发端自更新（仅 DEV_BUILD 加载；客户成品会删掉本文件）
   设计原则：
   - 只认「本机 dist 里的开发端安装包」（文件名必须含“开发端”），绝不下载/安装客户版 Setup，
     避免开发端被替换成客户硬锁版，也避免污染客户下发通道。
   - 有新版本才动作：静默安装 → 自动以 --dev 重新拉起。
   - 换版全自动的闭环是：源文件变化 → scripts\auto-publish-watch.js 跑一键流水线 →
     dist 出现新的开发端安装包 → 下次启动/6 小时内的检查自动装上升级。
   开关：KH_AUTO_UPDATE=0 关闭；KH_UPDATE_INTERVAL_MIN 调整间隔（默认 360 分钟）。 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'server', 'data');
const LOG = path.join(DATA, 'dev-auto-update.log');
const DIST = path.join(ROOT, 'dist');
const INTERVAL_MS = Math.max(5, Number(process.env.KH_UPDATE_INTERVAL_MIN || 360)) * 60 * 1000;

let running = false;
let timer = null;

function log(msg) {
  const line = new Date().toLocaleString('zh-CN') + '  ' + msg;
  try { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
  console.log('[dev-auto-update] ' + msg);
}

function currentVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''; } catch (e) { return ''; }
}

function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function findDevSetup() {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(DIST); } catch (e) { return null; }
  for (const name of names) {
    const m = name.match(/^鸿汇影桌面版 开发端 ([\d.]+)\.exe$/i);
    if (!m) continue;
    const file = path.join(DIST, name);
    try {
      const size = fs.statSync(file).size;
      if (size < 50 * 1024 * 1024) continue; // 体积异常，不当作安装包
      if (!best || cmp(m[1], best.version) > 0) best = { version: m[1], file, size };
    } catch (e) { /* 忽略单个文件错误 */ }
  }
  return best;
}

function relaunchPath() {
  try { return require('electron').app.getPath('exe'); } catch (e) { return process.execPath; }
}

function installAndRestart(setup) {
  const exe = relaunchPath();
  const cmd = 'timeout /t 4 /nobreak >nul & "' + setup + '" /S & timeout /t 3 /nobreak >nul & start "" "' + exe + '" --dev';
  log('静默安装开发端并重启：' + setup);
  try {
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { log('拉起安装失败：' + e.message); return; }
  setTimeout(() => { try { require('electron').app.quit(); } catch (e) { process.exit(0); } }, 300);
}

async function checkOnce() {
  if (running || process.env.KH_AUTO_UPDATE === '0') return;
  running = true;
  try {
    const cur = currentVersion();
    const dev = findDevSetup();
    if (!dev) { log('dist 里没有开发端安装包，跳过（v' + cur + '）'); return; }
    if (cmp(dev.version, cur) <= 0) { log('已是最新 v' + cur + '（dist 开发端 v' + dev.version + '）'); return; }
    log('发现新版开发端 v' + dev.version + '（当前 v' + cur + '），准备静默升级');
    installAndRestart(dev.file);
  } catch (e) {
    log('检查失败：' + e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  if (process.env.KH_AUTO_UPDATE === '0') { log('已按 KH_AUTO_UPDATE=0 关闭'); return; }
  setTimeout(checkOnce, 45 * 1000);
  timer = setInterval(checkOnce, INTERVAL_MS);
  log('已启用（源 dist 开发端安装包，间隔 ' + Math.round(INTERVAL_MS / 60000) + ' 分钟）');
}

module.exports = { start, checkOnce };
