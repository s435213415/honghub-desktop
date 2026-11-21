/* 开发端自更新（仅 DEV_BUILD 加载；客户成品会删掉本文件）
   设计原则：
   - 只认开发端安装包（文件名含「开发端」或 dev-setup），绝不下载/安装客户版 Setup，
     避免开发端被替换成客户硬锁版，也避免污染客户下发通道。
   - 有新版本才动作：静默安装 → 自动以 --dev 重新拉起。
   - 换版全自动的闭环是：源文件变化 → scripts\auto-publish-watch.js 跑一键流水线 →
     出现新的开发端安装包 → 下次启动/间隔内的检查自动装上升级。

   1.7.83 修的两处「名存实亡」：
   1) 以前只扫「程序目录\dist」，但安装后的开发端根本没有 dist 目录，等于永远跳过。
      现在按优先级扫：KH_DEV_SETUP_DIR → 程序目录\dist → 程序目录 → 桌面交付夹
      （鸿汇影·开发端_v* / 鸿汇影·客户成品_v*）→ Desktop 根。
   2) 以前只认「鸿汇影桌面版 开发端 X.exe」，而构建产物叫 dev-setup.X.exe（交付夹里才改名），
      两边对不上。现在两种命名都认，arm64 变体也认。
   状态落盘 server/data/dev-auto-update-status.json，供 /admin/selfupdate 展示；
   运维台点「立即检查」= 写 server/data/dev-update.trigger，本模块 20 秒内响应。
   开关：KH_AUTO_UPDATE=0 关闭；KH_UPDATE_INTERVAL_MIN 调整间隔（默认 360 分钟）。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'server', 'data');
const LOG = path.join(DATA, 'dev-auto-update.log');
const STATUS = path.join(DATA, 'dev-auto-update-status.json');
const TRIGGER = path.join(DATA, 'dev-update.trigger');
const INTERVAL_MS = Math.max(5, Number(process.env.KH_UPDATE_INTERVAL_MIN || 360)) * 60 * 1000;

const NAME_RE = /^(?:鸿汇影桌面版\s*开发端|dev-setup)[\s.\-_]*([\d.]+)(?:-arm64)?\.exe$/i;

let running = false;
let timer = null;
let trigTimer = null;
const st = {
  checkedAt: '',
  lastMsg: '尚未检查',
  current: '',
  foundVersion: '',
  foundPath: '',
  searched: [],
  archSkips: 0,
  hostArch: '',
  variant: ''
};

function writeStatus() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(STATUS, JSON.stringify(Object.assign({ schema: 1 }, st), null, 2));
  } catch (e) { /* 状态写不进去不影响自更新本身 */ }
}

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

/* 搜索根：先显式目录，再安装目录，最后桌面交付夹。去重、只保留存在的。 */
function searchRoots() {
  const roots = [];
  const push = (p) => { if (p && roots.indexOf(p) < 0) roots.push(p); };
  const env = (process.env.KH_DEV_SETUP_DIR || '').trim();
  if (env) push(env);
  push(path.join(ROOT, 'dist'));
  push(ROOT);
  push(path.join(ROOT, '..', 'dist'));
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    push(desktop);
    const names = fs.readdirSync(desktop).filter(n => /^鸿汇影[·・](开发端|客户成品)_v/i.test(n));
    for (const n of names) push(path.join(desktop, n));
  } catch (e) { /* 无桌面目录（服务器环境）忽略 */ }
  try {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Programs');
    for (const n of fs.readdirSync(p)) {
      const d = path.join(p, n, 'dist');
      if (fs.existsSync(d)) push(d);
    }
  } catch (e) { /* 忽略 */ }
  return roots.filter(d => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
}

function findDevSetup() {
  let best = null;
  const searched = [];
  let archSkips = 0;
  /* 架构必须对得上：-arm64 的包只给 arm64 主机装，无后缀的只给 x64 主机装。
     否则 arm64 机器上会去装 x64 包（或反过来），静默安装直接失败，
     用户只会看到「说升级了但版本没变」。 */
  const hostArm = process.arch === 'arm64';
  for (const dir of searchRoots()) {
    searched.push(dir);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names) {
      const m = name.match(NAME_RE);
      if (!m) continue;
      if (/-arm64\.exe$/i.test(name) !== hostArm) { archSkips++; continue; }
      const file = path.join(dir, name);
      try {
        const size = fs.statSync(file).size;
        if (size < 50 * 1024 * 1024) continue; // 体积异常，不当作安装包
        if (!best || cmp(m[1], best.version) > 0) best = { version: m[1], file, size };
      } catch (e) { /* 忽略单个文件错误 */ }
    }
  }
  st.searched = searched;
  st.archSkips = archSkips;
  st.hostArch = process.arch;
  return best;
}

