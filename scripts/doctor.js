#!/usr/bin/env node
'use strict';
/* npm run doctor —— 只读环境体检。不打包、不安装、不修改任何文件。
   用途：出包前 / 换机后 / CI 里一次性看清签名链、产物、配置、日志、归档是否齐全。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const { spawnSync } = require('child_process');
const env = require('./lib/env');
const zip = require('./lib/zip-read');

const ROOT = env.ROOT;
env.apply();
const CFG = env.loadEnv();
const asJson = process.argv.includes('--json');
const rows = [];
const add = (level, item, detail) => rows.push({ level, item, detail });
const ok = (i, d) => add('OK', i, d);
const warn = (i, d) => add('WARN', i, d);
const err = (i, d) => add('ERR', i, d);

function versionOf(bin, args) {
  const r = spawnSync(bin, args || ['--version'], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0 || r.error) return null;
  return String(r.stdout || r.stderr).trim().split('\n')[0].slice(0, 70);
}
function sha(file) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.allocUnsafe(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}
function size(file) { try { return fs.statSync(file).size; } catch (e) { return 0; } }

// —— 运行时 ——
ok('Node.js', process.version);
const pyVer = versionOf(process.env.PYTHON_BIN || 'python', ['--version']);
pyVer ? ok('Python', pyVer) : err('Python', '未找到，HAP 注入与影站同步不可用');
const javaVer = versionOf('java', ['-version']);
javaVer ? ok('Java', javaVer) : warn('Java', 'PATH 中未找到；签名脚本会自动探测 toolchain/JDK8');
const hdc = env.findHdc();
const hdcVer = versionOf(hdc, ['-v']);
if (!hdcVer) {
  warn('hdc / 真机', '未找到 hdc 可执行文件；真机冒烟会明确报 SKIP（可设 KH_HDC）');
} else {
  // 工具存在不等于设备存在：明确区分「缺工具」与「缺设备」，避免误判
  const t = spawnSync(hdc, ['list', 'targets'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const targets = String(t.stdout || '').split(/\r?\n/).map(s => s.trim())
    .filter(s => s && !/^\[Empty\]$/i.test(s) && !/list targets/i.test(s));
  if (t.error || t.status !== 0) warn('hdc / 真机', '已找到 ' + hdc + '，但设备探测失败：' + (t.error ? t.error.message : String(t.stderr || '').trim().slice(0, 80)));
  else if (targets.length) ok('hdc / 真机', hdcVer + ' · 已连接 ' + targets.length + ' 台设备（可跑 npm run smoke:hap）');
  else warn('hdc / 真机', '已找到 ' + hdc + '，list targets 为 [Empty]：接入开发板后即可跑真机冒烟');
}

// —— 项目内签名链 ——
const SIGN = path.join(ROOT, 'harmony', 'signing');
// 真实签名链 hap-sign.js → resign_hap.py 的布局：壳包在 signing 根，密钥在 keys/sign-keys/。
// 旧检查把密钥写成 signing/sign-keys/，导致材料齐全却误报缺失。
const REQUIRED = ['_inject_honghub.py', 'sign-hap.py', 'resign_hap.py', 'entry-default-unsigned.hap',
  'keys/sign-keys/app-key.p12', 'keys/sign-keys/profile-key.p12', 'keys/sign-keys/ca.p12', 'keys/sign-keys/ca.cer'];
const miss = REQUIRED.filter(f => !fs.existsSync(path.join(SIGN, f)));
miss.length ? err('项目内签名工作台', '缺 ' + miss.join(', ') + '；执行 npm run signing:setup')
  : ok('项目内签名工作台', REQUIRED.length + ' 项齐全（不再依赖桌面临时目录）');
const pwd = process.env.OH_KEY_PWD || CFG.OH_KEY_PWD;
pwd ? ok('签名密钥口令', '已从 .env / 环境变量读取（源码内无明文）') : err('签名密钥口令', '缺 OH_KEY_PWD');
const sdkCands = [process.env.OH_SDK_HOME, path.join(os.homedir(), 'Desktop', 'command-line-tools'),
  path.join(ROOT, '..', 'command-line-tools')].filter(Boolean);
const sdk = sdkCands.find(c => fs.existsSync(path.join(c, 'sdk/26.0.1/toolchains/lib/hap-sign-tool.jar')));
sdk ? ok('HAP 签名 SDK', sdk) : warn('HAP 签名 SDK', '未找到 hap-sign-tool.jar，可设 OH_SDK_HOME');
const tc = path.join(ROOT, '..', 'toolchain');
fs.existsSync(tc) ? ok('JDK toolchain', tc) : warn('JDK toolchain', '工作区 toolchain/ 不存在，将依赖系统 JDK');

// —— 发版产物 ——
const relFile = path.join(ROOT, 'dist', 'release.json');
let rel = null;
try { rel = JSON.parse(fs.readFileSync(relFile, 'utf8')); } catch (e) { err('dist/release.json', '不可读：' + e.message); }
if (rel) {
  ok('发版版本', 'v' + rel.versionName + ' / #' + rel.versionCode + ' · 功能 ' + (rel.features && rel.features.count) + ' 项');
  for (const [k, label] of [['desktop', '桌面安装包'], ['hap', 'HAP']]) {
    const a = rel.artifacts && rel.artifacts[k];
    const local = k === 'desktop' ? path.join(ROOT, 'dist', 'desktop-setup.exe')
      : path.join(ROOT, 'dist', 'honghub-harmony.hap');
    if (!a || !fs.existsSync(local)) { err(label, '本地产物缺失：' + local); continue; }
    const actual = sha(local);
    if (actual !== a.sha256) err(label, 'SHA256 与 release.json 不一致（可能产物被替换）');
    else ok(label, size(local).toLocaleString() + ' B · sha256 ' + actual.slice(0, 16) + '…');
  }
  const hapFile = path.join(ROOT, 'dist', 'honghub-harmony.hap');
  if (fs.existsSync(hapFile)) {
    try {
      const html = zip.readText(hapFile, 'resources/rawfile/www/index.html');
      // 兼容两代前端版本标记：新版用 versionCode，旧版用 var KH_APP_CODE
      const m = html.match(/versionCode["'\s:=]+(\d{5,})/) || html.match(/var KH_APP_CODE\s*=\s*(\d+)/) || html.match(/KH_APP_CODE[^\d]{0,15}(\d{5,})/);
      if (!m) err('HAP 新鲜度', '包内前端缺少版本标记（versionCode / KH_APP_CODE）');
      else if (Number(m[1]) !== Number(rel.versionCode)) err('HAP 新鲜度', '包内 #' + m[1] + ' ≠ 发版 #' + rel.versionCode + '（旧 HAP 冒充新版）');
      else ok('HAP 新鲜度', '包内前端与发版一致（#' + rel.versionCode + '）');
    } catch (e) { err('HAP 新鲜度', e.message); }
  }
}

// —— 日志 / 归档 / 磁盘 ——
const DATA = path.join(ROOT, 'server', 'data');
let logBytes = 0, big = [];
if (fs.existsSync(DATA)) for (const f of fs.readdirSync(DATA)) {
  if (!f.endsWith('.jsonl')) continue;
  const s = size(path.join(DATA, f));
  logBytes += s;
  if (s > 5 * 1024 * 1024) big.push(f + ' ' + (s / 1024 / 1024).toFixed(1) + 'MB');
}
big.length ? warn('运行日志', big.join(', ') + ' 超过 5MB 轮转阈值') : ok('运行日志', (logBytes / 1024).toFixed(0) + ' KB，已在轮转阈值内');
const idx = path.join(ROOT, 'releases', 'index.json');
try { const r = JSON.parse(fs.readFileSync(idx, 'utf8')); ok('版本归档', (r.versions || []).length + ' 个历史版本可回滚'); }
catch (e) { warn('版本归档', '尚无 releases/index.json；执行 npm run archive'); }
const distBytes = fs.existsSync(path.join(ROOT, 'dist'))
  ? fs.readdirSync(path.join(ROOT, 'dist')).reduce((n, f) => n + size(path.join(ROOT, 'dist', f)), 0) : 0;
ok('dist 体积', (distBytes / 1024 / 1024).toFixed(0) + ' MB（历史 exe/zip 可用 npm run archive 归档）');

// —— 可插拔外部能力 ——
const csc = process.env.WIN_CSC_FILE || CFG.WIN_CSC_FILE;
const selfCert = path.join(ROOT, 'certs', 'codesign-selftest.pfx');
csc && fs.existsSync(csc) ? ok('Windows 代码签名', '证书已配置') :
  warn('Windows 代码签名', fs.existsSync(selfCert)
    ? '仅本地自签测试证书（sign:test 链路已通过）；正式分发仍需商业 CA 证书，出包将 SKIP'
    : '未配置 WIN_CSC_FILE，出包将 SKIP（SmartScreen 可能拦截）');
const pub = process.env.KH_PUBLISH_BUCKET || CFG.KH_PUBLISH_BUCKET;
// 站点模式：随包携带的非敏感端点配置，无需对象存储凭证也能让客户端拿到公网更新
let site = null;
try {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'public-endpoint.json'), 'utf8'));
  if (p && p.enabled && p.baseUrl) site = p;
} catch (e) {}
site ? ok('公网分发', '站点模式已接通：' + site.baseUrl) :
  (pub ? ok('公网分发', '对象存储已配置') : warn('公网分发', '未配置，当前仅局域网 8787 本地分发'));
const pubBase = process.env.KH_PUBLIC_BASE_URL || CFG.KH_PUBLIC_BASE_URL;
if (pub && !pubBase && !site) warn('公网分发', '配置了存储桶但缺 KH_PUBLIC_BASE_URL，客户端拿不到公网更新地址');

// —— 端口（异步探测完成后输出）——
const port = Number(process.env.PORT || 8787);
const socket = net.connect({ host: '127.0.0.1', port });
let portDone = false;
socket.setTimeout(800);
socket.on('connect', () => { portDone = true; socket.destroy(); warn('中枢端口 ' + port, '已被占用；打包应用会自动顺延到 8788'); finish(); });
socket.on('error', () => { portDone = true; ok('中枢端口 ' + port, '空闲'); finish(); });
socket.on('timeout', () => { portDone = true; socket.destroy(); warn('中枢端口 ' + port, '探测超时'); finish(); });

function finish() {
  const counts = rows.reduce((a, r) => (a[r.level] = (a[r.level] || 0) + 1, a), {});
  if (asJson) {
    console.log(JSON.stringify({ ok: !counts.ERR, summary: counts, items: rows }, null, 2));
  } else {
    console.log('\n=== 环境体检 ===');
    for (const r of rows) console.log('  [' + r.level.padEnd(4) + '] ' + r.item + ' — ' + r.detail);
    console.log('\n汇总：OK ' + (counts.OK || 0) + ' · WARN ' + (counts.WARN || 0) + ' · ERR ' + (counts.ERR || 0));
  }
  process.exit(counts.ERR ? 1 : 0);
}
setTimeout(() => { if (!portDone) { socket.destroy(); finish(); } }, 2000);
