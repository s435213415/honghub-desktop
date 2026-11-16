#!/usr/bin/env node
'use strict';
/* 深开鸿 HAP：注入适配前端 → 本地自签 → 新鲜度校验 → 产出到 dist/。
   铁律：任何一步失败都 exit(1)，绝不「沿用已有 HAP」冒充新版本发版。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const zip = require('./lib/zip-read');
const env = require('./lib/env');

const ROOT = env.ROOT;
const SIGN = path.join(ROOT, 'harmony', 'signing');
const DIST = path.join(ROOT, 'dist');
const ENTRY = 'resources/rawfile/movie-site/index.html';
env.apply();

function fail(msg) { console.error('[HAP 签名失败] ' + msg); process.exit(1); }
function need(p, label) { if (!fs.existsSync(p)) fail(label + ' 缺失：' + p + '\n  可先执行 npm run signing:setup'); }

const REQUIRED = [
  '_inject_honghub.py', 'sign-hap.py', 'entry-default-unsigned.hap',
  'sign-keys/app-key.p12', 'sign-keys/profile-key.p12', 'sign-keys/ca.p12', 'sign-keys/ca.cer'
];
for (const f of REQUIRED) need(path.join(SIGN, f), '签名工作台');
const keyPwd = process.env.OH_KEY_PWD || env.loadEnv().OH_KEY_PWD;
if (!keyPwd) fail('缺少 OH_KEY_PWD（请在 .env 或环境变量中配置）');

let code;
try { code = Number(JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release.latest.versionCode); }
catch (e) { fail('读取发版版本失败：' + e.message); }
if (!Number.isFinite(code)) fail('发版 versionCode 非法');

const py = process.env.PYTHON_BIN || 'python';
for (const s of ['_inject_honghub.py', 'sign-hap.py']) {
  console.log('  → ' + s);
  const r = spawnSync(py, [s], { cwd: SIGN, stdio: 'inherit', env: process.env });
  if (r.error) fail(s + ' 无法启动：' + r.error.message);
  if (r.status !== 0) fail(s + ' 执行失败（exit=' + r.status + '）');
}

const hap = path.join(SIGN, 'sign', 'HongHubMovie.hap');
need(hap, '签名产物');

// 新鲜度：包内前端必须就是本次发版生成的那一版
let html;
try { html = zip.readText(hap, ENTRY); }
catch (e) { fail('无法读取包内前端：' + e.message); }
if (html.indexOf('KH_HARMONY') < 0) fail('包内前端缺少 KH_HARMONY 适配标记');
const m = html.match(/var KH_APP_CODE\s*=\s*(\d+)/);
if (!m) fail('包内前端缺少 KH_APP_CODE');
if (Number(m[1]) !== code) fail('包内前端版本 #' + m[1] + ' ≠ 本次发版 #' + code + '（疑似沿用旧 HAP）');
const srcPath = path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www', 'index.html');
const norm = s => s.replace(/\r\n/g, '\n');
if (!fs.existsSync(srcPath) || norm(html) !== norm(fs.readFileSync(srcPath, 'utf8'))) {
  fail('包内前端与本次生成的 harmony www/index.html 不一致（注入未生效）');
}

const buf = fs.readFileSync(hap);
fs.mkdirSync(DIST, { recursive: true });
for (const name of ['HongHubMovie.hap', 'honghub-harmony.hap']) fs.writeFileSync(path.join(DIST, name), buf);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
fs.writeFileSync(path.join(DIST, '.hap-build.json'), JSON.stringify({
  schema: 1, versionCode: code, builtAt: new Date().toISOString(),
  size: buf.length, sha256: sha, source: 'harmony/signing (项目内自包含签名链)'
}, null, 2) + '\n');
console.log('  HAP 新鲜度校验通过：#' + code + ' · ' + buf.length + ' B · sha256 ' + sha.slice(0, 16) + '…');
