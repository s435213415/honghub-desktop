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
const os = require('os');
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
/* 备份绝不能放在 win-unpacked 里：免安装 zip 是整目录打包，放同目录会把开发端页面一起塞进客户包
   （实测 1.7.36 客户 zip 里就漏过 index.html.dev-backup / electron-main.js.dev-backup）。 */
const BAK_ROOT = path.join(os.tmpdir(), 'kh-client-backup-' + process.pid);
function bakPath(p) { return path.join(BAK_ROOT, path.relative(UNPACKED, p)); }
function backup(p) {
  const b = bakPath(p);
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.copyFileSync(p, b);
  return b;
}
function restore(p) {
  const b = bakPath(p);
  if (fs.existsSync(b)) { fs.copyFileSync(b, p); fs.unlinkSync(b); }
}
function assertBundledEndpoint(epPath) {
  let d;
  try { d = JSON.parse(fs.readFileSync(epPath, 'utf8')); }
  catch (e) { throw new Error('随包端点 JSON 解析失败'); }
  const base = String(d.baseUrl || '');
  if (!/^https:\/\//.test(base) || /127\.0\.0\.1|localhost|trycloudflare/i.test(base)) {
    throw new Error('随包端点仍是失效地址，拒绝打包: ' + base);
  }
  log('[校验] 随包端点 OK: ' + base + ' ' + (d.shareQuery || ''));
}

if (!fs.existsSync(UNPACKED)) { console.error('缺少 dist/win-unpacked'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

/* 跨进程 dist 出包锁：客户版打包会改写 win-unpacked 与 dist 别名，必须与自动发版
   及其他出包互斥。oneclick 调用时 owner 已继承 → 重入，不自锁。 */
let _lock = null;
try { _lock = require('./lib/dist-lock').acquire({ label: 'build-client' }); }
catch (e) { log('[dist-lock] 获取出包锁失败：' + (e && e.message || e)); process.exit(1); }
process.on('exit', function () { try { if (_lock) _lock.release(); } catch (e) {} });

// 0) win-unpacked 里的入口可能是旧版（昨晚打包的），先用当前源码同步，确保注入点存在
const srcEm = path.join(ROOT, 'electron-main.js');
const srcSv = path.join(ROOT, 'server', 'server.js');
const srcPage = path.join(ROOT, 'app', 'index.html');
const srcEp = path.join(ROOT, 'server', 'public-endpoint.json');
const dstEm = path.join(UNPACKED, 'resources', 'app', 'electron-main.js');
const dstSv = path.join(UNPACKED, 'resources', 'app', 'server', 'server.js');
const dstPage = path.join(UNPACKED, 'resources', 'app', 'app', 'index.html');
const dstEp = path.join(UNPACKED, 'resources', 'app', 'server', 'public-endpoint.json');
fs.copyFileSync(srcEm, dstEm);
fs.copyFileSync(srcSv, dstSv);
if (fs.existsSync(srcPage)) fs.copyFileSync(srcPage, dstPage);
// 随包端点必须同步：客户机没有 .env，只能读这份配置；旧值 127.0.0.1:8099 会让更新检查失效。
if (fs.existsSync(srcEp)) fs.copyFileSync(srcEp, dstEp);
log('[0/4] 已用当前源码同步 win-unpacked 入口（electron-main / server / app 页面 / 随包端点）');

const emPath = dstEm;
const pagePath = path.join(UNPACKED, 'resources', 'app', 'app', 'index.html');
const emBak = backup(emPath);
const pageBak = fs.existsSync(pagePath) ? backup(pagePath) : null;
// 开发端自更新模块不进客户包：客户版既不该检查更新，也不该看到任何开发态文件
const updPath = path.join(UNPACKED, 'resources', 'app', 'dev-auto-update.js');
const updBak = fs.existsSync(updPath) ? backup(updPath) : null;
if (updBak) fs.unlinkSync(updPath);

try {
  // 1) 净化入口
  let em = fs.readFileSync(emPath, 'utf8');
  const needle = 'const CLIENT_ONLY = false; // KH_BUILD_CLIENT_ONLY';
  if (!em.includes(needle)) throw new Error('electron-main.js 未找到注入点');
  fs.writeFileSync(emPath, em.replace(needle, 'const CLIENT_ONLY = true; // KH_BUILD_CLIENT_ONLY (CLIENT)'));
  log('[1/4] electron 入口已切客户版硬开关');

  if (pageBak) {
    let t = fs.readFileSync(pagePath, 'utf8');
    // 开发端专属 UI（运维看板入口等）整段剥离：标记内所有 /admin 入口、提示文字一并去掉
    t = t.replace(/\/\* KH_DEVUI_START \*\/[\s\S]*?\/\* KH_DEVUI_END \*\//g, '');
    t = t.replace("else mgr.onclick = function () { window.open('/admin', '_blank'); };",
                  "else mgr.onclick = function () { /* client: no admin */ };");
    t = t.replace("try { window.open('/admin', '_blank'); } catch (e) {}", "/* client: no admin */");
    t = t.replace("toast('运维项在「运维面板 /admin」里：审计 · 趋势 · 灰度 · 冒烟 · 告警');",
                  "toast('该项仅在开发端可用');");
    if (t.includes('/admin')) throw new Error('客户页面仍残留 /admin 入口，已中止打包');
    fs.writeFileSync(pagePath, t);
    log('[2/4] 页面 /admin 运维入口已整段剥离');
  }

  // 2) 先打免安装 zip（直接从净化的 win-unpacked 打，最快）
  const zipName = '鸿汇影免安装 ' + VER + '.zip';
  const zipPath = path.join(OUT, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (!fs.existsSync(SEVEN)) throw new Error('7za 不存在');
  const rz = spawnSync(SEVEN, ['a', '-tzip', '-mx=5', '-bso0', '-bsp0', zipPath, UNPACKED], { stdio: 'ignore' });
  if (rz.status !== 0 || !fs.existsSync(zipPath)) throw new Error('免安装 zip 打包失败');
  // 断言随包端点是正式站点，不再残留 127.0.0.1 / 隧道域名
  assertBundledEndpoint(dstEp);
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
    // 开发端安装版固定命名留存：客户版会覆盖同名 Setup，不留存就会丢开发端入口
    fs.copyFileSync(devSetupBak, path.join(DIST, '鸿汇影桌面版 开发端 ' + VER + '.exe'));
    fs.unlinkSync(devSetupBak);
    log('[4/4+] 开发端安装版已留存：鸿汇影桌面版 开发端 ' + VER + '.exe');
  }
  log('[4/4] 安装版: ' + setupName + ' · ' + fs.statSync(dest).size + ' B · ' + sha(dest).slice(0, 12));

  // 5) 把纯净版同步回 dist 根别名，供 maintain 体检 / ship-client 读取真实哈希。
  //    否则 electron-builder 还原后的旧哈希会让"发布校验"误报不一致。
  fs.copyFileSync(dest, path.join(DIST, 'desktop-setup.exe'));
  fs.copyFileSync(dest, path.join(DIST, setupName));
  fs.copyFileSync(zipPath, path.join(DIST, '鸿汇影桌面版 Setup ' + VER + '.zip'));
  log('[5/5] dist 根产物已同步为纯净版（体检/清单读真实哈希）');

  log('\n客户版产物目录: ' + OUT + '（dist 根别名亦为纯净版，与交付夹一致）');
} finally {
  // 4) 无论成败都恢复开发端入口
  restore(emPath);
  if (pageBak) restore(pagePath);
  if (updBak) restore(updPath);
  log('[恢复] win-unpacked 入口已还原为开发端版本');
}
