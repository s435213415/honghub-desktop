#!/usr/bin/env node
'use strict';
/* 一键出包（npm run pack）：
   0 发版（版本随产物递增）→ 1 打包前自检 → 2 electron-builder --dir
   → 3 手动 rcedit 写图标/版本 + 内置开鸿更新包 → 4 electron-builder --prepackaged
   → 5 同步自动更新下载产物与校验清单 → 6 交付到桌面
   第 3 步必须在 --dir 之后、--prepackaged 之前：构建流水线自身持有 exe 句柄，
   期内 rcedit 会失败；目录生成完毕后由本进程单独调用则稳定成功。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
const DIST = path.join(ROOT, 'dist');
const APP_EXE = path.join(DIST, 'win-unpacked', '鸿汇影桌面版.exe');
const ICO = path.join(ROOT, 'assets', 'icon.ico');
const UPDATES = path.join(DIST, 'win-unpacked', 'resources', 'app', 'updates');
// 第 0 步 release.js 会按发版结果更新 package.json.version，因此不能在模块加载时缓存，
// 必须在写图标 / 交付时重新读，否则 SETUP 会指向旧版本文件名。
function pkgVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

const ENV = Object.assign({}, process.env, {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/'
});

/* .env 自动装载：签名口令 OH_KEY_PWD 平时躺在深开鸿工程里，这里统一捞进来，
   出包不再需要人手先 export 一遍（旧行为：忘了注入就直接中止在 HAP 签名）。 */
require('./lib/env').apply();
for (const k of ['OH_KEY_PWD', 'KH_RELEASE_BUMP', 'KH_ALLOW_STALE_HAP', 'PYTHON_BIN', 'KH_HDC', 'KH_DEPLOY_CMD']) {
  if (process.env[k] !== undefined && ENV[k] === undefined) ENV[k] = process.env[k];
}
/* 版本只推一次：--no-bump 或 KH_RELEASE_BUMP=0 时，第 0 步只对齐版本不递增。
   双推（先 version.js --bump 再出包）会把版本号顶高一级，出包前请二选一。 */
if (process.argv.includes('--no-bump')) { ENV.KH_RELEASE_BUMP = '0'; console.log('  [版本] --no-bump：本次不递增版本'); }

function step(label, script, args) {
  console.log('\n=== ' + label + ' ===');
  const r = spawnSync(process.execPath, [script].concat(args || []), { cwd: ROOT, stdio: 'inherit', env: ENV });
  if (r.status !== 0) {
    console.error(label + ' 失败（exit=' + r.status + '），已中止。');
    process.exit(r.status || 1);
  }
}

