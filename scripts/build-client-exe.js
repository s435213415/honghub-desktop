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
/* 1.7.80：支持出 arm64 客户纯净包。
   KH_CLIENT_ARCH=arm64 时指向 electron-builder 的 win-arm64-unpacked，
   产物名带 -arm64 后缀，与 x64 主产物并存；其余净化 / 签名逻辑完全共用。 */
const ARCH = String(process.env.KH_CLIENT_ARCH || 'x64').toLowerCase();
const UNPACKED = process.env.KH_UNPACKED
  ? path.resolve(process.env.KH_UNPACKED)
  : (ARCH === 'arm64' ? path.join(DIST, 'arch-arm64', 'win-arm64-unpacked') : path.join(DIST, 'win-unpacked'));
const OUT = path.join(DIST, 'client');
const SUFFIX = ARCH === 'arm64' ? '-arm64' : '';
const CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
const SEVEN = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const log = (...a) => console.log(...a);

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
/* 代码签名（1.7.80 接通）：交给 scripts/sign-windows.js 统一处理多目标。
   没有配置 WIN_CSC_FILE 时它写 skipped 并且 exit 0，绝不阻断出包；
   配了证书就必须在打 zip / 复制别名之前签完，因为签名会改字节。 */
function signFiles(targets, label) {
  const script = path.join(ROOT, 'scripts', 'sign-windows.js');
  if (!fs.existsSync(script)) { log('[签名] 缺少 scripts/sign-windows.js，跳过 ' + label); return; }
  const r = spawnSync(process.execPath, [script], {
    cwd: ROOT, stdio: 'inherit', timeout: 300000,
    env: Object.assign({}, process.env, { WIN_CSC_TARGETS: targets.join(';') })
  });
  if (r.status !== 0) log('[签名] ' + label + ' 签名脚本返回 ' + r.status + '（不阻断，报告见 dist/codesign.json）');
}
const { stripDevArtifacts } = require('./lib/client-strip');
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
  try {
    /* 1.7.83：某些编辑器/脚本会把 UTF-8 BOM 写进这份配置，JSON.parse 会直接报
       Unexpected token，进而让出包卡在最后一步。这里先剥 BOM，别让编码问题装成配置错误。 */
    d = JSON.parse(fs.readFileSync(epPath, 'utf8').replace(/^\uFEFF/, ''));
  }
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
const srcPre = path.join(ROOT, 'preload.js');
const dstEm = path.join(UNPACKED, 'resources', 'app', 'electron-main.js');
const dstSv = path.join(UNPACKED, 'resources', 'app', 'server', 'server.js');
const dstPage = path.join(UNPACKED, 'resources', 'app', 'app', 'index.html');
const dstEp = path.join(UNPACKED, 'resources', 'app', 'server', 'public-endpoint.json');
const dstPre = path.join(UNPACKED, 'resources', 'app', 'preload.js');
fs.copyFileSync(srcEm, dstEm);
fs.copyFileSync(srcSv, dstSv);
if (fs.existsSync(srcPage)) fs.copyFileSync(srcPage, dstPage);
/* 前端已模块化（1.7.72）：壳页通过 <script src="kh-*.js"> 加载脚本，
   只拷 index.html 会让客户包白屏 —— 页面引用的外链脚本必须一起同步进包。 */
const srcAppDir = path.join(ROOT, 'app');
const dstAppDir = path.join(UNPACKED, 'resources', 'app', 'app');
const pageScripts = Array.from(fs.readFileSync(srcPage, 'utf8').matchAll(/<script[^>]*?src="([^"]+)"[^>]*?>\s*<\/script>/g)).map(m => m[1]);
for (const rel of pageScripts) {
  if (/^(http|\/\/)/i.test(rel)) continue;
  const f = path.join(srcAppDir, rel);
  if (!fs.existsSync(f)) throw new Error('页面引用的脚本缺失，无法出包：' + rel);
  fs.mkdirSync(path.dirname(path.join(dstAppDir, rel)), { recursive: true });
  fs.copyFileSync(f, path.join(dstAppDir, rel));
}
if (pageScripts.length) log('[0/4] 已同步页面外链脚本 ' + pageScripts.length + ' 个：' + pageScripts.join(', '));
if (fs.existsSync(srcPre)) fs.copyFileSync(srcPre, dstPre);
/* 图标资源必须同步：托盘（Tray）与窗口都从包内 assets 读图标，
   不同步就会出现「exe 图标新、托盘还是旧图」的不一致。 */
