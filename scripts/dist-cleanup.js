#!/usr/bin/env node
'use strict';
/* dist 膨胀治理（保守策略）——绝不动回滚资产。
 *
 * 背景：dist 实测曾达 21G，其中绝大多数是「历史版本归档 / 构建中间产物」，
 * 这些是回滚与客户历史版本下载的资产，删了就回不去，因此脚本一律不自动删除。
 *
 * 策略：
 *   - 默认（无参数）：只扫描并报告，列出【可安全清理】与【保留（回滚资产）】两类，退出码 0。
 *   - --apply：仅删除下方 SAFE_PREFIXES / SAFE_NAMES 白名单里的临时/测试残留；
 *     历史版本、归档、构建产物、客户成品目录即使很大也一律跳过。
 *   - --json：机器可读报告。
 *
 * 用法：
 *   node scripts/dist-cleanup.js            # 报告
 *   node scripts/dist-cleanup.js --apply     # 清理白名单临时项
 *   node scripts/dist-cleanup.js --json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const JSON_OUT = ARGS.includes('--json');

/* 只清理「明确的临时 / 测试 / 调试残留」：这些不含客户版本，删了不影响回滚。 */
const SAFE_NAMES = new Set([
  'bridge-test'        // 网桥联调测试产物
]);
const SAFE_PREFIXES = [
  '_signtmp',          // 签名临时目录
  '_tmprebuild',       // 重建临时目录
  '_probe',            // 探测临时目录
  '_tmp'               // 通用临时目录（不含 _历史 / _archive）
];

/* 无论多大都保留：回滚资产 / 客户成品 / 构建中间产物。 */
const KEEP_HINTS = ['历史', 'archive', 'client', 'public', 'build', 'unpacked', 'releases'];

function dirSize(p) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      try {
        if (e.isDirectory()) total += dirSize(fp);
        else if (e.isFile()) total += fs.statSync(fp).size;
      } catch (e) { /* 忽略无法访问的条目 */ }
    }
  } catch (e) { /* 忽略 */ }
  return total;
}
function human(n) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' G';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(0) + ' M';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' K';
  return n + ' B';
}
function isSafe(name) {
  if (SAFE_NAMES.has(name)) return true;
  return SAFE_PREFIXES.some((p) => name.indexOf(p) === 0)
    && !KEEP_HINTS.some((h) => name.indexOf(h) >= 0);
}

if (!fs.existsSync(DIST)) {
  const msg = 'dist 目录不存在，无需清理';
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, message: msg }));
  else console.log(msg);
  process.exit(0);
}

const entries = fs.readdirSync(DIST, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => ({ name: e.name, path: path.join(DIST, e.name), safe: isSafe(e.name) }))
  .map((e) => ({ ...e, bytes: dirSize(e.path) }))
  .sort((a, b) => b.bytes - a.bytes);

const safeDirs = entries.filter((e) => e.safe);
const keepDirs = entries.filter((e) => !e.safe);
const safeBytes = safeDirs.reduce((s, e) => s + e.bytes, 0);
const keepBytes = keepDirs.reduce((s, e) => s + e.bytes, 0);

let removed = [];
if (APPLY) {
  for (const d of safeDirs) {
    try { fs.rmSync(d.path, { recursive: true, force: true }); removed.push(d.name); }
    catch (e) { if (!JSON_OUT) console.log('  [失败] 删除 ' + d.name + '：' + e.message); }
  }
}

const report = {
  ok: true,
  distTotal: human(safeBytes + keepBytes),
  safe: safeDirs.map((d) => ({ name: d.name, size: human(d.bytes) })),
  safeTotal: human(safeBytes),
  keep: keepDirs.map((d) => ({ name: d.name, size: human(d.bytes) })),
  keepTotal: human(keepBytes),
  removed
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('=== dist 体积治理报告 ===');
  console.log('dist 目录合计：' + report.distTotal);
  console.log('\n[可安全清理 · 临时/测试残留] 合计 ' + report.safeTotal);
  if (safeDirs.length) safeDirs.forEach((d) => console.log('  ' + human(d.bytes).padStart(9) + '  ' + d.name));
  else console.log('  （无）');
  console.log('\n[保留 · 回滚资产/成品/构建产物] 合计 ' + report.keepTotal + ' —— 脚本绝不自动删除');
  keepDirs.forEach((d) => console.log('  ' + human(d.bytes).padStart(9) + '  ' + d.name));
  if (APPLY) {
    console.log('\n已清理 ' + removed.length + ' 项：' + (removed.join('、') || '（无）'));
    console.log('释放约 ' + human(safeBytes) + '（仅统计本次命中白名单的目录）');
  } else {
    console.log('\n提示：加 --apply 仅删除上方「可安全清理」项；历史版本如需清理请人工确认后再手动处理。');
  }
}
process.exit(0);
