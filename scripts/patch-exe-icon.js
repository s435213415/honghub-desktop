#!/usr/bin/env node
/**
 * 固化 exe 图标改写（幂等）
 * --------------------------------------------------------------
 * 背景：package.json 里 "signAndEditExecutable": false —— 没有代码签名证书时，
 *       electron-builder 不会去编辑可执行文件资源段，于是 **exe 图标不会随构建更新**，
 *       每次都停留在首次构建写入的默认 Electron 图标，而且构建过程不报任何错。
 *       上一版是手工 rcedit 补的，一旦有人清了 dist/win-unpacked 重打就丢。
 *
 * 本脚本把这一步固化进出包链：按「exe sha256 + ico sha256」记录一次改写结果，
 * 重复调用直接跳过，不会反复膨胀资源段。
 *
 * 用法：
 *   node scripts/patch-exe-icon.js                       # 默认目标 dist/win-unpacked/鸿汇影桌面版.exe
 *   node scripts/patch-exe-icon.js --exe <path> --icon <path>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_EXE = path.join(ROOT, 'dist', 'win-unpacked', '鸿汇影桌面版.exe');
const DEFAULT_ICON = path.join(ROOT, 'assets', 'icon.ico');
const STAMP = path.join(ROOT, 'dist', '.icon-patched.json');

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function log(s) { console.log('[图标] ' + s); }

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function findRcedit() {
  const cands = [];
  const cache = process.env.ELECTRON_BUILDER_CACHE ||
    path.join(process.env.LOCALAPPDATA || process.env.APPDATA || '', 'electron-builder', 'Cache');
  const wcs = path.join(cache, 'winCodeSign');
  if (fs.existsSync(wcs)) {
    for (const d of fs.readdirSync(wcs).sort().reverse()) {
      for (const n of ['rcedit-x64.exe', 'rcedit.exe']) {
        const p = path.join(wcs, d, n);
        if (fs.existsSync(p)) cands.push(p);
      }
    }
  }
  cands.push(path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'));
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

function main() {
  const exe = path.resolve(arg('exe', DEFAULT_EXE));
  const icon = path.resolve(arg('icon', DEFAULT_ICON));

  if (!fs.existsSync(exe)) { console.error('[图标] 目标 exe 不存在：' + exe); process.exit(1); }
  if (!fs.existsSync(icon)) { console.error('[图标] 图标不存在：' + icon); process.exit(1); }

  const exeShaBefore = sha(exe);
  const iconSha = sha(icon);

  // 幂等：上次改写后 exe 的 sha 与当前一致，且图标未变 → 跳过
  // 注意比较的是「改写后」的 sha：改写前 sha 每轮都会变，用它判断永远不会命中。
  try {
    if (fs.existsSync(STAMP)) {
      const s = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
      if (s.exeSha === exeShaBefore && s.iconSha === iconSha) {
        log('PASSED 已是最新图标，跳过改写（' + path.basename(exe) + '）');
        return;
      }
    }
  } catch (e) { /* 标记损坏则照常改写 */ }

  const rcedit = findRcedit();
  if (!rcedit) { console.error('[图标] 未找到 rcedit（electron-builder 缓存缺失）'); process.exit(1); }

  const sizeBefore = fs.statSync(exe).size;
  const r = spawnSync(rcedit, [exe, '--set-icon', icon], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('[图标] rcedit 失败：' + (r.stderr || r.stdout || r.error));
    console.error('[图标] 若 exe 正被运行中的进程占用，请先停止程序和本地服务再执行');
    process.exit(1);
  }

  const sizeAfter = fs.statSync(exe).size;
  const exeShaAfter = sha(exe);
  fs.mkdirSync(path.dirname(STAMP), { recursive: true });
  fs.writeFileSync(STAMP, JSON.stringify({
    exe: path.basename(exe),
    icon: path.relative(ROOT, icon),
    iconSha: iconSha,
    exeSha: exeShaAfter,
    exeShaBefore: exeShaBefore,
    sizeBefore: sizeBefore,
    sizeAfter: sizeAfter,
    at: new Date().toISOString()
  }, null, 2) + '\n');

  log('PASSED exe 图标已改写  ' + path.basename(exe) +
    '  ' + sizeBefore + ' → ' + sizeAfter + ' B（+' + (sizeAfter - sizeBefore) + '）');
  log('rcedit: ' + rcedit);
}

main();
