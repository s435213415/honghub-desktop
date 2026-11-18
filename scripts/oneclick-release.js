#!/usr/bin/env node
'use strict';
/* 一键流水线：版本同步 → 页面/平台表重建 → HAP 出包签名 → 桌面端出包
 *            → 客户版 Setup → 免安装 zip → 下发（镜像站/桌面夹/清单） → 验收
 *
 * 用法（在工程根）：
 *   node scripts/oneclick-release.js            # 常规发版（不涨版本号）
 *   node scripts/oneclick-release.js --bump     # 显式涨一位版本号再出包
 *   node scripts/oneclick-release.js --skip-hap # 只重出 Windows 端
 *   node scripts/oneclick-release.js --no-release --no-client  # 只出桌面端主包
 *   node scripts/oneclick-release.js --dry      # 只打印将要执行的步骤
 *
 * 任何一步非 0 退出即中止，并在 logs/oneclick-*.log 里保留完整输出。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const args = process.argv.slice(2);
const BUMP = args.includes('--bump');
const SKIP_HAP = args.includes('--skip-hap');
const NO_CLIENT = args.includes('--no-client');
const NO_RELEASE = args.includes('--no-release');
const DRY = args.includes('--dry');
const CONTINUE_ON_FAIL = args.includes('--keep-going');

fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG = path.join(LOG_DIR, 'oneclick-' + stamp + '.log');
const lines = [];
function say(s) { console.log(s); lines.push(s); }
function flush() { try { fs.writeFileSync(LOG, lines.join('\n') + '\n', 'utf8'); } catch (e) {} }

const ENV = Object.assign({}, process.env, {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  PYTHONIOENCODING: 'utf-8',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/'
});
// 签名口令与 PATH 兜底（Windows 上直接双击 cmd 时 PATH 常常没有 System32）
ENV.PATH = 'C:\\Windows\\System32;C:\\Windows;C:\\Users\\admin\\Desktop\\command-line-tools\\tool\\jre\\bin;' + (process.env.PATH || '');
try { require('./lib/env').apply(); } catch (e) {}
for (const k of ['OH_KEY_PWD', 'PYTHON_BIN', 'KH_HDC', 'KH_DEPLOY_CMD']) if (process.env[k] && !ENV[k]) ENV[k] = process.env[k];

/* ★ python 绝对路径兜底：开机自启 watcher 用系统 node 启动，PATH 里没有 WorkBuddy
   私有 python，裸 `python` 会 ENOENT —— 这是自动发版 4 连败的根因。
   探测到绝对路径后同时注入 PYTHON_BIN（所有子脚本都读它）与 ENV.PATH（兜底裸命令）。 */
const libEnv = require('./lib/env');
const PY = libEnv.findPython();
ENV.PYTHON_BIN = PY;
process.env.PYTHON_BIN = PY;
if (PY !== 'python') {
  const pyDir = require('path').dirname(PY);
  ENV.PATH = pyDir + ';' + ENV.PATH;
  console.log('[python] 采用绝对路径：' + PY);
}

const STEPS = [];
// retry=失败时自动重跑一次（仅给验收这类偶发时序步骤用）
function step(label, cmd, argv, retry, soft) { STEPS.push({ label, cmd, argv, retry: !!retry, soft: !!soft }); }

step('0/8 环境预检', process.execPath, [path.join(__dirname, 'doctor.js')]);
step('1/8 版本对齐' + (BUMP ? '（+1 位）' : '（不涨版本）'), process.execPath,
  [path.join(__dirname, 'version.js'), BUMP ? '--bump' : '--sync']);
step('2/8 页面频道/平台表重建', process.execPath, [path.join(__dirname, 'repair-page-sources.js')]);
step('2.1/8 平台格子重建（BUILTIN_SITES）', process.execPath, [path.join(__dirname, 'rebuild-builtin-sites.js')]);
if (!SKIP_HAP) {
  step('3/8 深开鸿前端生成', PY, [path.join('harmony', 'build_hap.py')]);
  step('3.1/8 HAP 注入与签名', process.execPath, [path.join(__dirname, 'hap-sign.js')]);
}
step('4/8 桌面端出包（含内置 HAP / 清单）', process.execPath, [path.join(__dirname, 'build-exe.js'), '--no-bump', '--skip-zip']);
if (!NO_CLIENT) step('5/8 客户版 Setup（剥离 /admin 运维入口）', process.execPath, [path.join(__dirname, 'build-client-exe.js')]);
/* 6/8 去掉了 make-portable-zip：它从开发端 win-unpacked 打包，会把开发端页面下发成客户免安装包。
   客户免安装 zip 由 build-client-exe.js 在净化后直接从 win-unpacked 打，才是正确来源。 */
