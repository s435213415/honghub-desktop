#!/usr/bin/env node
'use strict';
/* 鸿汇影 HAP 统一 CLI（排期第 6 条）
   把「出哪个变体、签哪条链、产物对不对、上架材料齐不齐」收敛成一条命令，
   避免每次出包手敲环境变量 + 手工核对 sha256。

   用法：
     node scripts/hap-cli.js status                    只看：版本 / 三变体产物 / 链就绪 / 新鲜度 / 清单一致性
     node scripts/hap-cli.js build client|dev|store|all 出包（all=client→dev→store 顺序）
     node scripts/hap-cli.js verify                     产物一致性 + store 纯净度（只读）
     node scripts/hap-cli.js release                    build all + verify 一把过

   选项：
     --dry-run       只打印将要执行的命令与环境，不真跑
     --allow-stale   传给子脚本 KH_HAP_ALLOW_STALE=1（只改前端时用，改了 ArkTS 源码别加）
     --chain=xxx     透传签名链（official / kaihong / kaihong-release），默认 official

   铁律：本脚本只编排，不重写签名/净化/门禁逻辑；任何子脚本非 0 退出立即中止并透传退出码。
   绝不自动换链、绝不自动改版本号、绝不「沿用旧包」冒充新版本。 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const env = require('./lib/env');

const ROOT = env.ROOT;
const DIST = path.join(ROOT, 'dist');
const SCRIPTS = path.join(ROOT, 'scripts');
const NODE = process.execPath;
const PY = env.findPython();

const VARIANTS = {
  client: {
    label: '私发客户版',
    file: 'honghub-harmony.hap',
    stamp: '.hap-build.json',
    bundle: 'com.honghub.harmony',
    env: { KH_HAP_VARIANT: 'client', KH_DEVUI: '0' },
    how: 'scripts/hap-sign.js（变体重建 www + resign_hap.py + 新鲜度/符号门禁 + release.json 同步）'
  },
  dev: {
    label: '开发端',
    file: 'honghub-harmony-dev.hap',
    stamp: '.hap-build-dev.json',
    bundle: 'com.honghub.harmony.dev',
    env: { KH_HAP_VARIANT: 'dev', KH_DEVUI: '1' },
    how: 'scripts/hap-sign.js（KH_DEVUI=1 重建前端，签完自动复原客户版口径）'
  },
  store: {
    label: '商店版',
    file: 'honghub-harmony-store.hap',
    stamp: '.hap-build-store.json',
    bundle: 'com.honghub.store',
    env: { KH_HAP_VARIANT: 'store' },
    how: 'scripts/build-store-hap.js（app→www 同步 + store 净化 + 独立 bundle 重签 + 还原 www）'
  }
};

const argv = process.argv.slice(2);
const cmd = (argv[0] || 'status').toLowerCase();
const flags = argv.slice(1);
const has = (f) => flags.includes(f) || argv.includes(f);
const optVal = (name) => {
  const hit = flags.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : null;
};
const dryRun = has('--dry-run');
const allowStale = has('--allow-stale');
const chain = optVal('chain');

function line(s) { console.log(s); }
function head(s) { line('\n=== ' + s + ' ==='); }
function fail(msg) { console.error('\n[hap-cli 失败] ' + msg); process.exit(1); }

function shaLarge(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function fmtTime(t) {
  if (!t) return '—';
  try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(t); }
}

/* ============ status ============ */
function showStatus() {
  const man = readJson(path.join(ROOT, 'server', 'manifest.json'));
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const rel = man && man.release && man.release.latest ? man.release.latest : null;
  if (!rel) fail('server/manifest.json 取不到 release.latest（版本真相源不可用）');

  head('版本真相源');
  line('  manifest：v' + rel.versionName + ' / #' + rel.versionCode);
  line('  package.json：v' + (pkg ? pkg.version : '?') +
       (pkg && String(pkg.version) !== String(rel.versionName) ? '  ⚠ 与 manifest 不一致（出包以 manifest 为准）' : '  ✓ 一致'));

  head('三变体产物');
  const rows = [];
  for (const [v, cfg] of Object.entries(VARIANTS)) {
    const p = path.join(DIST, cfg.file);
    const st = readJson(path.join(DIST, cfg.stamp));
    if (!fs.existsSync(p)) {
      const note = st ? '⚠ 产物已清理/归档（记录 v' + st.versionName + ' #' + st.versionCode + ' 仍在）' : '未出过包';
      rows.push([v, cfg.label, '缺失', '—', '—', note]);
      continue;
    }
    const size = fs.statSync(p).size;
    const sha = shaLarge(p);
    let note = '';
    if (!st) note = '无出包记录';
    else {
      if (st.sha256 && st.sha256 !== sha) note += '⚠ sha 与记录不符 ';
      if (Number(st.versionCode) && Number(st.versionCode) !== Number(rel.versionCode) && v !== 'dev')
        note += '⚠ 版本 #' + st.versionCode + '≠当前 #' + rel.versionCode + ' ';
      if (st.versionName && String(st.versionName) !== String(rel.versionName))
        note += '⚠ 记录版本 v' + st.versionName + ' ';
    }
    rows.push([v, cfg.label, (size / 1024).toFixed(0) + ' KB', sha.slice(0, 16) + '…', fmtTime(st && st.builtAt), note.trim() || '✓']);
  }
  for (const r of rows) line('  ' + r[0].padEnd(7) + r[1].padEnd(7) + String(r[2]).padStart(9) + '  ' + r[3].padEnd(20) + ' ' + String(r[4]).padEnd(21) + ' ' + r[5]);
  line('  产物目录：' + path.relative(ROOT, DIST));
  // dist 内同一份包的多名字副本，列清楚免得误判成「有多个不同产物」
  const haps = fs.readdirSync(DIST).filter((f) => /\.hap$/i.test(f)).sort();
  if (haps.length) {
    const known = Object.values(VARIANTS).map((v) => v.file);
    line('  dist 内 HAP：' + haps.map((f) => f + '（' + (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0) + 'KB' + (known.includes(f) ? '' : '·别名') + '）').join('  '));
  }

  head('release.json 一致性');
  const relJson = readJson(path.join(DIST, 'release.json'));
  if (!relJson) line('  ⚠ dist/release.json 缺失（尚未跑打包链）');
  else {
    const art = (relJson.artifacts && relJson.artifacts.hap) || null;
    const clientPath = path.join(DIST, VARIANTS.client.file);
    if (!art) line('  ⚠ release.json 无 artifacts.hap 段');
    else if (!fs.existsSync(clientPath)) line('  ⚠ release.json 记了 hap，但客户版 HAP 不存在');
    else {
      const sha = shaLarge(clientPath);
      const size = fs.statSync(clientPath).size;
      const ok = art.sha256 === sha && Number(art.size) === size;
      line((ok ? '  ✓ ' : '  ⚠ ') + 'artifacts.hap ' + art.size + ' B / ' + String(art.sha256).slice(0, 16) + '…' +
           (ok ? ' 与实际一致' : ' 与实际不符（实际 ' + size + ' B / ' + sha.slice(0, 16) + '…）→ 跑 hap-cli build client 会自动回写'));
    }
    line('  清单版本：v' + relJson.versionName + ' / #' + relJson.versionCode +
         (String(relJson.versionName) !== String(rel.versionName) ? '  ⚠ ≠ manifest' : '  ✓'));
  }

  head('签名链就绪（只读自检，不签名）');
  const chainBundle = { official: 'com.honghub.harmony', kaihong: 'com.kaihong.movie', 'kaihong-release': 'com.kaihong.movie' };
  for (const c of ['official', 'kaihong', 'kaihong-release']) {
    const r = spawnSync(PY, [path.join(ROOT, 'harmony', 'signing', 'resign_hap.py'), '--check-chain', '--chain=' + c],
      { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    if (r.status === 0) {
      line('  ✓ ' + c + '：可签（bundle ' + chainBundle[c] + '）');
    } else {
      const bad = out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && (s.startsWith('✘') || s.indexOf('✘') >= 0));
      const why = bad.length ? bad.join(' / ') : out.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ');
      line('  ✗ ' + c + '：' + why);
      if (chainBundle[c] !== 'com.honghub.harmony') {
        line('      ↳ 属预期：这条链的身份是 ' + chainBundle[c] + '，不是鸿汇影主体包；用它对 com.honghub.* 出包会被 bundle 门禁挡住');
      }
    }
  }
  // store 上架的硬前置：链条必须给 com.honghub.store 签 release
  line('  · store 上架要求：release 链 + profile 的 bundle-name = com.honghub.store');
  line('    （当前 kaihong-release 的 bundle 是 com.kaihong.movie，平台未签发 store 身份前，store 只能用 official 链自签、不能上架）');

  head('源码新鲜度（防「改了 ArkTS 没编译」）');
  try {
    const fresh = require('./lib/hap-fresh');
    const r = fresh.checkFresh(
      path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'ets'),
      path.join(ROOT, 'harmony', 'entry', 'build', 'default', 'outputs', 'default', 'entry-default-unsigned.hap')
    );
    line(r.ok ? '  ✓ ' + (r.reason || 'ArkTS 源码不新于壳包，原生改动已编译') : '  ✗ ' + r.reason);
    line('    （ets 最新 ' + fmtTime(r.etsNewest) + ' / 壳包 ' + fmtTime(r.shellMtime) + '，' + r.files + ' 个源文件）');
  } catch (e) {
    line('  ⚠ 新鲜度检查不可用：' + e.message);
  }

  head('凭据');
  const e = env.loadEnv();
  const pwd = process.env.OH_KEY_PWD || e.OH_KEY_PWD;
  const kpwd = process.env.KH_KAIHONG_PWD || e.KH_KAIHONG_PWD;
  line('  OH_KEY_PWD（official 链用）：' + (pwd ? '已配置' : '✗ 缺失（.env 或环境变量）'));
  line('  KH_KAIHONG_PWD（kaihong 链用）：' + (kpwd ? '已配置' : '✗ 缺失'));
  line('  python：' + PY);
}

