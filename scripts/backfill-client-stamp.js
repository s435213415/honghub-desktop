#!/usr/bin/env node
'use strict';
/* 为「已出包但没有客户版指纹」的版本补写指纹（1.7.87 之前的历史版本用）。
   只对 dist/client 下真实存在的客户产物写记录，不做任何猜测：
   补写后立刻按指纹回校验一遍，对不上就报错退出，不写。
   用法：node scripts/backfill-client-stamp.js [--version 1.7.87] */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const stamp = require('./lib/client-stamp');

const args = process.argv.slice(2);
const vIdx = args.indexOf('--version');
let V = vIdx >= 0 ? String(args[vIdx + 1] || '') : '';
if (!V) {
  try { V = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'manifest.json'), 'utf8')).release.latest.versionName); } catch (e) {}
}
if (!V) { console.error('取不到版本号'); process.exit(1); }

let n = 0, bad = 0;
for (const arch of ['x64', 'arm64']) {
  const suffix = arch === 'arm64' ? '-arm64' : '';
  const setup = path.join(DIST, 'client', '鸿汇影桌面版 Setup ' + V + suffix + '.exe');
  const zip = path.join(DIST, 'client', '鸿汇影免安装 ' + V + suffix + '.zip');
  if (!fs.existsSync(setup)) { console.log('  ' + arch + '：dist/client 无产物，跳过'); continue; }
  const old = stamp.read(DIST, arch);
  if (old && String(old.version) === V) {
    const vr = stamp.verify(old, setup);
    if (vr.ok) { console.log('  ' + arch + '：指纹已存在且一致，跳过'); continue; }
  }
  const s = stamp.write(DIST, arch, V, setup, fs.existsSync(zip) ? zip : null);
  const vr = stamp.verify(s, setup);
  if (!vr.ok) { bad++; console.error('  ✗ ' + arch + ' 补写后回校验失败：' + vr.reason); continue; }
  n++;
  console.log('  ✔ ' + arch + ' 指纹已写：' + vr.size + ' B · ' + vr.sha256.slice(0, 16) + '…' +
    (s.zip ? ' · zip ' + s.zip.size + ' B' : ''));
}
console.log('补写完成：' + n + ' 个架构' + (bad ? '，' + bad + ' 个失败' : ''));
process.exit(bad ? 1 : 0);