function relaunchPath() {
  try { return require('electron').app.getPath('exe'); } catch (e) { return process.execPath; }
}

function installAndRestart(setup) {
  const exe = relaunchPath();
  const appDir = path.dirname(exe);
  /* /S 静默 + /D 覆盖安装到当前目录：不带 /D 时 NSIS 会装回默认目录，
     结果变成两份并存，重启的还是旧那份，看起来「升级成功但版本没变」。
     /D= 必须是最后一个参数，且不能加引号（NSIS 的规矩）。 */
  const cmd = 'timeout /t 4 /nobreak >nul & "' + setup + '" /S /D=' + appDir +
    ' & timeout /t 3 /nobreak >nul & start "" "' + exe + '" --dev';
  log('静默安装开发端并重启：' + setup + ' → ' + appDir);
  st.lastMsg = '正在静默安装 ' + path.basename(setup);
  writeStatus();
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
    st.current = cur;
    st.checkedAt = new Date().toLocaleString('zh-CN');
    const dev = findDevSetup();
    if (!dev) {
      st.foundVersion = ''; st.foundPath = '';
      const skipNote = st.archSkips ? '，跳过 ' + st.archSkips + ' 个架构不符的包' : '';
      st.lastMsg = '没找到开发端安装包（已扫 ' + st.searched.length + ' 个目录' + skipNote + '）';
      log('没找到开发端安装包，跳过（v' + cur + '，已扫 ' + st.searched.length + ' 个目录' + skipNote + '）');
      writeStatus();
      return;
    }
    st.foundVersion = dev.version;
    st.foundPath = dev.file;
    if (cmp(dev.version, cur) <= 0) {
      st.lastMsg = '已是最新 v' + cur + '（找到 v' + dev.version + '）';
      log('已是最新 v' + cur + '（找到开发端 v' + dev.version + '）');
      writeStatus();
      return;
    }
    st.lastMsg = '发现新版 v' + dev.version + '，准备静默升级';
    log('发现新版开发端 v' + dev.version + '（当前 v' + cur + '），准备静默升级');
    writeStatus();
    installAndRestart(dev.file);
  } catch (e) {
    st.lastMsg = '检查失败：' + e.message;
    log('检查失败：' + e.message);
    writeStatus();
  } finally {
    running = false;
  }
}

/* 运维台「立即检查」：只认 trigger 文件，避免 server 进程反向调用主进程 */
function watchTrigger() {
  if (trigTimer) return;
  let seen = '';
  try { seen = String(fs.statSync(TRIGGER).mtimeMs); } catch (e) { seen = ''; }
  trigTimer = setInterval(() => {
    let now = '';
    try { now = String(fs.statSync(TRIGGER).mtimeMs); } catch (e) { return; }
    if (now && now !== seen) {
      seen = now;
      log('运维台请求立即检查');
      checkOnce();
    }
  }, 20000);
  if (trigTimer.unref) trigTimer.unref();
}

function start() {
  if (timer) return;
  if (process.env.KH_AUTO_UPDATE === '0') { log('已按 KH_AUTO_UPDATE=0 关闭'); st.lastMsg = '已按 KH_AUTO_UPDATE=0 关闭'; writeStatus(); return; }
  st.current = currentVersion();
  st.variant = process.env.KH_CLIENT_ARCH || process.arch || '';
  setTimeout(checkOnce, 45 * 1000);
  timer = setInterval(checkOnce, INTERVAL_MS);
  if (timer.unref) timer.unref();
  watchTrigger();
  log('已启用（搜索开发端安装包，间隔 ' + Math.round(INTERVAL_MS / 60000) + ' 分钟）');
  writeStatus();
}

module.exports = { start, checkOnce };