if (!NO_RELEASE) {
  step('7/8 下发（镜像站 + 桌面夹 + 清单）', process.execPath, [path.join(__dirname, 'auto-release.js')]);
  // 8/8 零积分公网下发：把签发好的成品同步到本机镜像站 8099，经 Cloudflare 隧道
  //      回下验证三件直链并输出公网下载链接。走本机文件+隧道流量，不消耗平台积分。
  step('7.1/8 零积分公网下发（上传+回下验证+链接）', process.execPath, [path.join(__dirname, 'publish-free.js')]);
}
// 验收会起临时中枢做 HTTP 探测，紧接 7.1/8 公网下发时偶发端口/时序抖动；失败自动重跑一次
step('8/8 验收', process.execPath, [path.join(__dirname, 'verify-release.js')], true);
/* 8.1/8 旧公站点只读回验：确认线上清单=本地版本、三件直链可达。
   注意：站点发布能力只能由 WorkBuddy 宿主触发，脚本绝不在这里做发布动作
   （上一轮并发发布争用 dist/ 导致版本错位，教训已固化）。此处只回验，不写不发布。 */
if (!NO_RELEASE) step('8.1/8 旧公站点回验（只读告警）', process.execPath, [path.join(__dirname, 'site-publish.js'), '--verify', '--warn-only']);

/* 8.2/8 开鸿设备端版本自动跟进主线（独立应用 com.kaihong.movie）。
   主线 bump 后对齐设备端版本→官方重签→镜像同步→更新桌面设备夹，旧夹归档。
   该工程在另一工作区且涉及官方签名，失败只告警不阻断 Windows 主线发版
   （设备端另有 key-auto-sync --watch 守护兜底）。 */
const KH_PROJECT = path.join(require('os').homedir(), 'WorkBuddy', '2026-11-12-16-34-57', 'KaihongMovie');
const SYNC_DEV = path.join(KH_PROJECT, 'sync-device-version.py');
if (fs.existsSync(SYNC_DEV)) {
  const py = (ENV.PYTHON_BIN && ENV.PYTHON_BIN !== 'python') ? ENV.PYTHON_BIN : 'python';
  step('8.2/8 开鸿设备端版本跟进（重签+镜像+桌面夹，失败告警）', py,
    [SYNC_DEV, '--apply'], false, true);
}

say('=== 鸿汇影一键流水线 ' + new Date().toLocaleString('zh-CN') + ' ===');
say('工程：' + ROOT);
say('日志：' + LOG);
STEPS.forEach(function (s, i) { say('  ' + (i + 1) + ') ' + s.label); });
if (DRY) { flush(); say('（--dry：以上步骤仅预览，未执行）'); process.exit(0); }

/* 跨进程文件锁：自动发版(watcher)与手工出包若同时跑，会争用 dist/ 并把开发端包
   写进客户版别名。所有真正的出包都在这里申请同一把磁盘锁；子进程通过环境变量
   KH_DIST_LOCK_OWNER 继承，内部脚本若再申请会命中重入分支，不会自锁。 */
let _distLock = null;
try {
  _distLock = require('./lib/dist-lock').acquire({ label: 'oneclick' + (BUMP ? ' --bump' : '') });
  /* ★ 必须把 owner 写回 ENV 快照：ENV 在文件顶部就 Object.assign 好了，早于 acquire，
     不含 acquire 设置的 KH_DIST_LOCK_OWNER。不写回的话子进程 build-exe 会当成别人持锁
     而等待 15 分钟，与父进程自己死锁（2026-11-18 11:04 实测踩坑）。 */
  ENV[require('./lib/dist-lock').OWNER_ENV] = _distLock.owner;
  say('[锁] 已获取 dist 出包锁（owner ' + _distLock.owner + '）');
} catch (e) {
  say('[锁] 获取 dist 出包锁失败，中止：' + (e && e.message || e));
  flush();
  process.exit(1);
}
process.on('exit', function () { try { if (_distLock) _distLock.release(); } catch (e) {} });

