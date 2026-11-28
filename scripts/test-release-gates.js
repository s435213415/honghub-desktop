#!/usr/bin/env node
'use strict';
/* 出包链门禁自测（台账 #159）：不碰真实产物，全部在临时目录造场景。
   覆盖：
     1. 客户版指纹 write/read/verify（正常 / 字节被换 / 体积被换 / 指纹缺失）
     2. HAP 包内符号检查（含符号 / 不含符号 / 压缩条目）
     3. ArkTS 源码新鲜度（源码更新 / 源码更旧 / 壳包缺失）
     4. 真实仓库产物一致性总检（集成项：当前 1.7.87 必须 0 失败）
   用法：node scripts/test-release-gates.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-gates-'));
let pass = 0, fail = 0;
function eq(cond, name, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '：' + detail : '')); }
}
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
function touch(p, content, mtimeMs) {
  fs.writeFileSync(p, content);
  if (mtimeMs) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
}

/* —— 最小 ZIP 写出（stored），只为造 HAP 场景 —— */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function writeZip(file, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data);
    const nameBuf = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);          // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc32(data), 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cenStart = offset;
  const cenAll = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenAll.length, 12);
  eocd.writeUInt32LE(cenStart, 16);
  fs.writeFileSync(file, Buffer.concat([Buffer.concat(chunks), cenAll, eocd]));
}

/* —— 1) 客户版指纹 —— */
console.log('\n[1] 客户版指纹 client-stamp');
const stamp = require('./lib/client-stamp');
const dist = mkdir(path.join(TMP, 'dist'));
mkdir(path.join(dist, 'client'));
const setup = path.join(dist, 'client', '鸿汇影桌面版 Setup 9.9.9.exe');
touch(setup, Buffer.alloc(1024, 7));
const st = stamp.write(dist, 'x64', '9.9.9', setup, null);
eq(stamp.read(dist, 'x64') && stamp.read(dist, 'x64').setup.size === 1024, '写指纹后可读回，记录体积正确');
let v = stamp.verify(stamp.read(dist, 'x64'), setup);
eq(v.ok && v.sha256 === st.setup.sha256, '正常产物校验通过');
touch(setup, Buffer.alloc(1024, 8));
v = stamp.verify(stamp.read(dist, 'x64'), setup);
eq(!v.ok && /SHA256/.test(v.reason), '同体积换内容 → 判 SHA256 不符', v.reason);
touch(setup, Buffer.alloc(2048, 8));
v = stamp.verify(stamp.read(dist, 'x64'), setup);
eq(!v.ok && /体积/.test(v.reason), '换体积 → 判体积不符', v.reason);
v = stamp.verify(null, setup);
eq(!v.ok && /指纹/.test(v.reason), '指纹缺失 → 拒绝归档', v.reason);
const otherArch = stamp.write(dist, 'arm64', '9.9.9', setup, null);
eq(otherArch.arch === 'arm64' && fs.existsSync(stamp.stampPath(dist, 'arm64')), 'arm64 指纹独立落盘，不覆盖 x64');

/* —— 2) HAP 包内符号 —— */
console.log('\n[2] HAP 包内符号 hap-symbols');
const sym = require('./lib/hap-symbols');
const hapA = path.join(TMP, 'with-symbol.hap');
writeZip(hapA, [
  { name: 'ets/modules.abc', data: Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('openVideo startAbility', 'utf8')]) },
  { name: 'module.json', data: Buffer.from('{"name":"x"}') },
  { name: 'resources/rawfile/www/index.html', data: Buffer.from('<html>') }
]);
let s = sym.check(hapA, ['openVideo']);
eq(!s.missing.length && s.hits[0].includes('ets/modules.abc'), '含符号包 → 命中且记录条目名');
const hapB = path.join(TMP, 'no-symbol.hap');
writeZip(hapB, [
  { name: 'ets/modules.abc', data: Buffer.from('khExternal.play only', 'utf8') },
  { name: 'module.json', data: Buffer.from('{"name":"x"}') }
]);
s = sym.check(hapB, ['openVideo']);
eq(s.missing.length === 1 && s.missing[0] === 'openVideo', '缺符号包 → 报 missing，签名应拒绝');
s = sym.check(hapA, ['openVideo', 'notThere']);
eq(s.missing.join() === 'notThere', '多符号清单 → 只报真正缺的那条');
eq(sym.loadSymbols(ROOT).includes('openVideo'), '默认清单含 openVideo');

/* —— 3) HAP 源码新鲜度 —— */
console.log('\n[3] ArkTS 源码新鲜度 hap-fresh');
const fresh = require('./lib/hap-fresh');
const etsDir = mkdir(path.join(TMP, 'ets'));
touch(path.join(etsDir, 'Index.ets'), 'openVideo', Date.now() - 3600 * 1000);
const shell = path.join(TMP, 'shell.hap');
touch(shell, 'shell', Date.now());
let fr = fresh.checkFresh(etsDir, shell);
eq(fr.ok && fr.code === 'fresh', '源码早于壳包 → 新鲜');
touch(path.join(etsDir, 'Index.ets'), 'openVideo v2', Date.now() + 60 * 1000);
fr = fresh.checkFresh(etsDir, shell);
eq(!fr.ok && fr.code === 'stale', '源码晚于壳包 → 判过期（签名应拒绝）', fr.reason);
fr = fresh.checkFresh(etsDir, path.join(TMP, 'nope.hap'));
eq(!fr.ok && fr.code === 'shell-missing', '壳包缺失 → 拒绝');
touch(path.join(etsDir, 'Index.ets'), 'openVideo', Date.now());
fr = fresh.checkFresh(etsDir, shell, 5000);
eq(fr.ok, '容差内（5 秒）不误判');

/* —— 4) 真实产物一致性总检（集成） —— */
console.log('\n[4] 真实仓库产物一致性 check-artifacts');
const ca = require('./check-artifacts');
const r = ca.run({ quiet: true });
eq(r.code === 0, '当前仓库产物一致性 0 失败', r.fails.slice(0, 4).join('；'));

/* 清理 */
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log('\n门禁自测：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