function findRcedit() {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    const p = path.join(base, d, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function writeIcon(exe) {
  console.log('\n=== 3/6 写入主程序图标与版本信息 ===');
  if (!fs.existsSync(exe)) { console.warn('  未找到主程序 exe，跳过'); return; }
  const tool = findRcedit();
  if (!tool) { console.warn('  未找到 rcedit，跳过（不影响功能）'); return; }
  const VERSION = pkgVersion();
  const args = [
    '--set-icon', ICO,
    '--set-version-string', 'FileDescription', '鸿汇影桌面版',
    '--set-version-string', 'ProductName', '鸿汇影桌面版',
    '--set-version-string', 'CompanyName', 'HongHub',
    '--set-version-string', 'FileVersion', VERSION,
    '--set-version-string', 'ProductVersion', VERSION
  ];
  // electron-builder --dir 刚退出时 exe 句柄可能尚未释放，rcedit 会报 Unable to commit changes。
  // 等待 + 重试；仍失败则对临时副本写入后替换，避免占用问题。
  for (let i = 1; i <= 4; i++) {
    if (i > 1) { sleep(1500); console.log('  第 ' + i + ' 次尝试…'); }
    const r = spawnSync(tool, [exe].concat(args), { cwd: ROOT, stdio: i === 1 ? 'inherit' : 'pipe' });
    if (r.status === 0) { console.log('  图标与版本信息写入成功'); return; }
  }
  const tmp = exe + '.tmp';
  try {
    fs.copyFileSync(exe, tmp);
    const r = spawnSync(tool, [tmp].concat(args), { cwd: ROOT, stdio: 'pipe' });
    if (r.status === 0) {
      fs.copyFileSync(tmp, exe);
      fs.unlinkSync(tmp);
      console.log('  图标与版本信息写入成功（临时副本方式）');
      return;
    }
    fs.unlinkSync(tmp);
  } catch (e) { /* 落到警告 */ }
  console.warn('  图标写入失败，不影响功能，继续出包');
}

function stageUpdates() {
  console.log('\n=== 3.5/6 内置开鸿端更新包与发版清单 ===');
  // 只认本次 hap-sign.js 刚签出的 dist 产物；桌面旧包仅作最后兜底（doctor 会报新鲜度）
  const src = [
    path.join(DIST, 'honghub-harmony.hap'),
    path.join(os.homedir(), 'Desktop', 'HongHubMovie.hap')
  ].find(p => fs.existsSync(p));
  fs.mkdirSync(UPDATES, { recursive: true });
  if (src) {
    // 只放一份（服务端 /download/ 会把两个别名都解析到它），避免重复占体积
    const buf = fs.readFileSync(src);
    fs.writeFileSync(path.join(UPDATES, 'honghub-harmony.hap'), buf);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    fs.writeFileSync(path.join(UPDATES, 'HongHubMovie.hap.sha256'), sha + '  HongHubMovie.hap\n');
    fs.writeFileSync(path.join(UPDATES, 'honghub-harmony.hap.sha256'), sha + '  honghub-harmony.hap\n');
    console.log('  已内置 HAP ' + buf.length + ' B · sha256 ' + sha.slice(0, 16) + '…');
  } else {
    console.warn('  未找到已签名 HAP，跳过（不影响桌面端）');
  }
  // 先写一份基础版 release.json 进入安装包；postpack 会用带产物校验的完整版覆盖
  let rel = {};
  try { rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release || {}; } catch (e) {}
  fs.writeFileSync(path.join(UPDATES, 'release.json'), JSON.stringify({
    schema: 1,
    versionName: rel.latest && rel.latest.versionName,
    versionCode: rel.latest && rel.latest.versionCode,
    publishedAt: rel.latest && rel.latest.publishedAt,
    artifacts: { desktop: null, hap: src ? { file: 'honghub-harmony.hap' } : null }
  }, null, 2) + '\n');
  // 内置「不限设备 / 不限内存」下发清单：精简环境没有 dist/ 时服务端也能给出可用通道与自动更新策略
  try {
    // 先生成 OS 版本适配矩阵，让随包内置的清单也覆盖所有操作系统版本
    require(path.join(ROOT, 'server', 'device-optimizer.js')).run();
    const dp = require(path.join(ROOT, 'server', 'delivery-plan.js'));
    const snap = {
      versionName: rel.latest && rel.latest.versionName,
      versionCode: rel.latest && rel.latest.versionCode,
      archs: {},
      hap: src ? { status: 'ready', file: 'honghub-harmony.hap', url: '/download/honghub-harmony.hap' } : null,
      features: null
    };
    fs.writeFileSync(path.join(UPDATES, 'delivery.json'), JSON.stringify(dp.buildDelivery(snap), null, 2) + '\n');
    console.log('  已内置下发成品清单（3 通道 / 4 内存档 / 自动更新策略）');
  } catch (e) { console.warn('  下发清单内置跳过：' + (e && e.message || e)); }
}

// 瘦身说明：本机安全策略禁止单轮批量删除 50+ 文件，electron-builder 的语言包清理会因此中止构建。
// 因此不删语言包，改用零删除的瘦身方式：dist 内重复安装包用硬链接（省 ~77MB）、
// updates 只内置一份 HAP、NSIS 最大压缩。这里仅报告体积构成。
function slimLocales() {
  const dir = path.join(DIST, 'win-unpacked', 'locales');
  if (!fs.existsSync(dir)) return;
  const all = fs.readdirSync(dir);
  console.log('  语言包 ' + all.length + ' 个保留原状（避免触发批量删除保护）');
}

// 深开鸿端与桌面端共用同一份前端源，发版后必须重生成，保证两端版本一致
function buildHapFrontend() {
  console.log('\n=== 0.5/6 重生成深开鸿端前端 ===');
  const r = spawnSync(process.env.PYTHON_BIN || 'python', ['harmony/build_hap.py'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) console.warn('  HAP 前端生成失败（不影响桌面端，稍后可手动重跑）');
}
// 发版后同步「良好页面快照」：自动修 Bug 恢复页面时用的副本必须与本次版本一致，
// 否则会在修 Bug 时把新版本页面回退到上一版。
function stageSnapshots() {
  const dir = path.join(ROOT, 'server', 'data', 'snapshots');
  const pairs = [
    ['app.html', path.join(ROOT, 'app', 'index.html')],
    ['harmony.html', path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www', 'index.html')]
  ];
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const pair of pairs) {
    if (fs.existsSync(pair[1])) { fs.copyFileSync(pair[1], path.join(dir, pair[0])); n += 1; }
  }
  console.log('  良好页面快照已随 v' + pkgVersion() + ' 发版刷新（' + n + ' 份）');
}
// 深开鸿端与桌面端共用同一份前端源；签名链已纳管到项目内 harmony/signing/，
// 不再依赖桌面「新建文件夹 (6)」这类临时目录。
// 铁律：签名失败必须中止发版 —— 否则版本号升了、HAP 却是旧的，验收会因「hash 重算一致」而蒙混过关。
function signHapPackage() {
  console.log('\n=== 0.8/6 注入并签名深开鸿 HAP（项目内自包含签名链）===');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'hap-sign.js')],
    { cwd: ROOT, stdio: 'inherit', env: ENV });
  if (r.status === 0) return;
  if (process.env.KH_ALLOW_STALE_HAP === '1') {
    console.warn('  HAP 签名失败，但已显式设置 KH_ALLOW_STALE_HAP=1：本次 HAP 可能是旧版本！');
    return;
  }
  console.error('  HAP 签名链失败，已中止发版（不允许用旧 HAP 冒充新版本）。');
  console.error('  排查：npm run doctor；修复：npm run signing:setup。确需临时沿用旧包请设 KH_ALLOW_STALE_HAP=1。');
  process.exit(r.status || 1);
}

