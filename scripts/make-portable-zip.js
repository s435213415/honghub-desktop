#!/usr/bin/env node
'use strict';
/* 生成客户免安装包（dist/鸿汇影桌面版 Setup <ver>.zip）。
 * 独立成一步的原因：build-exe.js 里的 -mx=9 极端压缩在本机曾把 108 MB 目录压到一半就卡死，
 * 一键流水线改用 -mx=3（速度快 3~5 倍，体积只大 2% 左右），并可单独重跑。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const unpacked = path.join(DIST, 'win-unpacked');
const zip = path.join(DIST, '鸿汇影桌面版 Setup ' + ver + '.zip');

if (!fs.existsSync(unpacked)) { console.error('缺少 dist/win-unpacked，先跑出包'); process.exit(1); }
const seven = [
  path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
  path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'ia32', '7za.exe')
].find(function (p) { return fs.existsSync(p); });
if (!seven) { console.error('找不到 7za.exe'); process.exit(1); }
if (fs.existsSync(zip)) fs.rmSync(zip, { force: true });

console.log('压缩 ' + path.basename(zip) + ' …（-mx=3）');
const r = spawnSync(seven, ['a', '-tzip', '-mx=3', '-bso0', '-bsp0', zip, unpacked], { stdio: 'inherit' });
if (r.status !== 0 || !fs.existsSync(zip)) { console.error('免安装包生成失败'); process.exit(1); }
const size = fs.statSync(zip).size;
const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
console.log('  ' + path.basename(zip) + ' · ' + size.toLocaleString('en-US') + ' B · sha256 ' + sha.slice(0, 16) + '…');
