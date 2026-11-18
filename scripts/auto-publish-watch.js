/* 换版免人工：监听源文件变化 → 自动跑一键流水线（含客户端/开发端出包 + 下发）
   只监听「会改变产品内容」的入口，不监听 dist / logs / data 运行产物，避免自己触发自己。
   用法：
     node scripts\auto-publish-watch.js           常驻监听（开机自启任务用它）
     node scripts\auto-publish-watch.js --once    只检查一次（有变化才发版）
     node scripts\auto-publish-watch.js --dry     演练：只打印将执行的动作，不真出包
     node scripts\auto-publish-watch.js --resume  清除熔断暂停态，恢复自动发版
   防失败循环：发版前跑 doctor 预检，未过则跳过本轮不 bump；流水线连续失败达阈值
     (KH_AUTOPUB_FAIL_LIMIT，默认 2)写入 logs/auto-publish.paused.json 熔断暂停，
     之后每轮只跳过，直到人工 --resume。成功一次自动清零计数。
   环境变量：
     KH_AUTOPUB_COOLDOWN_MIN  两次发版最小间隔，默认 20 分钟
     KH_AUTOPUB_DEBOUNCE_SEC  变化静默多久才发版，默认 90 秒
     KH_AUTOPUB_FAIL_LIMIT    连续失败熔断阈值，默认 2
*/
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

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
const RESUME = ARGS.includes('--resume');
const FAIL_LIMIT = Math.max(1, Number(process.env.KH_AUTOPUB_FAIL_LIMIT || 2));
const PAUSE_FILE = path.join(LOG_DIR, 'auto-publish.paused.json');

let timer = null;
let lastRun = 0;
let running = false;

/* 熔断状态：连续失败达阈值后暂停自动发版，避免每 20 分钟 bump→失败→回滚的死循环。
   状态落盘，重启进程也保持暂停，直到人工 --resume。 */
function readPause() {
  try { return JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8')); } catch (e) { return null; }
}
function writePause(streak, reason, paused) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(PAUSE_FILE, JSON.stringify({
      at: new Date().toISOString(), failStreak: streak, reason: reason || '', paused: !!paused,
      note: paused
        ? '自动发版连续失败已熔断暂停；确认并修复后用 node scripts/auto-publish-watch.js --resume 恢复'
        : '失败计数记录（未熔断），下次成功会自动清零'
    }, null, 2) + '\n');
  } catch (e) {}
}
function clearPause() { try { fs.unlinkSync(PAUSE_FILE); } catch (e) {} }

/* 发版前预检：doctor 非 0 直接跳过本轮，不 bump、不制造错位态。 */
function preflight() {
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'doctor.js')],
      { cwd: ROOT, stdio: 'ignore', windowsHide: true, timeout: 120000 });
    return r.status === 0;
  } catch (e) { return false; }
}

function log(msg) {
  const line = new Date().toLocaleString('zh-CN') + '  ' + msg;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
  console.log(line);
}

function ignored(p) { return IGNORE.some((re) => re.test(p)); }

function runPipeline(reason) {
  if (running) return;
  /* 熔断暂停态：连续失败达阈值后不再自动发版，等人工 --resume。 */
  const pause = readPause();
  if (pause && pause.paused) {
    log('自动发版已熔断暂停（' + pause.at + ' 起，连续失败 ' + pause.failStreak +
      ' 次），本次跳过：' + reason + '；修复后运行 --resume 恢复');
    return;
  }
  const now = Date.now();
  if (now - lastRun < COOLDOWN_MS) {
    log('冷却中（' + Math.round((COOLDOWN_MS - (now - lastRun)) / 60000) + ' 分钟后可再发版），本次跳过：' + reason);
    return;
  }
  /* 发版前预检：doctor 失败说明环境未就绪，本轮不 bump（避免失败发版把版本推到错位态）。 */
  if (!DRY && !preflight()) {
    log('发版前预检(doctor)未通过，跳过本轮，不 bump 版本：' + reason + '（可手动 npm run doctor 查看）');
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
    if (code === 0) {
      clearPause(); // 成功即清零熔断状态
      return;
    }
    // 失败累计：读现有 streak（可能别的进程写过），+1；达阈值则熔断
    const prev = readPause();
    const streak = (prev && prev.failStreak ? prev.failStreak : 0) + 1;
    if (streak >= FAIL_LIMIT) {
      writePause(streak, reason, true);
      log('⚠ 自动发版连续失败 ' + streak + ' 次，已熔断暂停。修复后运行：node scripts\\auto-publish-watch.js --resume');
    } else {
      writePause(streak, reason, false); // 未满阈值仅记数，不阻断下次发版
      log('自动发版失败累计 ' + streak + '/' + FAIL_LIMIT + '（未熔断，下次仍可发版）');
    }
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

if (RESUME) {
  clearPause();
  log('已清除熔断暂停状态，自动发版恢复；失败计数归零。');
} else if (ONCE) {
  log('单次检查：直接执行一次流水线（' + (DRY ? '演练' : '真实出包') + '）');
  runPipeline('手动 --once');
} else {
  const p = readPause();
  if (p && p.paused) log('⚠ 当前处于熔断暂停态（' + p.at + '），自动发版不会执行；修复后运行 --resume');
  start();
}