const assetsSrc = path.join(ROOT, 'assets');
const assetsDst = path.join(UNPACKED, 'resources', 'app', 'assets');
for (const name of ['icon.ico', 'icon.png']) {
  const f = path.join(assetsSrc, name);
  if (!fs.existsSync(f)) throw new Error('图标资源缺失，无法出包：' + name);
  fs.mkdirSync(assetsDst, { recursive: true });
  fs.copyFileSync(f, path.join(assetsDst, name));
}
log('[0/4] 已同步包内图标资源（assets/icon.ico · icon.png）');
// 随包端点必须同步：客户机没有 .env，只能读这份配置；旧值 127.0.0.1:8099 会让更新检查失效。
if (fs.existsSync(srcEp)) fs.copyFileSync(srcEp, dstEp);

/* exe 图标固化：signAndEditExecutable=false 使 electron-builder 不写 exe 资源段，
   不补这一步 exe 会静默退回 Electron 默认图标。脚本幂等，重复执行无副作用。 */
const patch = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'patch-exe-icon.js'), '--exe', path.join(UNPACKED, '鸿汇影桌面版.exe')], { stdio: 'inherit' });
if (patch.status !== 0) throw new Error('exe 图标固化失败（scripts/patch-exe-icon.js）');
/* 包内 package.json 的 version 也是「客户看到的版本」：win-unpacked 是上一轮打的，
   不同步就会让包内声明落后（verify-release 会判「包内 package.json.version ≠ 发版」）。
   只改 version 字段，其他键（main / 依赖）保持打包时的原样。 */