/* ============ build ============ */
function planBuild(variant) {
  const cfg = VARIANTS[variant];
  if (!cfg) fail('未知变体：' + variant + '（可用：' + Object.keys(VARIANTS).join(' / ') + ' / all）');
  const envExtra = Object.assign({}, cfg.env, { PYTHONIOENCODING: 'utf-8' });
  if (allowStale) envExtra.KH_HAP_ALLOW_STALE = '1';
  if (chain) envExtra.KH_HAP_CHAIN = chain;
  const script = variant === 'store' ? 'build-store-hap.js' : 'hap-sign.js';
  return { variant, cfg, script, envExtra };
}

function runBuild(variant) {
  const { cfg, script, envExtra } = planBuild(variant);
  head('出包 ' + variant + '（' + cfg.label + '）');
  line('  脚本：' + script);
  line('  ' + cfg.how);
  line('  注入环境：' + Object.keys(envExtra).map((k) => k + '=' + envExtra[k]).join('  '));
  line('  目标产物：dist/' + cfg.file + '（stamp ' + cfg.stamp + '）');
  if (dryRun) { line('  [dry-run] 未执行'); return true; }

  const t0 = Date.now();
  const r = spawnSync(NODE, [path.join(SCRIPTS, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, envExtra)
  });
  if (r.error) fail(cfg.label + ' 出包无法启动：' + r.error.message);
  if (r.status !== 0) fail(cfg.label + ' 出包失败（exit=' + r.status + '），后续变体不再执行');

  // 出包后立即核验，防止「脚本说成功但产物没变」
  const p = path.join(DIST, cfg.file);
  if (!fs.existsSync(p)) fail('脚本 exit=0 但未产出 dist/' + cfg.file);
  const st = readJson(path.join(DIST, cfg.stamp));
  const sha = shaLarge(p);
  if (st && st.sha256 && st.sha256 !== sha) fail('产物 sha256 与 ' + cfg.stamp + ' 不一致');
  line('  ✓ 完成：' + cfg.file + ' · ' + fs.statSync(p).size + ' B · ' + sha.slice(0, 16) + '… · 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  return true;
}

/* ============ verify ============ */
function findStoreZip() {
  const dir = path.join(DIST, 'client');
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).filter((f) => /store.*\.zip$/i.test(f)).sort().pop();
  return hit ? path.join(dir, hit) : null;
}

