#!/usr/bin/env node
'use strict';
/* 深开鸿 HAP：换前端 → 对齐版本 → 复用证书稳定重签 → 新鲜度校验 → 产出到 dist/。
   实现细节全部收敛在 harmony/signing/resign_hap.py（一套脚本，命令行也能单独跑）。
   铁律：任何一步失败都 exit(1)，绝不「沿用已有 HAP」冒充新版本发版。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const env = require('./lib/env');

const ROOT = env.ROOT;
const SIGN = path.join(ROOT, 'harmony', 'signing');
const DIST = path.join(ROOT, 'dist');
const SCRIPT = path.join(SIGN, 'resign_hap.py');
// 变体隔离：KH_HAP_VARIANT=dev 出开发端变体 HAP，产物与 build 记录独立，不覆盖客户包
const VARIANT = (process.env.KH_HAP_VARIANT || 'client').trim().toLowerCase();
const IS_DEV = VARIANT === 'dev';
const HAP = path.join(DIST, IS_DEV ? 'honghub-harmony-dev.hap' : 'honghub-harmony.hap');
const STAMP = path.join(DIST, IS_DEV ? '.hap-build-dev.json' : '.hap-build.json');

function fail(msg) {
  console.error('[HAP 签名失败] ' + msg);
  process.exit(1);
}

if (!fs.existsSync(SCRIPT)) fail('缺少出包脚本：' + SCRIPT);
let code, name;
try {
  const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release.latest;
  code = Number(rel.versionCode);
  name = String(rel.versionName);
} catch (e) { fail('读取发版版本失败：' + e.message); }
if (!Number.isFinite(code) || !code) fail('发版 versionCode 非法');

const keyPwd = process.env.OH_KEY_PWD || env.loadEnv().OH_KEY_PWD;
if (!keyPwd) fail('缺少 OH_KEY_PWD（请在 .env 或环境变量中配置）');

const py = process.env.PYTHON_BIN || 'python';
const r = spawnSync(py, [SCRIPT], {
  cwd: ROOT,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { OH_KEY_PWD: keyPwd, PYTHONIOENCODING: 'utf-8' })
});
if (r.error) fail('resign_hap.py 无法启动：' + r.error.message);
if (r.status !== 0) fail('resign_hap.py 执行失败（exit=' + r.status + '）');

/* 二次新鲜度校验：dist 里的包必须就是本次版本，且 sha256 与 .hap-build.json 对得上 */
if (!fs.existsSync(HAP)) fail('未产出 ' + HAP);
const buf = fs.readFileSync(HAP);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
let meta = {};
try { meta = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch (e) {}
const expectedCode = IS_DEV ? code + 100 : code;   // 与 resign_hap.py 的 DEV_VERSION_CODE_OFFSET 对齐：dev 独立版本号
if (Number(meta.versionCode) && Number(meta.versionCode) !== expectedCode) fail('dist 内 HAP 版本 #' + meta.versionCode + ' ≠ 本次' + (IS_DEV ? '开发端' : '发版') + ' #' + expectedCode);
if (meta.sha256 && meta.sha256 !== sha) fail('dist 内 HAP 的 sha256 与出包记录不一致');
console.log('  HAP 新鲜度校验通过：v' + name + (IS_DEV ? '（开发端变体 · bundle ' + 'com.honghub.harmony.dev' + '）' : '（客户版 · bundle com.honghub.harmony）') + ' / #' + expectedCode + ' · ' + buf.length + ' B · sha256 ' + sha.slice(0, 16) + '…');