try {
  const pjPath = path.join(UNPACKED, 'resources', 'app', 'package.json');
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  if (pj.version !== VER) { pj.version = VER; fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n'); log('[0/4+] 包内 package.json.version 已对齐 ' + VER); }
} catch (e) { throw new Error('包内 package.json 版本对齐失败：' + (e && e.message)); }
log('[0/4] 已用当前源码同步 win-unpacked 入口（electron-main / preload / server / app 页面 / 随包端点）');

const emPath = dstEm;
const pagePath = path.join(UNPACKED, 'resources', 'app', 'app', 'index.html');
const emBak = backup(emPath);
const pageBak = fs.existsSync(pagePath) ? backup(pagePath) : null;
let pageScriptBaks = []; // 外链脚本的净化前备份（finally 里逐份还原）
// 开发端自更新模块不进客户包：客户版既不该检查更新，也不该看到任何开发态文件
const updPath = path.join(UNPACKED, 'resources', 'app', 'dev-auto-update.js');
const updBak = fs.existsSync(updPath) ? backup(updPath) : null;
if (updBak) fs.unlinkSync(updPath);

/* 1.7.83：12 个 *-admin.html 现在是开发端安装包的正式内容（以前被 package.json 的
   「!server/*-admin.html」整条排除，开发端运维台 12 个入口点进去全是 404）。
   客户包仍必须剥离，所以先读进内存，stripDevArtifacts 删完、打包结束再写回。 */
const serverDirPacked = path.join(UNPACKED, 'resources', 'app', 'server');
const adminBaks = [];
try {
  for (const f of fs.readdirSync(serverDirPacked)) {
    if (/-admin\.html$/.test(f)) adminBaks.push({ name: f, buf: fs.readFileSync(path.join(serverDirPacked, f)) });
  }
} catch (e) { log('[警告] 运维页暂存失败：' + (e && e.message || e)); }
if (adminBaks.length) log('[0/5] 已暂存 ' + adminBaks.length + ' 个运维页（客户包剥离，结束后还原开发端）');

// 0.5) 剥离开发端静态面板与 data 历史痕迹（只作用于本次打包的 win-unpacked，仓库源码不动）
stripDevArtifacts(path.join(UNPACKED, 'resources', 'app', 'server'), log);

try {
  // 1) 净化入口
  let em = fs.readFileSync(emPath, 'utf8');
  const needle = 'const CLIENT_ONLY = false; // KH_BUILD_CLIENT_ONLY';
  if (!em.includes(needle)) throw new Error('electron-main.js 未找到注入点');
  fs.writeFileSync(emPath, em.replace(needle, 'const CLIENT_ONLY = true; // KH_BUILD_CLIENT_ONLY (CLIENT)'));
  log('[1/4] electron 入口已切客户版硬开关');

  /* 净化函数：客户版页面及其外链脚本都不能出现 /admin 运维入口。
     模块化后 UI 片段（含 KH_DEVUI 块与 mgr.onclick）在 kh-*.js 里，只净化壳页会漏进客户包。 */
  const purgeClientUi = (t) => t
    .replace(/\/\* KH_DEVUI_START \*\/[\s\S]*?\/\* KH_DEVUI_END \*\//g, '')
    .replace("else mgr.onclick = function () { window.open('/admin', '_blank'); };",
             "else mgr.onclick = function () { /* client: no admin */ };")
    .replace("try { window.open('/admin', '_blank'); } catch (e) {}", "/* client: no admin */")
    .replace("toast('运维项在「运维面板 /admin」里：审计 · 趋势 · 灰度 · 冒烟 · 告警');",
             "toast('该项仅在开发端可用')");

  const pageTargets = [];
  if (pageBak) pageTargets.push(pagePath);
  for (const rel of pageScripts) pageTargets.push(path.join(dstAppDir, rel));
  pageScriptBaks = pageTargets.map((p) => ({ path: p, bak: fs.existsSync(p) ? backup(p) : null }));
  let purged = 0, devuiBlocks = 0;
  for (const p of pageTargets) {
    let t = fs.readFileSync(p, 'utf8');
    const before = t;
    const hit = (before.match(/KH_DEVUI_START/g) || []).length;
    t = purgeClientUi(t);
    if (t.includes('/admin')) throw new Error(path.basename(p) + ' 仍残留 /admin 入口，已中止打包');
    if (t !== before) { fs.writeFileSync(p, t); purged++; devuiBlocks += hit; }
  }
  log('[2/4] 客户版 UI 净化完成：处理 ' + pageTargets.length + ' 个页面/脚本文件，改动 ' + purged +
    ' 个，剥离开发端 UI 段 ' + devuiBlocks + ' 处');

  // 2) 主程序先签名，再打免安装 zip：否则 zip 里躺的是未签名 exe，解压后照样被 SmartScreen 拦。
  //    未配置证书时 scripts/sign-windows.js 自己写 skipped 且不阻断，报告见 dist/codesign.json。
  signFiles([path.join(UNPACKED, '鸿汇影桌面版.exe')], '免安装主程序');

  // 2) 先打免安装 zip（直接从净化的 win-unpacked 打，最快）
  const zipName = '鸿汇影免安装 ' + VER + SUFFIX + '.zip';
  const zipPath = path.join(OUT, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (!fs.existsSync(SEVEN)) throw new Error('7za 不存在');
  /* 1.7.82：免安装 zip 里的顶层目录改成用户看得懂的名字（以前 arm64 那份解压出来叫
     win-arm64-unpacked，客户以为是残包）。做法是打 zip 前临时改名、打完立刻改回。 */
  const niceRoot = path.join(path.dirname(UNPACKED), '鸿汇影桌面版 ' + VER + SUFFIX);
  let zipRoot = UNPACKED;
  try {
    if (fs.existsSync(niceRoot)) fs.rmSync(niceRoot, { recursive: true, force: true });
    /* 1.7.83：electron-builder 刚退出时目录句柄可能还没释放，rename 会偶发 EPERM。
       以前一次失败就退化成 win-unpacked 顶层名，所以重试 5 次（每次等 1.2 秒）。 */
    let lastErr = null;
    for (let i = 0; i < 5; i++) {
      try { fs.renameSync(UNPACKED, niceRoot); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        if (i < 4) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
      }
    }
    if (lastErr) throw lastErr;
    zipRoot = niceRoot;
  } catch (e) {
    log('[警告] 临时改名失败，zip 顶层目录名仍为 ' + path.basename(UNPACKED) + '：' + (e && e.message));
    zipRoot = UNPACKED;
  }
  let rz;
  try {
    rz = spawnSync(SEVEN, ['a', '-tzip', '-mx=5', '-bso0', '-bsp0', zipPath, zipRoot], { stdio: 'ignore' });
  } finally {
    if (zipRoot !== UNPACKED) {
      try { fs.renameSync(zipRoot, UNPACKED); } catch (e) { throw new Error('zip 打完改名回原失败：' + (e && e.message)); }
    }
  }
  if (rz.status !== 0 || !fs.existsSync(zipPath)) throw new Error('免安装 zip 打包失败');
  // 断言随包端点是正式站点，不再残留 127.0.0.1 / 隧道域名
  assertBundledEndpoint(dstEp);
  log('[3/4] 免安装包: ' + zipName + ' · ' + fs.statSync(zipPath).size + ' B · ' + sha(zipPath).slice(0, 12));

  // 3) 打安装版 Setup.exe：electron-builder 固定输出 dist/，先备份开发端产物，
  //    打包成功后先把客户版复制到 OUT，再把 dist/ 还原为开发端版
  const ENV = Object.assign({}, process.env, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  const setupName = '鸿汇影桌面版 Setup ' + VER + SUFFIX + '.exe';
  const built = path.join(DIST, setupName);
  const devSetupBak = fs.existsSync(built) ? built + '.dev-backup' : null;
  if (devSetupBak) fs.copyFileSync(built, devSetupBak);
  /* prepackaged 模式必须显式指定目标架构，否则 electron-builder 会按 package.json
     里的默认 x64 出力：arm64 的目录会被打成标着 x64 的包，还因为文件名相同覆盖掉
     x64 客户版。artifactName 也一并显式给，保证带 -arm64 后缀不撞名。 */
  const artTpl = '鸿汇影桌面版 Setup ${version}' + SUFFIX + '.${ext}';
  const rs = spawnSync(process.execPath, [CLI, '--prepackaged', UNPACKED.replace(/\\/g, '/'),
    '--' + ARCH, '-c.win.artifactName=' + artTpl], {
    cwd: ROOT, env: ENV, stdio: 'inherit', timeout: 900000
  });
  if (rs.status !== 0) {
    if (devSetupBak && fs.existsSync(devSetupBak)) { fs.copyFileSync(devSetupBak, built); fs.unlinkSync(devSetupBak); }
    throw new Error('Setup 打包失败 exit=' + rs.status);
  }
  if (!fs.existsSync(built)) {
    // 产物名兜底：electron-builder 对中文 productName 偶有改写，按版本+后缀找最新 exe
    const cands = fs.readdirSync(DIST).filter((f) => f.endsWith('.exe') && f.includes(VER) && f.includes(SUFFIX) &&
      (SUFFIX || !f.includes('-arm64')))
      .map((f) => ({ f, m: fs.statSync(path.join(DIST, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (cands.length && fs.existsSync(path.join(DIST, cands[0].f))) {
      fs.renameSync(path.join(DIST, cands[0].f), built);
      log('[4/4] 产物名兜底命中：' + cands[0].f + ' → ' + setupName);
    }
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
  signFiles([dest], '客户版安装包');
  log('[4/4] 安装版: ' + setupName + ' · ' + fs.statSync(dest).size + ' B · ' + sha(dest).slice(0, 12));

  // 5) 把纯净版同步回 dist 根别名，供 maintain 体检 / ship-client 读取真实哈希。
  //    否则 electron-builder 还原后的旧哈希会让"发布校验"误报不一致。
  /* desktop-setup.exe 是 x64 专属别名（服务端下载直链与 verify 都认它），
     arm64 只同步带后缀的文件，绝不能覆盖 x64 别名。 */
  if (ARCH === 'x64') fs.copyFileSync(dest, path.join(DIST, 'desktop-setup.exe'));
  fs.copyFileSync(dest, path.join(DIST, setupName));
  fs.copyFileSync(zipPath, path.join(DIST, '鸿汇影桌面版 Setup ' + VER + SUFFIX + '.zip'));
  log('[5/5] dist 根产物已同步为纯净版（体检/清单读真实哈希）');

  log('\n客户版产物目录: ' + OUT + '（dist 根别名亦为纯净版，与交付夹一致）');
} finally {
  // 4) 无论成败都恢复开发端入口
  restore(emPath);
  if (pageBak) restore(pagePath);
  for (const it of pageScriptBaks) if (it.bak) restore(it.path);
  if (updBak) restore(updPath);
  /* 运维页还原：客户包已剥离，开发端目录必须补齐，否则打一次客户包就把开发端运维台弄残 */
  for (const it of adminBaks) {
    try { fs.writeFileSync(path.join(serverDirPacked, it.name), it.buf); } catch (e) { log('[警告] 运维页还原失败：' + it.name + ' · ' + (e && e.message)); }
  }
  if (adminBaks.length) log('[恢复] 运维页已还原 ' + adminBaks.length + ' 个');
  log('[恢复] win-unpacked 入口已还原为开发端版本');
}
