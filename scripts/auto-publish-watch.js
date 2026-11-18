/* 换版免人工：监听源文件变化 → 自动跑一键流水线（含客户端/开发端出包 + 下发）
   只监听「会改变产品内容」的入口，不监听 dist / logs / data 运行产物，避免自己触发自己。
   用法：
     node scripts\auto-publish-watch.js           常驻监听（开机自启任务用它）
     node scripts\auto-publish-watch.js --once    只检查一次（有变化才发版）
     node scripts\auto-publish-watch.js --dry     演练：只打印将执行的动作，不真出包
   环境变量：
     KH_AUTOPUB_COOLDOWN_MIN  两次发版最小间隔，默认 20 分钟
     KH_AUTOPUB_DEBOUNCE_SEC  变化静默多久才发版，默认 90 秒
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG = path.join(LOG_DIR, 'auto-publish.log');
const WATCH = ['app', 'server', 'features', 'assets', 'harmony', 'electron-main.js', 'dev-auto-update.js', 'package.json'];
const IGNORE = [
  /\bserver[\\/]data[\\/]/i,
  /\bserver[\\/]snapshots[\\/]/i,
  /\blogs[\\/]/i,
  /\bdist[\\/]/i,
  /\bnode_modules[\\/]/i,
  /\.log$/i, /\.tmp$/i, /\.bak$/i, /\.dev-backup$/i, /\.jsonl$/i,
  /access-token\.txt$/i
];
const COOLDOWN_MS = Math.max(5, Number(process.env.KH_AUTOPUB_COOLDOWN_MIN || 20)) * 60 * 1000;
const DEBOUNCE_MS = Math.max(30, Number(process.env.KH_AUTOPUB_DEBOUNCE_SEC || 90)) * 1000;

const ARGS = process.argv.slice(2);
const ONCE = ARGS.includes('--once');
const DRY = ARGS.includes('--dry');

let timer = null;
let lastRun = 0;
let running = false;

function log(msg) {
  const line = new Date().toLocaleString('zh-CN') + '  ' + msg;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
  console.log(line);
}

function ignored(p) { return IGNORE.some((re) => re.test(p)); }

function runPipeline(reason) {
  if (running) return;
  const now = Date.now();
  if (now - lastRun < COOLDOWN_MS) {
    log('冷却中（' + Math.round((COOLDOWN_MS - (now - lastRun)) / 60000) + ' 分钟后可再发版），本次跳过：' + reason);
    return;
  }
  /* 跨进程 dist 锁：手工出包/另一条流水线正占用 dist 时，本次直接跳过，
     绝不并发写 dist/（并发是把开发端包写进客户别名的根因）。真正的持锁由
     oneclick-release.js 负责；这里只做前置探测，避免无谓拉起一整个进程。 */
  try {
    const lock = require('./lib/dist-lock');
    const st = lock.check();
    if (st.held) {
      log('dist 出包锁被占用（' + lock.describe(st.info) + '），本次跳过：' + reason);
      return;
    }
  } catch (e) { /* 锁模块异常不阻断发版，oneclick 内部仍会兜底申请 */ }
  running = true;
  lastRun = now;
  const argv = [path.join(__dirname, 'oneclick-release.js'), '--bump', '--keep-going'];
  if (DRY) argv.push('--dry');
  log('开始自动发版：' + reason + (DRY ? '（演练）' : ''));
  const p = spawn(process.execPath, argv, { cwd: ROOT, env: Object.assign({}, process.env), windowsHide: true });
  p.stdout.on('data', (d) => { const s = String(d).trim(); if (s) log('[流水线] ' + s.split('\n').slice(-1)[0]); });
  p.stderr.on('data', (d) => { const s = String(d).trim(); if (s) log('[流水线:err] ' + s); });
  p.on('close', (code) => {
    running = false;
    log('发版结束，退出码 ' + code + '。产物见 dist 与桌面两个交付夹。');
  });
}

function bump(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; runPipeline(reason); }, DEBOUNCE_MS);
}

function watchOne(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    try {
      fs.watch(abs, { recursive: true }, (evt, file) => {
        const full = path.join(abs, file || '');
        if (ignored(full)) return;
        bump(rel + '\\' + String(file || ''));
      });
      log('监听 ' + rel);
    } catch (e) { log('监听失败 ' + rel + '：' + e.message); }
  } else {
    fs.watch(abs, () => bump(rel));
    log('监听 ' + rel);
  }
}

function start() {
  log('换版免人工已启动（冷却 ' + COOLDOWN_MS / 60000 + ' 分钟，静默 ' + DEBOUNCE_MS / 1000 + ' 秒）');
  WATCH.forEach(watchOne);
}

if (ONCE) {
  log('单次检查：直接执行一次流水线（' + (DRY ? '演练' : '真实出包') + '）');
  runPipeline('手动 --once');
} else {
  start();
}
