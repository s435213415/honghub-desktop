'use strict';
/* 客户包纯净性自检（#99 加固）：扫描客户产物（win-unpacked 解包目录 / 客户 zip），
   断言不含开发端运维面板、开发自更新模块、server/data 历史运行痕迹与敏感凭证文件。
   只读检查，不修改任何产物；未发现客户产物时跳过并提示，不判失败。
   退出码：0 = 无违规；1 = 发现残留或扫描异常。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const zipRead = require('./lib/zip-read');
const { violation, norm } = require('./lib/purity-rules');

/* 归一化路径：zip 内条目剥离打包前缀；目录分隔符统一为 / */

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else out.push(fp);
  }
}

const findings = [];
function scanUnpacked() {
  const appDir = path.join(DIST, 'win-unpacked', 'resources', 'app');
  if (!fs.existsSync(appDir)) { console.log('  [跳过] 未发现 win-unpacked 解包目录'); return; }
  /* win-unpacked 打包结束后会被还原成开发端形态（build-client-exe.js 的 finally 会把
     dev-auto-update.js 放回、把 /admin 段复原）。开发端目录本来就应该有运维面板与自更新模块，
     对它判违规会让门禁长期假红；客户交付物以 zip / exe 为准，客户形态的解包目录仍照常检查。 */
  if (fs.existsSync(path.join(appDir, 'dev-auto-update.js'))) {
    console.log('  [提示] win-unpacked 为开发端形态（含 dev-auto-update.js），跳过解包目录判定；客户产物以 zip / exe 为准');
    return;
  }
  const files = [];
  walk(appDir, files);
  let hits = 0;
  for (const fp of files) {
    const rel = path.relative(appDir, fp);
    const v = violation(rel);
    if (v) { findings.push({ source: 'unpacked', rel: norm(rel), kind: v }); hits++; }
  }
  console.log('  [解包目录] 扫描 ' + files.length + ' 个文件 · 违规 ' + hits + ' 项');
}

function scanZips() {
  const candidates = [];
  const pushIf = (p) => { if (fs.existsSync(p)) candidates.push(p); };
  try {
    for (const f of fs.readdirSync(DIST)) {
      if (/\.zip$/i.test(f)) pushIf(path.join(DIST, f));
    }
  } catch (e) {}
  const clientDir = path.join(DIST, 'client');
  try {
    if (fs.existsSync(clientDir)) {
      for (const f of fs.readdirSync(clientDir)) if (/\.zip$/i.test(f)) pushIf(path.join(clientDir, f));
    }
  } catch (e) {}
  if (!candidates.length) { console.log('  [跳过] 未发现客户 zip 产物'); return; }
  for (const z of candidates) {
    let entries;
    try { entries = zipRead.entries(z).out; }
    catch (e) { console.log('  [失败] ' + path.basename(z) + ' 解析失败：' + (e && e.message)); findings.push({ source: 'zip', rel: path.basename(z), kind: 'zip 解析异常' }); continue; }
    let hits = 0;
    for (const e of entries) {
      if (/\/$/.test(e.name)) continue;
      const v = violation(e.name);
      if (v) { findings.push({ source: path.basename(z), rel: norm(e.name), kind: v }); hits++; }
    }
    console.log('  [zip] ' + path.basename(z) + ' · 条目 ' + entries.length + ' · 违规 ' + hits + ' 项');
  }
}

console.log('=== 客户包纯净性自检 ===');
scanUnpacked();
scanZips();

if (findings.length) {
  console.log('');
  console.log('发现 ' + findings.length + ' 项残留：');
  for (const f of findings.slice(0, 60)) {
    console.log('  [×] ' + f.kind + ' · ' + f.source + ' · ' + f.rel);
  }
  if (findings.length > 60) console.log('  … 其余 ' + (findings.length - 60) + ' 项略');
  console.log('');
  console.log('纯净性自检未通过：客户包夹带开发端资产或历史痕迹，出包前先重跑 build-client 净化。');
  process.exit(1);
}

console.log('');
console.log('纯净性自检通过：未发现运维面板 / 开发自更新模块 / data 历史痕迹 / 凭证证书残留。');
process.exit(0);