/* 失败回滚保护：--bump 把版本推到新号后，若流水线中途失败，源码会停在「新版本
   + 旧产物」的错位中间态（曾导致体检掉到 15/20）。这里在 bump 前记下 git 里受控
   的版本文件，失败时 checkout 回退，避免留半截。仅对 --bump 且工作区原本干净时生效。 */
const VERSION_FILES = ['package.json', 'app/index.html',
  'harmony/entry/src/main/resources/rawfile/www/index.html',
  'releases/index.json', 'server/feature-version.json', 'server/manifest.json'];
let _preBumpClean = false;
if (BUMP) {
  const st = require('child_process').spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  _preBumpClean = st.status === 0 && !String(st.stdout || '').trim();
  if (_preBumpClean) say('[回滚保护] bump 前工作区干净，失败将自动回滚版本文件');
  else say('[回滚保护] bump 前工作区有改动，跳过自动回滚（避免误伤未提交工作）');
}
function rollbackBump() {
  if (!BUMP || !_preBumpClean) return;
  say('[回滚保护] 流水线失败，回滚版本文件到发版前');
  const r = require('child_process').spawnSync('git', ['checkout', '--'].concat(VERSION_FILES),
    { cwd: ROOT, encoding: 'utf8' });
  say('[回滚保护] ' + (r.status === 0 ? '版本文件已回退' : '回退失败，请人工 git checkout'));
}

const results = [];
for (const s of STEPS) {
  say('\n=== ' + s.label + ' ===');
  const t0 = Date.now();
  let r = spawnSync(s.cmd, s.argv, { cwd: ROOT, stdio: 'inherit', env: ENV });
  // 偶发时序步骤失败时自动重跑一次（验收起临时中枢，紧跟公网下发易抖动）
  if (r.status !== 0 && s.retry) {
    say('  ↻ ' + s.label + ' 首次失败，3 秒后自动重试一次');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    r = spawnSync(s.cmd, s.argv, { cwd: ROOT, stdio: 'inherit', env: ENV });
  }
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  results.push({ label: s.label, ok, ms });
  say((ok ? '✔ ' : '✘ ') + s.label + ' · ' + Math.round(ms / 1000) + 's');
  flush();
  if (!ok) {
    if (s.soft) { say('  ⚠ ' + s.label + ' 未通过（告警不阻断主线）'); } else say('\n流水线在此中止：' + s.label);
    say('排查建议：npm run doctor；HAP 签名失败看 logs 与 harmony/signing；电子包失败看 node_modules 是否完整。');
    flush();
    if (!s.soft && !CONTINUE_ON_FAIL) { rollbackBump(); process.exit(r.status || 1); }
  }
}

const fail = results.filter(function (x) { return !x.ok; }).length;
const hardFail = results.filter(function (x, i) { return !x.ok && !STEPS[i].soft; }).length;
say('\n=== 流水线结束：' + (results.length - fail) + ' 步成功 / ' + fail + ' 步失败 ===');
try {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  say('当前版本 v' + v);
  for (const f of ['dist/鸿汇影桌面版 Setup ' + v + '.exe', 'dist/鸿汇影桌面版 Setup ' + v + '.zip', 'dist/HongHubMovie.hap']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
      say('  ' + path.basename(p) + ' · ' + buf.length.toLocaleString('en-US') + ' B · sha256 ' + sha.slice(0, 16) + '…');
    }
  }
} catch (e) {}

/* 成功收尾：守护 dist 客户版别名=客户正式版（防止任何开发端打包残留污染别名）。
   失败收尾：回滚本次 bump，避免把源码留在「新版本 + 旧产物」的错位中间态。 */
if (fail) {
  rollbackBump();
} else {
  try {
    const g = spawnSync(process.execPath, [path.join(__dirname, 'guard-client-alias.js')],
      { cwd: ROOT, stdio: 'inherit', env: ENV });
    say('[别名守护] ' + (g.status === 0 ? 'dist 客户别名正常' : 'dist 客户别名守护未通过（exit=' + g.status + '）'));
  } catch (e) { say('[别名守护] 跳过：' + (e && e.message || e)); }
}
flush();
process.exit(hardFail ? 1 : 0);