/* 免安装包：过去是手工用 .NET ZipFile 打的，命名还和 ship-client 的匹配规则对不上
   （发布脚本只认「鸿汇影桌面版 Setup *.zip」），差点漏发。这里并入流水线自动生成。 */
function buildPortableZip() {
  console.log('\n=== 5.2/6 生成免安装包 ===');
  if (process.argv.includes('--skip-zip')) { console.log('  --skip-zip：跳过免安装包（由一键流水线统一补打）'); return; }
  const ver = pkgVersion();
  const unpacked = path.join(DIST, 'win-unpacked');
  const zip = path.join(DIST, '鸿汇影桌面版 Setup ' + ver + '.zip');
  if (!fs.existsSync(unpacked)) { console.warn('  win-unpacked 不存在，跳过免安装包'); return; }
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  let ok = false;
  // 本机 PATH 里没有 tar，也没有 powershell（node 直接 spawn 会 ENOENT），
  // 但 electron-builder 自带 7za，调它最稳，且不需要任何系统组件。
  const seven = [
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'ia32', '7za.exe')
  ].find((p) => fs.existsSync(p));
  if (seven) {
    const r = spawnSync(seven, ['a', '-tzip', '-mx=5', '-bso0', '-bsp0', zip, unpacked], { stdio: 'ignore' });
    ok = r.status === 0;
  }
  if (!ok) {   // 兜底：用系统自带 Windows PowerShell 绝对路径 + .NET ZipFile
    const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const ps = 'Add-Type -AssemblyName System.IO.Compression.FileSystem; ' +
      '[System.IO.Compression.ZipFile]::CreateFromDirectory(' + q(unpacked) + ',' + q(zip) +
      ',[System.IO.Compression.CompressionLevel]::Optimal,$false)';
    if (fs.existsSync(psExe)) {
      const r = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
      ok = r.status === 0;
    }
  }
  if (!ok || !fs.existsSync(zip)) { console.warn('  免安装包生成失败'); return; }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  console.log('  ' + path.basename(zip) + ' · ' + fs.statSync(zip).size + ' B · ' + sha.slice(0, 12) + '…');
}

