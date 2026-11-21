#!/usr/bin/env node
'use strict';
/* 版本号单一真相源 + 全端自动同步

   问题背景：versionName / versionCode 散落在 7+ 处（manifest、package.json、两端
   kh-release 内嵌清单、KH_APP_CODE、feature-version、public-endpoint、releases/index），
   过去发版脚本只同步其中几处，导致客户端版本判断错乱（1000120/1000121/1000122 三处并存）。

   本脚本把 server/manifest.json 的 release.latest 定为唯一真相源，提供：
     node scripts/version.js            查看各位置版本与一致性（默认）
     node scripts/version.js --check    一致性门禁：不一致则以退出码 1 中止（供 CI / ship 调用）
     node scripts/version.js --sync     以真相源对齐全部位置（不递增、不改成品哈希）
     node scripts/version.js --bump     递增版本（versionCode +1、patch +1）并对齐全部位置
     node scripts/version.js --bump=minor|major  递增次版本 / 主版本

   对齐范围（versionName / versionCode）：
     1. server/manifest.json         release.latest（真相源，--sync 时它是来源不被覆盖）
     2. package.json                 version
     3. server/feature-version.json  versionName / versionCode
     4. server/public-endpoint.json  versionName / versionCode（历史遗漏点，已根治）
     5. app/index.html               kh-release 内嵌 latest + KH_APP_CODE + appCode + appVersion
     6. harmony .../www/index.html   同上（深开鸿端）
     7. releases/index.json          latest.versionName / latest.versionCode

   约束：只改版本数字与随版本发布的文案，不改任何成品二进制、哈希或下载 URL。
   被 --sync/--bump 改写的内嵌清单是「随包基线」，运行时会被公网清单覆盖，
   因此对齐它们不会改变已安装客户端的行为，也不会让成品哈希失效。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'server', 'manifest.json');
const PKG = path.join(ROOT, 'package.json');
const STAMP = path.join(ROOT, 'server', 'feature-version.json');
const ENDPOINT = path.join(ROOT, 'server', 'public-endpoint.json');
const INDEX = path.join(ROOT, 'releases', 'index.json');
const PAGES = [
  path.join(ROOT, 'app', 'index.html'),
  /* 前端已模块化（1.7.72）：KH_APP_CODE 定义在 app/kh-app.js，必须一起纳入一致性链 */
  path.join(ROOT, 'app', 'kh-app.js'),
  path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www', 'index.html'),
  /* HAP 端同样是模块化结构：www/kh-app.js 才是 KH_APP_CODE 的落点 */
  path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www', 'kh-app.js')
];

const ARGS = process.argv.slice(2);
const CHECK = ARGS.includes('--check');
const SYNC = ARGS.includes('--sync');
const BUMP = ARGS.find((a) => a === '--bump' || a.indexOf('--bump=') === 0);
function read(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; } }
function write(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); }

// ---- 采集各位置当前版本 ----
function collect() {
  const m = read(MANIFEST, {});
  const truth = (m.release && m.release.latest) || {};
  const sites = [];
  const add = (name, file, vname, vcode) => sites.push({ name, file, vname, vcode });
  add('manifest.release.latest(真相源)', MANIFEST, truth.versionName, truth.versionCode);
  const pkg = read(PKG, {}); add('package.json.version', PKG, pkg.version, null);
  const st = read(STAMP, {}); add('feature-version.json', STAMP, st.versionName, st.versionCode);
  const ep = read(ENDPOINT, {}); add('public-endpoint.json', ENDPOINT, ep.versionName, ep.versionCode);
  const ix = read(INDEX, {}); const il = ix.latest || {}; add('releases/index.json.latest', INDEX, il.versionName, il.versionCode);
  for (const p of PAGES) {
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, 'utf8');
    let emb = null;
    const re = /<script id="kh-release" type="application\/json">([\s\S]*?)<\/script>/;
    const mm = s.match(re);
    if (mm) { try { emb = JSON.parse(mm[1]).latest || {}; } catch (e) {} }
    const codeM = s.match(/var KH_APP_CODE\s*=\s*(\d+)/);
    add(path.relative(ROOT, p) + ' [内嵌清单]', p, emb && emb.versionName, emb && emb.versionCode);
    add(path.relative(ROOT, p) + ' [KH_APP_CODE]', p, null, codeM && Number(codeM[1]));
  }
  return { truth, sites };
}
function normCode(x) { const n = Number(x); return isFinite(n) && n > 0 ? n : null; }
function consistent(sites, target) {
  // target 是 manifest.release.latest，字段名为 versionName / versionCode（不是 vname/vcode）
  const tv = target.versionName != null ? target.versionName : target.vname;
  const tc = normCode(target.versionCode != null ? target.versionCode : target.vcode);
  return sites.every((s) =>
    (s.vname == null || s.vname === tv) &&
    (normCode(s.vcode) == null || normCode(s.vcode) === tc));
}

// ---- 对齐单个页面（内嵌清单 + KH_APP_CODE + appCode + appVersion） ----
function syncPage(p, v) {
  if (!fs.existsSync(p)) return false;
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(/(<script id="kh-release" type="application\/json">)([\s\S]*?)(<\/script>)/, function (_, a, b, c) {
    let obj; try { obj = JSON.parse(b); } catch (e) { return a + b + c; }
    if (!obj.latest || typeof obj.latest !== 'object') obj.latest = {};
    obj.latest.versionName = v.vname;
    obj.latest.versionCode = v.vcode;
    if (v.publishedAt) { obj.latest.publishedAt = v.publishedAt; obj.generatedAt = v.publishedAt; }
    return a + JSON.stringify(obj) + c;
  });
  s = s.replace(/var KH_APP_CODE\s*=\s*\d+\s*;/, 'var KH_APP_CODE = ' + v.vcode + ';');
  s = s.replace(/appCode:\s*\d+/, 'appCode: ' + v.vcode);
  s = s.replace(/appVersion:\s*'[^']*-desktop'/, "appVersion: '" + v.vname + "-desktop'");
  if (s !== before) fs.writeFileSync(p, s);
  return s !== before;
}

