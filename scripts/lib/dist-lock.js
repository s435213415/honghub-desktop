'use strict';
/* 跨进程文件锁：让「自动发版」与「手工出包」互斥，根治 dist/ 争用。
 *
 * 为什么需要它：auto-publish-watch.js 用进程内内存态(running/lastRun)防重入，
 * 但手工出包是另一个进程，看不到那把内存锁，于是两个 electron-builder 同时写
 * dist/ —— 上一次就是把开发端包写进了客户版别名 desktop-setup.exe。
 * 文件锁落在磁盘上，所有进程共享同一把锁。
 *
 * 设计：
 *   - 锁文件 ROOT/dist/.build.lock，内容 JSON：{ pid, owner, ts, host, label }
 *   - acquire 用 fs.openSync(p,'wx') 原子创建，抢不到的自旋等待到超时。
 *   - 重入：调用方进程链通过环境变量 KH_DIST_LOCK_OWNER 传递同一个 owner，
 *     owner 相同视为同一条流水线，直接复用锁（watcher→oneclick→build-exe 只锁一次）。
 *   - stale：锁里的 pid 已不存在，或时间戳超过 STALE_MS，判定为崩溃残留，强制清理。
 *   - release 只释放自己持有的锁（比对 owner），绝不误删别人的锁。
 *
 * 用法（CLI）：
 *   node scripts/lib/dist-lock.js --check                 只读：0=空闲或自己持有, 3=别人占用
 *   node scripts/lib/dist-lock.js --run <脚本> [args...]  持锁运行子进程，结束自动释放
 *   node scripts/lib/dist-lock.js --acquire --label xx    获取锁并打印 owner（配合 --release）
 *   node scripts/lib/dist-lock.js --release               释放自己 owner 的锁
 *
 * 用法（模块）：
 *   const lock = require('./lib/dist-lock');
 *   const h = lock.acquire({ label: 'build:client' });   // 失败抛错
 *   try { ...写 dist... } finally { h.release(); }
 *   // 或 lock.run(fn, { label }) —— fn 同步执行，自动释放
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const LOCK = path.join(ROOT, 'dist', '.build.lock');
const DEFAULT_TIMEOUT_MS = Math.max(5, Number(process.env.KH_DIST_LOCK_TIMEOUT_MIN || 15)) * 60 * 1000;
const DEFAULT_STALE_MS = Math.max(5, Number(process.env.KH_DIST_LOCK_STALE_MIN || 30)) * 60 * 1000;
const POLL_MS = 1000;
const OWNER_ENV = 'KH_DIST_LOCK_OWNER';

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function readLock() {
  try {
    const raw = fs.readFileSync(LOCK, 'utf8');
    const o = JSON.parse(raw);
    if (!o || !o.owner || !o.pid) return null;
    return o;
  } catch (e) { return null; }
}

function isAlive(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  try { process.kill(Number(pid), 0); return true; }
  catch (e) { return e && e.code === 'EPERM'; } // EPERM = 存在但无权限，视为存活
}

function owner() {
  if (process.env[OWNER_ENV]) return process.env[OWNER_ENV];
  const o = String(process.pid) + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  process.env[OWNER_ENV] = o; // 传给自己派生的子进程，实现重入
  return o;
}

function newOwner() {
  const o = String(process.pid) + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  process.env[OWNER_ENV] = o;
  return o;
}

function isMine(lockInfo) { return !!lockInfo && lockInfo.owner === process.env[OWNER_ENV]; }

function stale(lockInfo) {
  if (!lockInfo) return true;
  if (!isAlive(lockInfo.pid)) return true;
  if (lockInfo.ts && Date.now() - Number(lockInfo.ts) > DEFAULT_STALE_MS) return true;
  return false;
}

function clearLock() { try { fs.unlinkSync(LOCK); } catch (e) {} }

function writeLock(o) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const fd = fs.openSync(LOCK, 'wx'); // 原子创建：已存在则抛 EEXIST
  try { fs.writeFileSync(fd, JSON.stringify(o, null, 2), 'utf8'); }
  finally { fs.closeSync(fd); }
}

function describe(o) {
  return 'owner=' + o.owner + ' pid=' + o.pid + (o.label ? ' label=' + o.label : '');
}

/* 获取锁。成功返回 { release(), owner }；失败抛错。
   opts: { timeoutMs, label, forceNewOwner } */