function deliver() {
  console.log('\n=== 6/6 交付到桌面 ===');
  const desktop = path.join(os.homedir(), 'Desktop');
  if (!fs.existsSync(desktop)) { console.warn('  桌面目录不存在，跳过'); return; }
  /* 桌面根只交付「开发端安装版」，客户硬锁版只进「客户成品」夹：
     同名两份 Setup 摆在桌面，最容易把硬锁版误发给客户 / 把开发端当成客户版。 */
  const DEV_SETUP = path.join(DIST, '鸿汇影桌面版 开发端 ' + pkgVersion() + '.exe');
  const SETUP = path.join(DIST, '鸿汇影桌面版 Setup ' + pkgVersion() + '.exe');
  const source = fs.existsSync(DEV_SETUP) ? DEV_SETUP : SETUP;
  if (fs.existsSync(source)) {
    // 桌面已按「开发端夹 / 客户成品夹」归拢时，安装包直接进开发端夹，桌面根不再堆平铺文件
    const devDir = path.join(desktop, '鸿汇影·开发端_v' + pkgVersion());
    fs.mkdirSync(devDir, { recursive: true }); // 新版本首次交付自动建夹，避免平铺到桌面根
    const target = path.join(devDir, path.basename(source));
    fs.copyFileSync(source, target);
    console.log('  ' + target + ' (' + fs.statSync(target).size + ' B)' + (source === DEV_SETUP ? ' · 开发端版' : ' · 客户版（未找到开发端安装版）'));
  } else console.warn('  安装包不存在，跳过');
  const hap = path.join(DIST, 'honghub-harmony.hap');
  if (fs.existsSync(hap)) {
    const cliDir = path.join(desktop, '鸿汇影·客户成品_v' + pkgVersion());
    fs.mkdirSync(cliDir, { recursive: true });
    const target = path.join(cliDir, 'HongHubMovie.hap');
    fs.copyFileSync(hap, target);
    console.log('  ' + target + ' (' + fs.statSync(target).size + ' B)');
  }
}

const vBefore = pkgVersion();
step('0/6 发版', path.join(__dirname, 'release.js'));
console.log('  [版本] ' + vBefore + ' → ' + pkgVersion());
buildHapFrontend();
signHapPackage();
stageSnapshots();
step('1/6 打包前自检', path.join(__dirname, 'prebuild-check.js'));
step('2/6 生成应用目录', CLI, ['--dir']);
writeIcon(APP_EXE);
stageUpdates();
slimLocales();
step('4/6 生成安装包', CLI, ['--prepackaged', 'dist/win-unpacked']);
// 签名会改 exe 字节，必须在 postpack 重算 sha256 之前执行；缺证书时脚本自行 SKIP
step('4.5/6 Windows 代码签名（可选）', path.join(__dirname, 'sign-windows.js'));
step('5/6 同步产物与校验清单', path.join(__dirname, 'postpack.js'));
buildPortableZip();
step('5.5/6 自动生成批量下发与不限设备/内存清单', path.join(__dirname, 'build-archs.js'));
step('5.6/6 版本归档与可回滚索引', path.join(__dirname, 'archive-release.js'));
step('5.7/6 依赖审计与 SBOM', path.join(__dirname, 'sbom.js'));
step('5.8/6 公网分发（未配置凭证时自动跳过）', path.join(__dirname, 'publish-remote.js'));
step('5.9/6 开发端交付脚本（turn flag / BOM-free 启动 / 桌面快捷方式）', path.join(__dirname, 'build-dev-package.js'));
deliver();
console.log('\n构建完成');
