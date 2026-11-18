#!/usr/bin/env node
'use strict';
/* dist 客户版别名守护：确保 dist/desktop-setup.exe 是客户正式版，不是开发端包。
 *
 * 背景：electron-builder 固定输出 dist/，任何一次「单独重打开发端包」（手工
 *   electron-builder --prepackaged，或没走 build-client-exe.js 收尾的出包）都会把
 *   dist/desktop-setup.exe 覆盖成含运维入口的开发端包。若被当客户版下发会泄露 admin。
 *
 * 真相源：dist/release.json 的 artifacts.desktop.sha256（= 客户正式版基线）。
 * 恢复源（按序）：dist/public/honghub/v<ver>/desktop-setup.exe → 桌面客户成品夹同名 Setup。
 *
 * 用法：
 *   node scripts/guard-client-alias.js          校验，不符则自愈修复（默认）
 *   node scripts/guard-client-alias.js --check  只读校验，不改文件；0=OK, 4=不符
 * 退出码：0 OK/已修复；4 --check 模式发现不符；1 无法修复（源缺失/哈希不匹配）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');
const ALIAS = path.join(DIST, 'desktop-setup.exe');

function sha(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toLowerCase(); }
  catch (e) { return null; }
}
function say(s) { console.log('[guard-alias] ' + s); }

function baseline() {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(DIST, 'release.json'), 'utf8'));
    return {
      sha: String(r.artifacts.desktop.sha256 || '').toLowerCase(),
      size: Number(r.artifacts.desktop.size || 0),
      ver: String(r.versionName || '')
    };
  } catch (e) { return null; }
}

function recoveryCandidates(ver) {
  const desktop = path.join(os.homedir(), 'Desktop');
  const pub = path.join(DIST, 'public', 'honghub', 'v' + ver, 'desktop-setup.exe');
  const list = [pub];
  // 桌面客户成品夹里任意 v* 的同名 Setup（取最新一个目录）
  try {
    const dirs = fs.readdirSync(desktop)
      .filter(d => /^鸿汇影·客户成品_v/.test(d))
      .sort().reverse();
    for (const d of dirs) {
      for (const f of fs.readdirSync(path.join(desktop, d))) {
        if (/^鸿汇影桌面版 Setup .*\.exe$/i.test(f)) list.push(path.join(desktop, d, f));
      }
    }
  } catch (e) {}
  // dist 根带版本号的 Setup（保底）
  list.push(path.join(DIST, '鸿汇影桌面版 Setup ' + ver + '.exe'));
  return list.filter(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

function main() {
  const base = baseline();
  if (!base || !base.sha) { say('✗ 读不到 release.json 基线，无法守护'); process.exit(1); }
  const now = sha(ALIAS);
  if (now === base.sha) { say('✓ dist 客户别名正确（' + base.sha.slice(0, 16) + '…）'); process.exit(0); }
  say('✗ 别名不符：实测 ' + (now || '缺失') + ' / 基线 ' + base.sha.slice(0, 16) + '…');
  if (CHECK) { say('（--check 只读，未修改）'); process.exit(4); }

  for (const src of recoveryCandidates(base.ver)) {
    if (sha(src) !== base.sha) continue;
    try {
      // 先备份被污染的别名，可回滚
      if (now) {
        const bk = path.join(DIST, '_alias_polluted_' + Date.now() + '.exe.bak');
        fs.copyFileSync(ALIAS, bk);
        say('  污染别名已备份：' + path.basename(bk));
      }
      fs.copyFileSync(src, ALIAS);
      if (sha(ALIAS) === base.sha) {
        say('✓ 已从 ' + src + ' 恢复，复验 ' + base.sha.slice(0, 16) + '…');
        process.exit(0);
      }
    } catch (e) { say('  恢复失败：' + (e && e.message || e)); }
  }
  say('✗ 未找到哈希匹配的客户版恢复源，请人工介入（重跑 build:client 或核对 release.json）');
  process.exit(1);
}

main();