// ---- 对齐所有位置 ----
function syncAll(v) {
  const touched = [];
  // package.json
  const pkg = read(PKG, {});
  if (pkg.version !== v.vname) { pkg.version = v.vname; write(PKG, pkg); touched.push('package.json'); }
  // feature-version.json
  const st = read(STAMP, {});
  if (st.versionName !== v.vname || normCode(st.versionCode) !== v.vcode) {
    st.versionName = v.vname; st.versionCode = v.vcode; if (v.publishedAt) st.publishedAt = v.publishedAt;
    write(STAMP, st); touched.push('feature-version.json');
  }
  // public-endpoint.json
  const ep = read(ENDPOINT, {});
  if (ep.versionName !== v.vname || normCode(ep.versionCode) !== v.vcode) {
    ep.versionName = v.vname; ep.versionCode = v.vcode;
    write(ENDPOINT, ep); touched.push('public-endpoint.json');
  }
  // releases/index.json
  const ix = read(INDEX, {});
  if (ix.latest && (ix.latest.versionName !== v.vname || normCode(ix.latest.versionCode) !== v.vcode)) {
    ix.latest.versionName = v.vname; ix.latest.versionCode = v.vcode;
    write(INDEX, ix); touched.push('releases/index.json');
  }
  // pages
  for (const p of PAGES) if (syncPage(p, v)) touched.push(path.relative(ROOT, p));
  return touched;
}

// ---- 计算递增后的目标版本 ----
function nextVersion(truth, bumpArg) {
  const v = { vname: String(truth.versionName || '0.0.0'), vcode: normCode(truth.versionCode) || 0 };
  const kind = (bumpArg && bumpArg.indexOf('=') >= 0 ? bumpArg.split('=')[1] : 'patch') || 'patch';
  const parts = v.vname.split('.').map((x) => Number(x) || 0);
  while (parts.length < 3) parts.push(0);
  if (kind === 'major') { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
  else if (kind === 'minor') { parts[1] += 1; parts[2] = 0; }
  else parts[2] += 1;
  v.vname = parts.slice(0, 3).join('.');
  v.vcode += 1;
  return v;
}

// ---- 主流程 ----
let { truth, sites } = collect();
if (!truth.versionName || !normCode(truth.versionCode)) {
  console.error('真相源 manifest.release.latest 缺少合法 versionName/versionCode'); process.exit(1);
}

if (CHECK) {
  const ok = consistent(sites, truth);
  console.log('=== 版本一致性检查 ===');
  for (const s of sites) {
    const vok = s.vname == null || s.vname === truth.versionName;
    const cok = normCode(s.vcode) == null || normCode(s.vcode) === normCode(truth.versionCode);
    console.log('  ' + (vok && cok ? 'OK  ' : 'DIFF') + ' ' + s.name + ' → ' +
      (s.vname || '-') + ' / #' + (s.vcode == null ? '-' : s.vcode));
  }
  console.log('  真相源：v' + truth.versionName + ' / #' + truth.versionCode +
    ' · ' + (ok ? '全部一致' : '存在不一致'));
  process.exit(ok ? 0 : 1);
}

if (BUMP) {
  const v = nextVersion(truth, BUMP);
  v.publishedAt = new Date().toISOString();
  console.log('=== 自动升级版本号 ===');
  console.log('  v' + truth.versionName + ' / #' + truth.versionCode + '  →  v' + v.vname + ' / #' + v.vcode);
  // 先更新真相源
  const m = read(MANIFEST, {});
  m.release.latest.versionName = v.vname;
  m.release.latest.versionCode = v.vcode;
  m.release.latest.publishedAt = v.publishedAt;
  m.release.generatedAt = v.publishedAt;
  write(MANIFEST, m);
  const touched = syncAll(v);
  console.log('  已对齐：' + (touched.join('、') || '（无需改动）'));
  console.log('  新版 v' + v.vname + ' / #' + v.vcode + ' 已写入全部 ' + sites.length + ' 处');
  process.exit(0);
}

if (SYNC) {
  const v = { vname: truth.versionName, vcode: normCode(truth.versionCode), publishedAt: truth.publishedAt };
  console.log('=== 版本对齐（以真相源为准，不递增、不改哈希）===');
  console.log('  目标：v' + v.vname + ' / #' + v.vcode);
  const touched = syncAll(v);
  console.log('  已对齐：' + (touched.join('、') || '（全部已一致）'));
  const after = collect();
  const ok = consistent(after.sites, after.truth);
  console.log('  结果：' + (ok ? '全部一致' : '仍有差异，请人工检查'));
  process.exit(ok ? 0 : 1);
}

// 默认：查看
console.log('=== 版本总览（真相源 v' + truth.versionName + ' / #' + truth.versionCode + '）===');
for (const s of sites) {
  const vok = s.vname == null || s.vname === truth.versionName;
  const cok = normCode(s.vcode) == null || normCode(s.vcode) === normCode(truth.versionCode);
  console.log('  ' + (vok && cok ? 'OK  ' : 'DIFF') + ' ' + s.name + ' → ' +
    (s.vname || '-') + ' / #' + (s.vcode == null ? '-' : s.vcode));
}
console.log('\n用法：--check 一致性门禁 · --sync 对齐（不改哈希）· --bump[=minor|major] 递增并同步');