function acquire(opts) {
  opts = opts || {};
  if (opts.forceNewOwner) newOwner(); else owner();
  const me = process.env[OWNER_ENV];
  const timeout = Number(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  const deadline = Date.now() + timeout;
  let waited = 0;
  for (;;) {
    const cur = readLock();
    if (!cur) {
      try {
        writeLock({ pid: process.pid, owner: me, ts: Date.now(), host: os.hostname(), label: opts.label || '' });
        return { owner: me, release: () => release(me) };
      } catch (e) {
        if (e && e.code !== 'EEXIST') throw e;
        // 竞态：别人刚创建，落到下一轮判断
      }
    } else if (isMine(cur)) {
      // 同一条流水线重入：续期时间戳后复用，release 由最外层负责
      try {
        const fresh = Object.assign({}, cur, { ts: Date.now() });
        fs.writeFileSync(LOCK, JSON.stringify(fresh, null, 2), 'utf8');
      } catch (e) {}
      return { owner: me, release: () => release(me), reentrant: true };
    } else if (stale(cur)) {
      clearLock(); // 崩溃残留，强制清理后再抢
      continue;
    }
    waited += 1;
    if (waited === 1) {
      console.error('[dist-lock] dist/ 正被另一进程占用（' + describe(cur) + '），等待最多 ' +
        Math.round(timeout / 60000) + ' 分钟…');
    }
    if (Date.now() >= deadline) {
      throw new Error('dist/ 锁等待超时，仍被占用：' + describe(readLock() || cur));
    }
    sleep(POLL_MS);
  }
}

function release(who) {
  const me = who || process.env[OWNER_ENV];
  const cur = readLock();
  if (!cur) return true;
  if (cur.owner !== me) return false; // 不是自己的锁，绝不误删
  clearLock();
  return true;
}

function check() {
  const cur = readLock();
  if (!cur) return { held: false };
  if (isMine(cur)) return { held: false, mine: true, info: cur };
  if (stale(cur)) { clearLock(); return { held: false, stale: true, info: cur }; }
  return { held: true, info: cur };
}

function withLock(fn, opts) {
  const h = acquire(opts);
  try { return fn(h); }
  finally { h.release(); }
}

/* 持锁运行一个子进程，结束（含异常）自动释放。
   子进程继承 KH_DIST_LOCK_OWNER，因此其内部若再申请锁会命中重入分支。 */
function run(argv, opts) {
  if (!argv || !argv.length) throw new Error('--run 需要一个命令');
  const h = acquire(opts);
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      cwd: ROOT, stdio: 'inherit', windowsHide: true, env: Object.assign({}, process.env)
    });
    return r.status == null ? 1 : r.status;
  } finally { h.release(); }
}

module.exports = {
  ROOT, LOCK, acquire, release, check, withLock, run, owner, isAlive,
  OWNER_ENV, describe
};

/* CLI */
if (require.main === module) {
  const a = process.argv.slice(2);
  try {
    if (a.includes('--check')) {
      const c = check();
      if (c.held) {
        console.log('LOCKED ' + describe(c.info));
        process.exit(3);
      }
      console.log('FREE' + (c.stale ? ' (cleared stale)' : '') + (c.mine ? ' (mine)' : ''));
      process.exit(0);
    }
    if (a.includes('--release')) { release(); console.log('RELEASED'); process.exit(0); }
    if (a.includes('--acquire')) {
      const i = a.indexOf('--label');
      const label = i >= 0 ? a[i + 1] : 'cli';
      const h = acquire({ label, forceNewOwner: true });
      console.log('ACQUIRED ' + h.owner);
      process.exit(0);
    }
    const i = a.indexOf('--run');
    if (i >= 0) {
      const labelIdx = a.indexOf('--label');
      const opts = {};
      if (labelIdx >= 0) { opts.label = a[labelIdx + 1]; a.splice(labelIdx, 2); }
      const j = a.indexOf('--run');
      process.exit(run(a.slice(j + 1), opts));
    }
    console.error('用法: --check | --release | --acquire [--label x] | --run <cmd> [args...]');
    process.exit(2);
  } catch (e) {
    console.error('[dist-lock] ' + (e && e.message || e));
    process.exit(1);
  }
}
