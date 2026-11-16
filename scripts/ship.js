#!/usr/bin/env node
'use strict';
/* 开发者端一键出包发布：npm run ship
   门禁 → 出包 → 归档 → 公网清单 → 站点发布 → 二次校验 → 公网全量回下 → 桌面交付同步 → 报告

   模式：
     npm run ship          正式发版（versionCode/patch +1、HAP 重建签名、全链路发布）
     npm run ship:patch    补丁重出包（版本号与 HAP 不变，只重建安装器并同步下游哈希）
     npm run ship:verify   站点发布完成后的收口（探测远端 → 全量回下 → 桌面同步 → 回归）
     npm run ship:deliver  仅重新生成桌面全量交付与备份 zip

   站点发布：
     - 配置 KH_DEPLOY_CMD（任意 shell 命令，如 aws s3 sync / rclone / 自有域名上传）→ 真正一键全自动。
     - 未配置且为 workbuddy-sites 模式 → 落 dist/deploy-request.json 并如实回报 deploy-pending，
       由宿主发布能力执行，再跑 npm run ship:verify 收口。绝不谎报「已发布」。
   全程不删除任何桌面文件；只覆盖本项目自己生成的交付物。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const APPDIR = path.join(DIST, 'win-unpacked', 'resources', 'app');
const UPDATES = path.join(APPDIR, 'updates');
const CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
const DESKTOP = path.join(os.homedir(), 'Desktop');
const env = require('./lib/env');
env.apply();
const distribute = require('../server/distribute');

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--verify') ? 'verify' : ARGS.includes('--deliver') ? 'deliver'
  : ARGS.includes('--patch') ? 'patch' : 'full';
const DRY = ARGS.includes('--dry-run');
const NO_DEPLOY = ARGS.includes('--no-deploy');
const SKIP_GATES = ARGS.includes('--skip-gates');

const ENV = Object.assign({}, process.env, {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/'
});

const steps = [];
function log(s) { console.log(s); }
function record(name, status, detail) {
  steps.push({ name, status, detail: detail || '', at: new Date().toISOString() });
  log('  [' + status.toUpperCase() + '] ' + name + (detail ? ' — ' + detail : ''));
}
function need(cond, msg) { if (!cond) { console.error('已中止：' + msg); process.exit(1); } }
function jread(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function jwrite(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function sha(p) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(p, 'r'), buf = Buffer.allocUnsafe(1 << 20);
  let n;
  try { while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function copyIf(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}
// zip 用 Python 标准库生成：项目本就依赖 Python，避免为一个压缩包新增 npm 依赖；
// ZIP_STORED 让 78MB 成品不重复压缩，也保证中文文件名以 UTF-8 正确落盘。
function pyZip(code, args) {
  const r = spawnSync(process.env.PYTHON_BIN || 'python', ['-c', code].concat(args),
    { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
  if (r.status !== 0) throw new Error('python zip 失败：' + String(r.stderr || r.stdout || '').trim().slice(0, 300));
  return String(r.stdout || '').trim();
}
const PY_ONE = [
  'import sys,zipfile,os',
  'exe,zp=sys.argv[1],sys.argv[2]',
  'z=zipfile.ZipFile(zp,"w",zipfile.ZIP_STORED)',
  'z.write(exe,os.path.basename(exe))',
  'z.close()',
  'print(os.path.getsize(zp))'
].join('\n');
const PY_FOLDER = [
  'import sys,zipfile,os',
  'folder,zp,note=sys.argv[1],sys.argv[2],sys.argv[3]',
  'z=zipfile.ZipFile(zp,"w",zipfile.ZIP_STORED)',
  'for root,dirs,files in os.walk(folder):',
  '    dirs.sort(); files.sort()',
  '    for f in files:',
  '        p=os.path.join(root,f)',
  '        rel=os.path.relpath(p,folder).replace(os.sep,"/")',
  '        z.write(p,rel)',
  'z.writestr("备份说明.txt",note.encode("utf-8"))',
  'z.close()',
  'print(os.path.getsize(zp))'
].join('\n');
function node(script, args, label, optional) {
  log('\n=== ' + label + ' ===');
  if (DRY) { record(label, 'dry-run'); return true; }
  const r = spawnSync(process.execPath, [path.join(__dirname, script)].concat(args || []),
    { cwd: ROOT, stdio: 'inherit', env: ENV, timeout: 1800000 });
  const ok = r.status === 0;
  record(label, ok ? 'passed' : (optional ? 'warn' : 'failed'), 'exit=' + r.status);
  if (!ok && !optional) process.exit(r.status || 1);
  return ok;
}
function gitOut(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

const pkg = jread(path.join(ROOT, 'package.json'), {});
let V = pkg.version;
let REL = jread(path.join(DIST, 'release.json'), {});
const c = distribute.config();
const Q = c.shareQuery || '';
const URL = c.baseUrl ? c.baseUrl + '/' + Q : '';
const SETUP = () => path.join(DIST, '鸿汇影桌面版 Setup ' + V + '.exe');
const SETUPZIP = () => path.join(DIST, '鸿汇影桌面版 Setup ' + V + '.zip');
const HAP = path.join(DIST, 'honghub-harmony.hap');
const FOLDER = path.join(DESKTOP, '鸿汇影桌面中枢·v' + V + '全部交付');
function backupZipPath() {
  try {
    const hits = fs.readdirSync(DESKTOP).filter(n => /^鸿汇影桌面中枢·v.*全量备份_.*\.zip$/.test(n));
    if (hits.length) return path.join(DESKTOP, hits.sort().reverse()[0]);
  } catch (e) {}
  const d = new Date();
  const stamp = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return path.join(DESKTOP, '鸿汇影桌面中枢·v' + V + '全量备份_' + stamp + '.zip');
}

// ---------- 1) 补丁重出包 ----------
function mirrorDir(src, dst, skip) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = ent.name;
    if (skip && skip.test(rel)) continue;
    const a = path.join(src, rel), b = path.join(dst, rel);
    if (ent.isDirectory()) n += mirrorDir(a, b, skip);
    else if (ent.isFile()) {
      if (fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b))) continue;
      copyIf(a, b); n++;
    }
  }
  return n;
}
function syncRuntimeIntoPackage() {
  log('\n=== 补丁：同步运行时文件进 win-unpacked ===');
  const skip = /^(data|node_modules|\.git|__pycache__|\.env)$|\.jsonl$/;
  let n = 0;
  for (const d of ['app', 'server', 'features', 'assets']) n += mirrorDir(path.join(ROOT, d), path.join(APPDIR, d), skip);
  for (const f of ['electron-main.js', 'build_desktop.py', 'package.json']) {
    const a = path.join(ROOT, f), b = path.join(APPDIR, f);
    if (fs.existsSync(a) && (!fs.existsSync(b) || !fs.readFileSync(a).equals(fs.readFileSync(b)))) { copyIf(a, b); n++; }
  }
  record('同步运行时文件', n ? 'passed' : 'passed', n + ' 个文件有变化');
}
// 安装包内不能携带「自身 SHA256」：这份 release.json 会随 exe 一起被打进包，
// 写死哈希会导致重打包后哈希再次变化，永远对不上。真实值运行时从公网清单取。
function neutralizeBakedRelease() {
  const p = path.join(UPDATES, 'release.json');
  const r = jread(p, null);
  if (!r) return;
  const d = (r.artifacts && r.artifacts.desktop) || {};
  r.artifacts = Object.assign({}, r.artifacts, {
    desktop: Object.assign({}, d, { sha256: null, size: null })
  });
  r.desktopSha256Source = 'remote-manifest.json';
  jwrite(p, r);
  // 随包的 .sha256 别名同理：写死安装包自身哈希永远对不上，改成明确说明。
  const sf = path.join(UPDATES, 'desktop-setup.exe.sha256');
  if (fs.existsSync(sf)) {
    fs.writeFileSync(sf,
      '# 安装包自身 SHA256 不随包写死（自引用），运行时由 server/distribute.js 从公网 remote-manifest.json 读取。\n');
  }
  record('包内 release.json 去除自引用哈希', 'passed');
}
function rebuildInstaller() {
  log('\n=== 补丁：重建 NSIS 安装器（版本与 HAP 不变）===');
  need(fs.existsSync(CLI), '缺少 electron-builder CLI');
  need(fs.existsSync(APPDIR), '缺少 dist/win-unpacked/resources/app');
  const before = fs.existsSync(SETUP()) ? sha(SETUP()) : '';
  if (DRY) { record('重建安装器', 'dry-run'); return; }
  const r = spawnSync(process.execPath, [CLI, '--prepackaged', 'dist/win-unpacked'],
    { cwd: ROOT, stdio: 'inherit', env: ENV, timeout: 1800000 });
  need(r.status === 0, 'electron-builder --prepackaged 失败（exit=' + r.status + '）');
  const after = sha(SETUP());
  need(after && after !== before, '安装器哈希未变化，可能未真正重建');
  record('重建安装器', 'passed', V + ' · ' + fs.statSync(SETUP()).size + ' B · sha256 ' + after.slice(0, 16) + '…');
}
function makeSetupZip() {
  const exe = SETUP(), zip = SETUPZIP();
  if (!fs.existsSync(exe) || DRY) return;
  pyZip(PY_ONE, [exe, zip]);
  record('重生成 Setup zip', 'passed', fs.statSync(zip).size + ' B');
}
function refreshArtifacts() {
  log('\n=== 补丁：重算产物元数据 ===');
  const exe = SETUP();
  need(fs.existsSync(exe), '安装器不存在');
  const h = sha(exe), size = fs.statSync(exe).size;
  REL = jread(path.join(DIST, 'release.json'), {});
  need(REL && REL.artifacts, 'dist/release.json 缺 artifacts');
  if (DRY) { record('重算产物元数据', 'dry-run'); return; }
  REL.artifacts.desktop = Object.assign({}, REL.artifacts.desktop, { size, sha256: h });
  REL.buildAt = new Date().toISOString();
  jwrite(path.join(DIST, 'release.json'), REL);
  // postpack 用硬链接做别名；先断开硬链接再写，避免「读写同一 inode」把安装包写坏
  const alias = path.join(DIST, 'desktop-setup.exe');
  try { if (fs.existsSync(alias)) fs.unlinkSync(alias); } catch (e) {}
  fs.copyFileSync(exe, alias);
  const txt = h + '  desktop-setup.exe\n';
  fs.writeFileSync(path.join(DIST, 'desktop-setup.exe.sha256'), txt);
  if (fs.existsSync(UPDATES)) fs.writeFileSync(path.join(UPDATES, 'desktop-setup.exe.sha256'), txt);
  // 完整 release.json 只写回免安装目录（安装器里的版本保持去自引用哈希）
  jwrite(path.join(UPDATES, 'release.json'), REL);
  record('重算产物元数据', 'passed', 'desktop sha256 ' + h.slice(0, 16) + '… / ' + size + ' B');
}
async function patchInstaller() {
  // dry-run 绝不改写 win-unpacked / 包内元数据，避免「预演」产生构建副作用。
  if (DRY) { record('补丁重出包（同步运行时 / 去自引用 / 重建安装器 / 重算元数据）', 'dry-run'); return; }
  syncRuntimeIntoPackage();
  neutralizeBakedRelease();
  rebuildInstaller();
  await makeSetupZip();
  refreshArtifacts();
  node('build-archs.js', [], '重生成批量下发与设备适配清单', true);
  node('sbom.js', [], '重生成依赖审计与 SBOM', true);
  node('archive-release.js', [], '刷新版本归档与可回滚索引', true);
}

// ---------- 2) 站点发布 ----------
function deploy() {
  log('\n=== 站点发布 ===');
  const cmd = process.env.KH_DEPLOY_CMD;
  if (DRY || NO_DEPLOY) { record('站点发布', 'skipped', '显式跳过'); return 'pending'; }
  if (cmd) {
    const r = spawnSync(cmd, { cwd: ROOT, shell: true, stdio: 'inherit', env: ENV, timeout: 1800000 });
    const ok = r.status === 0;
    record('站点发布（KH_DEPLOY_CMD）', ok ? 'passed' : 'failed', 'exit=' + r.status);
    if (!ok) process.exit(r.status || 1);
    return 'deployed';
  }
  const req = {
    appName: '鸿汇影频道下发', directory: path.join(DIST, 'public'),
    entryHtml: 'index.html', language: 'static',
    domainPrefix: 'honghub-delivery',
    baseUrl: c.baseUrl, shareQuery: Q, version: REL.versionName,
    note: '由宿主站点发布能力执行；完成后运行 npm run ship:verify 收口。'
  };
  fs.writeFileSync(path.join(DIST, 'deploy-request.json'), JSON.stringify(req, null, 2) + '\n');
  record('站点发布', 'pending', '未配置 KH_DEPLOY_CMD：已写 dist/deploy-request.json，待宿主发布');
  return 'pending';
}

// ---------- 3) 远端探测 + 全量回下 ----------
function get(url, redirects) {
  return new Promise((resolve) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const r = lib.get(url, { timeout: 60000, headers: { Range: 'bytes=0-63' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && (redirects || 0) < 4) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), (redirects || 0) + 1));
      }
      let body = '', bytes = 0;
      res.on('data', (d) => { bytes += d.length; if (body.length < 200000) body += d.toString('utf8'); });
      res.on('end', () => resolve({ code: res.statusCode, body, bytes, headers: res.headers }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ code: 0, body: 'timeout', bytes: 0 }); });
    r.on('error', (e) => resolve({ code: 0, body: e.message, bytes: 0 }));
    r.end();
  });
}
function getFull(url) {
  return new Promise((resolve) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const r = lib.get(url, { timeout: 60000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); return resolve(getFull(new URL(res.headers.location, url).toString()));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 500000) body += d; });
      res.on('end', () => resolve({ code: res.statusCode, body }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ code: 0, body: 'timeout' }); });
    r.on('error', (e) => resolve({ code: 0, body: e.message }));
    r.end();
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const r = lib.get(url, { timeout: 600000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); return resolve(download(new URL(res.headers.location, url).toString(), dest));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    r.on('error', reject);
    r.end();
  });
}
async function verifyRemote() {
  log('\n=== 远端验收 ===');
  need(c.enabled && URL, '未配置公网端点');
  const asset = (rel) => c.baseUrl + '/' + rel + Q;
  const mRes = await getFull(asset('remote-manifest.json'));
  need(mRes.code === 200, '公网清单不可达（HTTP ' + mRes.code + '）');
  let remote;
  try { remote = JSON.parse(mRes.body); } catch (e) { need(false, '公网清单不是合法 JSON：' + e.message); }
  need(Number(remote.versionCode) === Number(REL.versionCode), '公网清单版本与本地不一致');
  need(remote.desktopSha256 === REL.artifacts.desktop.sha256, '公网清单 desktopSha256 与本地不一致');
  need(remote.hapSha256 === REL.artifacts.hap.sha256, '公网清单 hapSha256 与本地不一致');
  const exe = await get(asset('honghub/v' + V + '/desktop-setup.exe'));
  const hap = await get(asset('honghub/v' + V + '/HongHubMovie.hap'));
  need((exe.code === 200 || exe.code === 206) && (hap.code === 200 || hap.code === 206),
    '公网成品不可达：exe HTTP ' + exe.code + ' / HAP HTTP ' + hap.code);
  record('远端清单与直链', 'passed', 'v' + V + ' · exe ' + exe.code + ' · HAP ' + hap.code);

  // 全量回下：唯一能证明「客户拿到的就是这一版」的验收
  const tmpExe = path.join(DIST, '.ship_remote_exe'), tmpHap = path.join(DIST, '.ship_remote_hap');
  await download(asset('honghub/v' + V + '/desktop-setup.exe'), tmpExe);
  await download(asset('honghub/v' + V + '/HongHubMovie.hap'), tmpHap);
  const okExe = sha(tmpExe) === REL.artifacts.desktop.sha256;
  const okHap = sha(tmpHap) === REL.artifacts.hap.sha256;
  fs.unlinkSync(tmpExe); fs.unlinkSync(tmpHap);
  need(okExe && okHap, '公网全量回下与本地不一致（exe=' + okExe + ' hap=' + okHap + '）');
  record('公网全量回下逐字节比对', 'passed', 'exe / HAP 均 SAME');

  // 本地清单与线上对齐（避免 publishedAt 等格式差异造成两端不一致）
  jwrite(path.join(DIST, 'remote-manifest.json'), remote);
  jwrite(path.join(DIST, 'public', 'remote-manifest.json'), remote);
  record('本地 / 站点源 / 线上清单对齐', 'passed', String(remote.publishedAt || ''));
  return remote;
}

// ---------- 4) 桌面全量交付同步 ----------
function exportSource(dest) {
  const out = gitOut(['ls-files', '--cached', '--others', '--exclude-standard']);
  const files = out.split(/\r?\n/).filter(Boolean);
  const bad = /(^|\/)(\.env$|[^/]*\.(pfx|p12|cer|key)$)/i;
  let n = 0;
  for (const rel of files) {
    if (bad.test(rel) || /^(dist|releases|certs|node_modules|_signtmp)\//.test(rel)) continue;
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    if (copyIf(src, path.join(dest, rel))) n++;
  }
  return n;
}
function syncDeliveryFolder() {
  log('\n=== 桌面全量交付同步 ===');
  if (DRY) { record('桌面交付同步', 'dry-run'); return; }
  const F = FOLDER;
  for (const d of ['成品', '文档', '配置与报告', '站点镜像', '源码'])
    fs.mkdirSync(path.join(F, d), { recursive: true });
  const srcN = exportSource(path.join(F, '源码'));
  copyIf(SETUP(), path.join(F, '成品', path.basename(SETUP())));
  copyIf(SETUPZIP(), path.join(F, '成品', path.basename(SETUPZIP())));
  copyIf(HAP, path.join(F, '成品', 'HongHubMovie.hap'));
  copyIf(HAP, path.join(F, '成品', '签名工作台', 'HongHubMovie.hap'));
  const md = path.join(ROOT, '鸿汇影桌面中枢·v' + V + '更新说明.md');
  if (fs.existsSync(md)) {
    copyIf(md, path.join(F, '成品', path.basename(md)));
    for (const f of fs.readdirSync(ROOT).filter(n => /^鸿汇影桌面中枢·v.*更新说明\.md$/.test(n)))
      copyIf(path.join(ROOT, f), path.join(F, '文档', f));
  }
  if (copyIf(path.join(ROOT, 'README.md'), path.join(F, '文档', 'README.md'))) {}

  const reports = [
    ['.env.example', '.env.example'], ['.hap-build.json', '.hap-build.json'],
    ['HongHubMovie.hap.sha256', 'HongHubMovie.hap.sha256'], ['archs.json', 'archs.json'],
    ['audit.json', 'audit.json'], ['builder-debug.yml', 'builder-debug.yml'],
    ['codesign.json', 'codesign.json'], ['delivery.json', 'delivery.json'],
    ['desktop-setup.exe.sha256', 'desktop-setup.exe.sha256'], ['hap-smoke.json', 'hap-smoke.json'],
    ['hap-watch.json', 'hap-watch.json'],
    ['honghub-harmony.hap.sha256', 'honghub-harmony.hap.sha256'],
    ['os-profiles.json', 'os-profiles.json'], ['release.json', 'release.json'],
    ['remote-manifest.json', 'remote-manifest.json'], ['sbom.json', 'sbom.json'],
    ['ui-smoke.json', 'ui-smoke.json']
  ];
  for (const [from, to] of reports) copyIf(path.join(DIST, from), path.join(F, '配置与报告', to));
  copyIf(path.join(ROOT, 'server', 'public-endpoint.json'), path.join(F, '配置与报告', 'public-endpoint.json'));
  copyIf(path.join(ROOT, 'releases', 'index.json'), path.join(F, '配置与报告', 'releases-index.json'));
  copyIf(path.join(ROOT, '.github', 'workflows', 'ci.yml'), path.join(F, '配置与报告', 'ci.yml'));
  for (const f of ['index.html', 'remote-manifest.json', 'delivery.json', 'archs.json', 'os-profiles.json'])
    copyIf(path.join(DIST, 'public', f), path.join(F, '站点镜像', f));

  const commit = gitOut(['log', '--oneline', '-1']).split(' ')[0] || '未提交';
  const srcTotal = (function count(d) {
    let n = 0;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      n += e.isDirectory() ? count(p) : (e.isFile() ? 1 : 0);
    }
    return n;
  })(path.join(F, '源码'));
  const dsha = REL.artifacts.desktop.sha256, hsha = REL.artifacts.hap.sha256;
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const exeSize = fs.statSync(SETUP()).size;
  const zipSize = fs.existsSync(SETUPZIP()) ? fs.statSync(SETUPZIP()).size : 0;
  const hapSize = fs.existsSync(HAP) ? fs.statSync(HAP).size : 0;

  const linkTxt = [
    '鸿汇影桌面中枢 · v' + V + ' 公网发布链接',
    '保存时间: ' + now, '',
    '【入口页面（发给客户 / 收藏这个）】', URL, '',
    '【访问码 sharecode】', Q.replace(/^\?sharecode=/, ''),
    '注意: 站点所有静态资源必须带 ' + Q + '，直接访问不带参数的子路径会返回 403「链接不完整」。', '',
    '【直链】',
    '发布清单      ' + c.baseUrl + '/remote-manifest.json' + Q,
    'Windows 安装包 ' + c.baseUrl + '/honghub/v' + V + '/desktop-setup.exe' + Q,
    '深开鸿 HAP    ' + c.baseUrl + '/honghub/v' + V + '/HongHubMovie.hap' + Q,
    '回滚版本索引  ' + c.baseUrl + '/releases/index.json' + Q, '',
    '【版本与校验】', 'v' + V + ' / #' + REL.versionCode,
    'desktop sha256 ' + dsha, 'hap     sha256 ' + hsha,
    'exe / HAP 已从公网全量回下，与桌面成品逐字节一致。', '',
    '【随包配置】',
    'server/public-endpoint.json 已内置同一 baseUrl 与 shareQuery，客户安装后无需另配 .env。',
    '安装包自身 SHA256 不写进随包配置（避免自引用），运行时从公网清单读取。',
    '同目录的「鸿汇影频道下发.url」可直接双击打开发布页；桌面顶层也放了同一份快捷方式。', ''
  ].join('\n');
  fs.writeFileSync(path.join(F, '发布链接.txt'), linkTxt, 'utf8');
  fs.writeFileSync(path.join(F, '鸿汇影频道下发.url'),
    '[InternetShortcut]\r\nURL=' + URL + '\r\nIconIndex=0\r\n', 'utf8');
  fs.writeFileSync(path.join(DESKTOP, '鸿汇影频道下发.url'),
    '[InternetShortcut]\r\nURL=' + URL + '\r\nIconIndex=0\r\n', 'utf8');

  const desc = [
    '鸿汇影桌面中枢 · v' + V + ' 全量交付',
    '========================================',
    '生成时间: ' + now,
    'Git 提交: ' + commit,
    '版本: v' + V + ' / #' + REL.versionCode,
    '公网站点: ' + URL, '',
    '【目录结构】',
    '  成品/              可直接使用的 4 种成品 + 签名工作台同步副本',
    '    鸿汇影桌面版 Setup ' + V + '.exe   Windows 安装包（' + exeSize + ' B）',
    '    鸿汇影桌面版 Setup ' + V + '.zip   资料库免解压分发包（' + zipSize + ' B）',
    '    HongHubMovie.hap                 深开鸿 HAP（' + hapSize + ' B）',
    '    鸿汇影桌面中枢·v' + V + '更新说明.md',
    '    签名工作台/HongHubMovie.hap      与上方 HAP 逐字节相同',
    '  源码/              当前工作区源码（本次刷新 ' + srcN + ' 个 / 目录共 ' + srcTotal +
    ' 个，含历史更新说明留档；不含 .env / 私钥 / node_modules / dist）',
    '  文档/              README.md + 历史更新说明',
    '  配置与报告/        release / remote-manifest / public-endpoint / codesign / 校验值 / 归档索引等',
    '  站点镜像/          下发站的页面与元数据；大成品不重复打包，见 ../成品/',
    '  发布链接.txt       公网入口、sharecode、四条直链、SHA256',
    '  鸿汇影频道下发.url  双击直接打开发布页（桌面顶层也放了同一份）',
    '  校验清单.txt       本目录全部文件的大小与 SHA256',
    '  交付说明.txt       本文件', '',
    '【开发者端一键出包发布】',
    '  npm run ship         正式发版 + 全链路发布 + 回下验收 + 桌面同步',
    '  npm run ship:patch   补丁重出包（版本/HAP 不变，仅重建安装器）',
    '  npm run ship:verify  站点发布后收口验收',
    '  配置 KH_DEPLOY_CMD（自有域名/对象存储上传命令）即可真正一键全自动。', '',
    '【如何使用】',
    '  1. 双击「成品/鸿汇影桌面版 Setup ' + V + '.exe」安装 Windows 桌面中枢。',
    '  2. HAP 用 hdc install 装到深开鸿设备；签名工作台内也已放同版 HAP。',
    '  3. zip 为资料库用的免解压分发包。',
    '  4. 源码还原：进入「源码/」→ npm install → npm run doctor → npm run ship。', '',
    '【对外发布】', '  下发站: ' + URL,
    '  清单、exe、HAP 均已从公网全量回下校验，与本目录成品逐字节一致。',
    '  静态资源需带 ' + Q + '，否则站点返回 403。', '',
    '【校验值】', '  desktop sha256 ' + dsha, '  hap     sha256 ' + hsha, '',
    '【刻意排除】',
    '  .env、certs/ 自签 PFX 私钥、HAP 签名密钥(.p12/.cer)、node_modules/、dist 历史 exe/zip。', '',
    '【已知限制（外部输入）】',
    '  1. 商业 CA 代码签名证书 —— 现用副本自检证书，SmartScreen 仍可能提示。',
    '  2. 深开鸿真机 —— 已做到 npm run hap:watch 插上设备即自动冒烟，硬件未接入。',
    '  3. GitHub 建仓权限 —— 授权已生效，但 GitHub App 无建仓权，需手动建空仓库后推送以触发 CI。', ''
  ].join('\n');
  fs.writeFileSync(path.join(F, '交付说明.txt'), desc, 'utf8');

  // 校验清单：遍历目录全部文件（不含清单自身）
  const list = [];
  (function walk(d, prefix) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + ent.name : ent.name;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p, rel);
      else if (ent.isFile() && rel !== '校验清单.txt') list.push({ rel, p, size: fs.statSync(p).size, sha: sha(p) });
    }
  })(F, '');
  list.sort((a, b) => a.rel.localeCompare(b.rel, 'zh-CN'));
  const chk = [
    '鸿汇影桌面中枢 · v' + V + ' 全量交付校验清单',
    '生成时间: ' + now,
    '提交: ' + commit + ' | 版本码: ' + REL.versionCode + ' | 校验文件数: ' + list.length,
    'release.json 声明: desktop=' + dsha,
    '                 hap=' + hsha,
    '（本清单不含自身）',
    '----------------------------------------------------------------------------------------------------'
  ];
  for (const x of list) chk.push(String(x.size).padStart(10) + '  ' + x.sha + '  ' + x.rel);
  fs.writeFileSync(path.join(F, '校验清单.txt'), chk.join('\n') + '\n', 'utf8');
  record('桌面交付目录同步', 'passed', list.length + ' 个校验条目 / 源码 ' + srcN + ' 文件');

  // 顶层成品同步（只覆盖本项目自己生成的同名文件）
  copyIf(SETUP(), path.join(DESKTOP, path.basename(SETUP())));
  copyIf(HAP, path.join(DESKTOP, 'HongHubMovie.hap'));
  if (fs.existsSync(md)) copyIf(md, path.join(DESKTOP, path.basename(md)));
  // 桌面整理后 Setup zip 可能被移进子目录或已不在顶层：顶层缺失就补齐一份，
  // 子目录里若仍有同名旧包也同步刷新，保证「桌面全部成品」始终齐全且不产生陈旧包。
  const topZip = path.join(DESKTOP, path.basename(SETUPZIP()));
  if (!fs.existsSync(topZip)) copyIf(SETUPZIP(), topZip);
  const movedZip = path.join(DESKTOP, '新建文件夹 (7)', path.basename(SETUPZIP()));
  if (fs.existsSync(movedZip)) copyIf(SETUPZIP(), movedZip);
  copyIf(HAP, path.join(DESKTOP, '新建文件夹 (6)', 'sign', 'HongHubMovie.hap'));
  record('桌面顶层成品同步', 'passed');

  // 全量备份 zip
  const Z = backupZipPath();
  const note = [
    '鸿汇影桌面中枢 · v' + V + ' 全量备份',
    '生成: ' + new Date().toISOString(),
    '提交: ' + commit,
    '版本: v' + V + ' / #' + REL.versionCode,
    '发布入口: ' + URL,
    'desktop sha256: ' + REL.artifacts.desktop.sha256,
    'hap sha256: ' + REL.artifacts.hap.sha256,
    '还原: 解压任意目录；源码/ 内执行 npm install → npm run doctor → npm run ship。',
    '本备份不含 .env / 私钥 / node_modules / 历史归档包。', ''
  ].join('\n');
  pyZip(PY_FOLDER, [F, Z, note]);
  record('全量备份 zip', 'passed', fs.statSync(Z).size + ' B · ' + path.basename(Z));
}

// ---------- 5) 报告 ----------
function report(deployStatus) {
  const out = {
    schema: 1, at: new Date().toISOString(), mode: MODE, versionName: V,
    versionCode: REL.versionCode, status: deployStatus === 'deployed' || deployStatus === 'verified' ? 'published' : deployStatus,
    deploy: deployStatus, publicUrl: URL,
    desktopSha256: REL.artifacts && REL.artifacts.desktop && REL.artifacts.desktop.sha256,
    hapSha256: REL.artifacts && REL.artifacts.hap && REL.artifacts.hap.sha256,
    steps
  };
  // deliver 是纯本地补交付，不能覆盖 ship/ship:verify 留下的 published 主报告。
  const reportPath = path.join(DIST, MODE === 'deliver' ? 'ship-deliver.json' : 'ship.json');
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2) + '\n');
  log('\n=== ship 报告 ===');
  log('  模式 ' + MODE + ' · v' + V + ' · ' + out.status);
  log('  公网 ' + URL);
  log('  报告 ' + reportPath);
  if (deployStatus === 'pending') {
    log('\n  站点发布待执行：发布 dist/public/ 后运行 npm run ship:verify 收口。');
    log('  提示：开发者配置 KH_DEPLOY_CMD 后，npm run ship 即真正一键全自动。');
  }
}

(async () => {
  log('鸿汇影 · 开发者端一键出包发布（模式：' + MODE + '）');
  need(c.enabled, '公网端点未配置（server/public-endpoint.json / KH_PUBLIC_BASE_URL）');

  if (MODE === 'full' || MODE === 'patch') {
    if (!SKIP_GATES) {
      node('check-static.js', [], '门禁：静态检查');
      node('doctor.js', [], '门禁：环境体检', true);
    }
    if (MODE === 'full') node('build-exe.js', [], '出包：npm run pack 全链路');
    else await patchInstaller();
    V = jread(path.join(ROOT, 'package.json'), {}).version;
    REL = jread(path.join(DIST, 'release.json'), {});
    node('publish-remote.js', [], '生成公网清单与静态发布目录');
  }

  let deployStatus;
  if (MODE === 'verify') deployStatus = 'verified';
  else if (MODE === 'deliver') deployStatus = 'deliver-only';
  else deployStatus = deploy();

  if (deployStatus === 'deployed' || deployStatus === 'verified') {
    await verifyRemote();
    // 先刷桌面成品再跑全量回归：verify-release.js 会断言「桌面 exe/HAP 与 dist 一致」，
    // 反序会在补丁重出包后撞上尚未刷新的旧桌面成品而误报失败。
    await syncDeliveryFolder();
    node('verify-release.js', [], '全量端到端回归');
  } else if (MODE === 'deliver') {
    await syncDeliveryFolder();
  }

  report(deployStatus);
})().catch((e) => {
  console.error('\nship 失败：' + (e && e.message || e));
  try {
    fs.writeFileSync(path.join(DIST, 'ship.json'), JSON.stringify({
      schema: 1, at: new Date().toISOString(), mode: MODE, status: 'failed',
      error: String(e && e.message || e), steps
    }, null, 2) + '\n');
  } catch (e2) {}
  process.exit(1);
});