function runVerify() {
  head('产物一致性总检（check-artifacts.js）');
  if (dryRun) { line('  [dry-run] 将执行 node scripts/check-artifacts.js --quiet'); }
  else {
    const r = spawnSync(NODE, [path.join(SCRIPTS, 'check-artifacts.js'), '--quiet'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { console.error('\n[hap-cli] 产物一致性未通过（见上）'); return false; }
  }

  head('store 纯净门禁（check-store-purity.js）');
  const zip = findStoreZip();
  if (!zip) {
    line('  · 未找到 store 免安装 zip（重装/发版链产物），跳过纯净门禁');
    line('    HAP 侧纯净性由 build-store-hap.js 的净化步骤 + check-client-purity 保障');
  } else if (dryRun) {
    line('  [dry-run] 将执行 node scripts/check-store-purity.js "' + path.relative(ROOT, zip) + '"');
  } else {
    line('  目标：' + path.relative(ROOT, zip));
    const r = spawnSync(NODE, [path.join(SCRIPTS, 'check-store-purity.js'), zip], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { console.error('\n[hap-cli] store 纯净门禁未通过'); return false; }
  }
  line('\n  ✓ verify 全部通过');
  return true;
}

/* ============ 分派 ============ */
switch (cmd) {
  case 'status':
    showStatus();
    break;

  case 'build': {
    const v = (optVal('variant') || flags.find((a) => !a.startsWith('--')) || 'client').toLowerCase();
    if (v === 'all') {
      for (const name of ['client', 'dev', 'store']) if (!runBuild(name)) process.exit(1);
    } else if (!runBuild(v)) process.exit(1);
    break;
  }

  case 'verify':
    if (!runVerify()) process.exit(1);
    break;

  case 'release': {
    for (const name of ['client', 'dev', 'store']) if (!runBuild(name)) process.exit(1);
    if (!runVerify()) process.exit(1);
    line('\n=== 全量出包完成：三个变体 + 一致性/纯净度均通过 ===');
    break;
  }

  default:
    fail('未知命令：' + cmd + '\n可用：status | build <client|dev|store|all> | verify | release');
}
