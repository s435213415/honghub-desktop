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

/* 源码新鲜度门禁（1.7.87 教训）：build_hap.py 只注入前端，不编译 ArkTS。
   若 ets 源码比壳包新，说明改了原生代码却没跑 hvigor，此时签出来的包"版本对、哈希自洽但没有原生改动"。
   直接拒绝签名；只有明确知道改的是纯前端时才允许 KH_HAP_ALLOW_STALE=1 跳过。 */
const ETS_DIR = path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'ets');
const SHELL_HAP = path.join(ROOT, 'harmony', 'entry', 'build', 'default', 'outputs', 'default', 'entry-default-unsigned.hap');
if (process.env.KH_HAP_ALLOW_STALE !== '1') {
  const fresh = require('./lib/hap-fresh');
  const r = fresh.checkFresh(ETS_DIR, SHELL_HAP);
  if (!r.ok) {
    fail(r.reason + '。请先跑：hvigorw.bat --mode module -p product=default assembleHap --no-daemon' +
         '（PATH 需含 C:\\Windows\\System32）。若本版只改前端，设 KH_HAP_ALLOW_STALE=1 再跑。');
  }
  console.log('  HAP 源码新鲜度校验通过：ets 最新 ' + new Date(r.etsNewest).toLocaleString('zh-CN') +
              ' ≤ 壳包 ' + new Date(r.shellMtime).toLocaleString('zh-CN') + '（' + r.files + ' 个源文件）');
}
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

/* 变体隔离（1.7.98 补）：www 只有一份目录，开发端的运维悬浮条（中枢地址 / 自动优化 /
   优化 / 反馈 / 成品 / 重连 / 口令）由 build_hap.py 的 KH_DEVUI 开关决定去留。
   dev 变体必须在签名前带 KH_DEVUI=1 重建前端；客户版必须不带。
   1.7.97 的真机表现是客户包装进了运维悬浮条——根因就是两个变体签的是同一份 www，
   构建时只按"默认"跑了一次，谁也没按变体重建。 */
const BUILD_HAP = path.join(ROOT, 'harmony', 'build_hap.py');
const variantEnv = Object.assign({}, process.env, {
  KH_DEVUI: IS_DEV ? '1' : '0',
  PYTHONIOENCODING: 'utf-8'
});
/* KH_HAP_SKIP_REBUILD=1：保留调用方事先构建好的 www 口径，不按变体重建。
   只给诊断用（例如「dev 包名 + 客户前端」这种交叉组合，用来隔离问题出在包名还是前端）。 */
if (process.env.KH_HAP_SKIP_REBUILD === '1') {
  console.log('  跳过变体重建（KH_HAP_SKIP_REBUILD=1）：使用现有 www 口径');
} else {
  const rb = spawnSync(py, [BUILD_HAP], { cwd: ROOT, stdio: 'inherit', env: variantEnv });
  if (rb.error) fail('按变体重建前端无法启动：' + rb.error.message);
  if (rb.status !== 0) fail('按变体重建前端失败（exit=' + rb.status + '），变体=' + (IS_DEV ? 'dev' : 'client'));
  console.log('  前端已按「' + (IS_DEV ? '开发端' : '客户版') + '」变体重建（KH_DEVUI=' + variantEnv.KH_DEVUI + '）');
}

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

/* 原生符号门禁：包内必须真能找到清单里的符号，堵住"源码有、包里没有"。
   清单见 harmony/required-symbols.txt（缺省 openVideo）。确实需要空包时用 KH_HAP_ALLOW_SYMBOLS_MISSING=1。 */
if (process.env.KH_HAP_ALLOW_SYMBOLS_MISSING !== '1') {
  const symbols = require('./lib/hap-symbols');
  let res;
  try { res = symbols.check(HAP, symbols.loadSymbols(ROOT)); }
  catch (e) { fail('包内符号检查失败：' + e.message); }
  if (res.missing.length) {
    fail('包内缺少原生符号：' + res.missing.join('、') + '（共检查 ' + res.entries + ' 个条目）。' +
         '通常意味着 ArkTS 源码没编译进壳包；确认改的是纯前端后可设 KH_HAP_ALLOW_SYMBOLS_MISSING=1。');
  }
  console.log('  HAP 符号门禁通过：' + res.symbols.join('、') + ' 均命中（检查 ' + res.entries + ' 个条目）');
}

/* 收尾复原：dev 签完后把 www 还原成客户版口径。
   否则工程里会留下开发端前端，下一次直接打 HAP（不经过本脚本）就会把运维面板带进客户包，
   1.7.97 真机那次混入就是这么来的。 */
if (IS_DEV && process.env.KH_HAP_SKIP_REBUILD !== '1') {
  const rr = spawnSync(py, [BUILD_HAP], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { KH_DEVUI: '0', PYTHONIOENCODING: 'utf-8' })
  });
  if (rr.status !== 0) console.log('  ⚠ 开发端签完后没能把工程前端复原成客户版口径，下次出包前请先跑 build_hap.py');
  else console.log('  工程前端已复原为客户版口径（www 不再带运维面板）');
}

/* 签完自动回写 release.json 的 artifacts.hap（1.7.111 补，原逻辑见 scripts/release/rel-hap-sync.js）。
   历史上每次重签都要手工对一次 sha256/size，漏一次 verify 就报「实际 SHA256 与清单不符」。
   只在客户变体写；dev 变体不进 release.json。release.json 尚未生成时只提示、不阻断（后续打包链会写）。 */
if (!IS_DEV) {
  const REL_JSON = path.join(DIST, 'release.json');
  if (fs.existsSync(REL_JSON)) {
    try {
      const rel = JSON.parse(fs.readFileSync(REL_JSON, 'utf8'));
      rel.artifacts = rel.artifacts || {};
      rel.artifacts.hap = { file: path.basename(HAP), size: buf.length, sha256: sha };
      fs.writeFileSync(REL_JSON, JSON.stringify(rel, null, 2) + '\n', 'utf8');
      console.log('  release.json 已同步：artifacts.hap ' + buf.length + ' B / ' + sha.slice(0, 12) + '…');
    } catch (e) {
      console.log('  ⚠ release.json 同步失败（不影响本次签名，可补跑 scripts\\release\\rel-hap-sync.js）：' + e.message);
    }
  } else {
    console.log('  release.json 尚未生成，跳过 artifacts.hap 同步（由后续打包链写入后需再同步一次）');
  }
}
