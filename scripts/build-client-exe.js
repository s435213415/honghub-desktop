#!/usr/bin/env node
'use strict';
/* 客户版纯净包构建（两份 exe 分离）
   思路：开发端 win-unpacked 是主产物。客户版通过「临时净化 -> 打包 -> 恢复」生成，
   输出到 dist/client/ 独立目录，绝不覆盖开发端产物。

   净化内容：
     - electron-main.js: CLIENT_ONLY = false -> true（客户版物理不认 --dev / dev-mode.flag）
     - app/index.html: 清除 /admin 死链
   服务端 server.js 靠 electron 传入的 KH_CLIENT_ONLY=1 硬锁，无需改文件。

   产物：dist/client/鸿汇影桌面版 Setup <ver>.exe（安装版）
         dist/client/鸿汇影免安装 <ver>.zip（免安装版）
   用法：node scripts/build-client-exe.js
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const UNPACKED = path.join(DIST, 'win-unpacked');
const OUT = path.join(DIST, 'client');
const CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
const SEVEN = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const log = (...a) => console.log(...a);

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function backup(p) { const b = p + '.dev-backup'; if (!fs.existsSync(b)) fs.copyFileSync(p, b); return b; }
function restore(p) { const b = p + '.dev-backup'; if (fs.existsSync(b)) { fs.copyFileSync(b, p); fs.unlinkSync(b); } }

if (!fs.existsSync(UNPACKED)) { console.error('缺少 dist/win-unpacked'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// 0) win-unpacked 里的入口可能是旧版（昨晚打包的），先用当前源码同步，确保注入点存在
const srcEm = path.join(ROOT, 'electron-main.js');
const srcSv = path.join(ROOT, 'server', 'server.js');
const srcPage = path.join(ROOT, 'app', 'index.html');
const dstEm = path.join(UNPACKED, 'resources', 'app', 'electron-main.js');
const dstSv = path.join(UNPACKED, 'resources', 'app', 'server', 'server.js');
const dstPage = path.join(UNPACKED, 'resources', 'app', 'app', 'index.html');
fs.copyFileSync(srcEm, dstEm);
fs.copyFileSync(srcSv, dstSv);
if (fs.existsSync(srcPage)) fs.copyFileSync(srcPage, dstPage);
log('[0/4] 已用当前源码同步 win-unpacked 入口（electron-main / server / app 页面）');

const emPath = dstEm;
const pagePath = path.join(UNPACKED, 'resources', 'app', 'app', 'index.html');
const emBak = backup(emPath);
const pageBak = fs.existsSync(pagePath) ? backup(pagePath) : null;

try {
  // 1) 净化入口
  let em = fs.readFileSync(emPath, 'utf8');
  const needle = 'const CLIENT_ONLY = false; // KH_BUILD_CLIENT_ONLY';
  if (!em.includes(needle)) throw new Error('electron-main.js 未找到注入点');
  fs.writeFileSync(emPath, em.replace(needle, 'const CLIENT_ONLY = true; // KH_BUILD_CLIENT_ONLY (CLIENT)'));
  log('[1/4] electron 入口已切客户版硬开关');

  if (pageBak) {
    let t = fs.readFileSync(pagePath, 'utf8');
    t = t.replace("else mgr.onclick = function () { window.open('/admin', '_blank'); };",
                  "else mgr.onclick = function () { /* client: no admin */ };");
    t = t.replace("try { window.open('/admin', '_blank'); } catch (e) {}", "/* client: no admin */");
    t = t.replace("toast('运维项在「运维面板 /admin」里：审计 · 趋势 · 灰度 · 冒烟 · 告警');",
                  "toast('该项仅在开发端可用');");
    fs.writeFileSync(pagePath, t);
    log('[2/4] 页面 /admin 死链已清除');
  }

  // 2) 先打免安装 zip（直接从净化的 win-unpacked 打，最快）
  const zipName = '鸿汇影免安装 ' + VER + '.zip';
  const zipPath = path.join(OUT, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (!fs.existsSync(SEVEN)) throw new Error('7za 不存在');
  const rz = spawnSync(SEVEN, ['a', '-tzip', '-mx=9', '-bso0', '-bsp0', zipPath, UNPACKED], { stdio: 'ignore' });
  if (rz.status !== 0 || !fs.existsSync(zipPath)) throw new Error('免安装 zip 打包失败');
  log('[3/4] 免安装包: ' + zipName + ' · ' + fs.statSync(zipPath).size + ' B · ' + sha(zipPath).slice(0, 12));

  // 3) 打安装版 Setup.exe：electron-builder 固定输出 dist/，先备份开发端产物，
  //    打包成功后先把客户版复制到 OUT，再把 dist/ 还原为开发端版
  const ENV = Object.assign({}, process.env, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  const setupName = '鸿汇影桌面版 Setup ' + VER + '.exe';
  const built = path.join(DIST, setupName);
  const devSetupBak = fs.existsSync(built) ? built + '.dev-backup' : null;
  if (devSetupBak) fs.copyFileSync(built, devSetupBak);
  const rs = spawnSync(process.execPath, [CLI, '--prepackaged', 'dist/win-unpacked'], {
    cwd: ROOT, env: ENV, stdio: 'inherit', timeout: 900000
  });
  if (rs.status !== 0) {
    if (devSetupBak && fs.existsSync(devSetupBak)) { fs.copyFileSync(devSetupBak, built); fs.unlinkSync(devSetupBak); }
    throw new Error('Setup 打包失败 exit=' + rs.status);
  }
  if (!fs.existsSync(built)) throw new Error('Setup 产物不存在');
  const dest = path.join(OUT, setupName);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.copyFileSync(built, dest);                    // 先存客户版
  if (devSetupBak && fs.existsSync(devSetupBak)) { // 再还原开发端
    fs.copyFileSync(devSetupBak, built);
    fs.unlinkSync(devSetupBak);
  }
  log('[4/4] 安装版: ' + setupName + ' · ' + fs.statSync(dest).size + ' B · ' + sha(dest).slice(0, 12));

  log('\n客户版产物目录: ' + OUT + '（dist/ 下的 Setup.exe 已还原为开发端版）');
} finally {
  // 4) 无论成败都恢复开发端入口
  restore(emPath);
  if (pageBak) restore(pagePath);
  log('[恢复] win-unpacked 入口已还原为开发端版本');
}
