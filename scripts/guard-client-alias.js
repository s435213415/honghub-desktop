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
 * 退出码：0 OK/已修复；4 --check 模式发现不符；
 *         5 三处基线(release.json/public清单/客户说明)交叉校验不一致，拒绝自愈需人工核对；
 *         1 无法修复（源缺失/哈希不匹配）。
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

/* 找出桌面客户下载说明.txt（与 dev-maintain.findCustomerNote 同规则） */
function findCustomerNote() {
  const desktop = path.join(os.homedir(), 'Desktop');
  let names = [];
  try { names = fs.readdirSync(desktop); } catch (e) { return null; }
  const direct = names.filter(n => /鸿汇影·客户成品_v[\d.]+/.test(n)).sort().reverse();
  for (const d of direct) {
    const note = path.join(desktop, d, '客户下载说明.txt');
    if (fs.existsSync(note)) return note;
  }
  const centers = names.filter(n => /交付中心/.test(n) && !/历史归档/.test(n)).sort().reverse();
  for (const c of centers) {
    let subs = [];
    try { subs = fs.readdirSync(path.join(desktop, c)); } catch (e) { continue; }
    for (const s of subs) {
      if (!/客户成品/.test(s)) continue;
      const note = path.join(desktop, c, s, '客户下载说明.txt');
      if (fs.existsSync(note)) return note;
    }
  }
  return null;
}

/* 从客户下载说明里解析 exe 的 SHA-256（新格式：文件名行后 5 行内找 64 位哈希）。 */
function noteExeSha() {
  const note = findCustomerNote();
  if (!note) return null;
  try {
    const lines = fs.readFileSync(note, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/\.exe\b/i.test(lines[i])) continue;
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const m = lines[j].match(/\b([0-9a-f]{64})\b/i);
        if (m) return { sha: m[1].toLowerCase(), note };
      }
    }
  } catch (e) {}
  return null;
}

/* 交叉校验三处基线：release.json / public 清单 / 桌面客户说明。
   任何一处被失败发版单独污染都会导致三处不一致——此时绝不能自愈（会把别名修向错值），
   必须报 5 让人工核对。只有三处完全一致才返回该哈希。 */
function baseline() {
  let rel = null, ver = '', size = 0;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(DIST, 'release.json'), 'utf8'));
    rel = String(r.artifacts.desktop.sha256 || '').toLowerCase();
    ver = String(r.versionName || '');
    size = Number(r.artifacts.desktop.size || 0);
  } catch (e) {}
  let pubSha = null;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(DIST, 'public', 'remote-manifest.json'), 'utf8'));
    pubSha = String(m.desktopSha256 || '').toLowerCase();
  } catch (e) {}
  const noteInfo = noteExeSha();
  const noteSha = noteInfo ? noteInfo.sha : null;

  const present = [rel, pubSha, noteSha].filter(Boolean);
  if (!rel) { say('✗ release.json 读不到基线哈希'); return { fail: true }; }
  const vals = [['release.json', rel], ['public清单', pubSha], ['客户说明', noteSha]];
  const mismatches = vals.filter(([, v]) => v && v !== rel);
  const missing = vals.filter(([, v]) => !v).map(([n]) => n);
  if (mismatches.length || missing.length) {
    say('✗ 基线三处交叉校验不通过，拒绝自愈（防止把别名修向被污染的基线）：');
    for (const [n, v] of vals) say('    ' + n + ' = ' + (v || '<缺失>'));
    if (noteInfo) say('    说明文件: ' + noteInfo.note);
    if (missing.length) say('    缺失: ' + missing.join('、'));
    return { fail: true, conflict: true };
  }
  return { sha: rel, size, ver };
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
  if (!base || base.fail || !base.sha) {
    if (base && base.conflict) { say('（可运行 node scripts/dev-maintain.js 与 npm run site:check 定位。）'); process.exit(5); }
    say('✗ 三处基线无法确认，无法守护');
    process.exit(1);
  }
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
