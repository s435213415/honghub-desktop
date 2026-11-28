#!/usr/bin/env node
/* 二维码编码自测（台账 #171 · 1.7.94 · 清单 #65）
   验四件事：UTF-8 字节化与容量表（版本 1–10，纠错 M）；Reed-Solomon 校验码字满足
   「综合征全为 0」的数学性质（独立实现 GF 求值，不复用被测代码的 rsEncode 内部）；
   矩阵结构（尺寸、三个定位图案、时序图案、暗模块、无空洞、格式信息两处副本一致）；
   容量边界（恰好装满 / 超出 1 字节 / 超长）。
   不碰真实产物、不写仓库文件。
   用法：node scripts/test-qr-kit.js  → 末行给出通过/失败计数，退出码即结果。 */
'use strict';

const path = require('path');
const QR = require(path.join(__dirname, '..', 'app', 'kh-qr.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  \u2716 ' + name + (detail ? ' — ' + detail : '')); }
}

/* 独立 GF(256)（多项式 0x11D），只用于验算综合征 */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
  for (let j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
})();
function mul(a, b) { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }
function syndromes(words, ecLen) {
  const out = [];
  for (let i = 0; i < ecLen; i++) {
    let s = 0;
    for (let j = 0; j < words.length; j++) s = mul(s, EXP[i]) ^ words[j];
    out.push(s);
  }
  return out;
}

function main() {
  console.log('\n[1] UTF-8 与容量表');
  ok('ASCII 逐字节', QR.utf8Bytes('AB').join(',') === '65,66');
  ok('中文 3 字节', QR.utf8Bytes('鸿').length === 3, QR.utf8Bytes('鸿').length);
  ok('emoji 4 字节', QR.utf8Bytes('🎬').length === 4, QR.utf8Bytes('🎬').length);
  ok('空串 0 字节', QR.utf8Bytes('').length === 0);
  ok('v1 容量 14 字节', QR.capacity(1) === 14, QR.capacity(1));
  ok('v2 容量 26 字节', QR.capacity(2) === 26, QR.capacity(2));
  ok('v5 容量 84 字节', QR.capacity(5) === 84, QR.capacity(5));
  ok('v10 容量 213 字节', QR.capacity(10) === 213, QR.capacity(10));
  ok('容量随版本单调增', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((v, i, a) => i === 0 || QR.capacity(v) > QR.capacity(a[i - 1])));
  ok('恰好 14 字节选 v1', QR.pickVersion(14) === 1);
  ok('15 字节选 v2', QR.pickVersion(15) === 2);
  ok('213 字节选 v10', QR.pickVersion(213) === 10);
  ok('214 字节选不出', QR.pickVersion(214) === 0);

  console.log('\n[2] Reed-Solomon 综合征（独立求值，应全 0）');
  const cases = [{ v: 1, d: 16 }, { v: 3, d: 44 }, { v: 5, d: 43 }, { v: 7, d: 31 }, { v: 10, d: 44 }];
  const ecByVer = { 1: 10, 3: 26, 5: 24, 7: 18, 10: 26 };
  let rsBad = 0;
  for (const c of cases) {
    const data = [];
    for (let i = 0; i < c.d; i++) data.push((i * 37 + c.v * 11 + 5) & 0xFF);
    const ec = QR.rsEncode(data, ecByVer[c.v]);
    const words = data.concat(ec);
    const syn = syndromes(words, ecByVer[c.v]);
    if (ec.length !== ecByVer[c.v] || syn.some((s) => s !== 0)) { rsBad++; console.log('    版本 ' + c.v + ' 综合征：' + JSON.stringify(syn)); }
  }
  ok('五档块长度校验码字满足 Syndrome=0', rsBad === 0, rsBad ? rsBad + ' 档失败' : '');
  const ecZero = QR.rsEncode(new Array(16).fill(0), 10);
  ok('全零数据校验码字也为零', ecZero.every((x) => x === 0), JSON.stringify(ecZero));

  console.log('\n[3] 矩阵结构');
  const r = QR.encode('https://honghub.example/s/8a3f2c1d');
  ok('编码成功', r.ok === true, r.error);
  ok('尺寸 = 17 + 4v', r.size === 17 + 4 * r.version, r.size + ' / v' + r.version);
  ok('掩码在 0–7', r.mask >= 0 && r.mask <= 7);
  ok('单元格全布尔', r.modules.every((row) => row.length === r.size && row.every((v) => typeof v === 'boolean')));
  /* 定位图案：左上角 (0,0) 应为深 7×7 外框 + 3×3 中心 */
  function finderAt(r0, c0) {
    for (let dr = 0; dr < 7; dr++) for (let dc = 0; dc < 7; dc++) {
      const dark = (dr === 0 || dr === 6 || dc === 0 || dc === 6) || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      if (r.modules[r0 + dr][c0 + dc] !== dark) return false;
    }
    return true;
  }
  ok('左上定位图案', finderAt(0, 0));
  ok('右上定位图案', finderAt(0, r.size - 7));
  ok('左下定位图案', finderAt(r.size - 7, 0));
  ok('定位图案分隔带为浅', r.modules[7][7] === false && r.modules[7][r.size - 8] === false && r.modules[r.size - 8][7] === false);
  let timingBad = 0;
  for (let i = 8; i < r.size - 8; i++) {
    if (r.modules[6][i] !== (i % 2 === 0)) timingBad++;
    if (r.modules[i][6] !== (i % 2 === 0)) timingBad++;
  }
  ok('横竖时序图案交替', timingBad === 0, timingBad + ' 处不符');
  ok('暗模块固定深色', r.modules[r.size - 8][8] === true);
  let holes = 0;
  for (let i = 0; i < r.size; i++) for (let j = 0; j < r.size; j++) if (r.modules[i][j] === null) holes++;
  ok('无未填充格子', holes === 0, holes + ' 个空洞');

  console.log('\n[4] 格式信息');
  /* 格式信息 15 位：左上（沿第 8 行 / 第 8 列）与右上 / 左下两处副本必须一致 */
  function readFormatLeft(m, n) {
    let bits = 0;
    for (let i = 0; i <= 5; i++) bits |= (m[8][i] ? 1 : 0) << i;
    bits |= (m[8][7] ? 1 : 0) << 6;
    bits |= (m[8][8] ? 1 : 0) << 7;
    bits |= (m[7][8] ? 1 : 0) << 8;
    for (let j = 9; j <= 14; j++) bits |= (m[14 - j][8] ? 1 : 0) << j;
    return bits;
  }
  function readFormatCopy(m, n) {
    let bits = 0;
    for (let k = 0; k <= 6; k++) bits |= (m[n - 1 - k][8] ? 1 : 0) << k;
    for (let p = 7; p <= 14; p++) bits |= (m[8][n - 15 + p] ? 1 : 0) << p;
    return bits;
  }
  const fLeft = readFormatLeft(r.modules, r.size), fCopy = readFormatCopy(r.modules, r.size);
  ok('两处格式信息一致', fLeft === fCopy, fLeft + ' / ' + fCopy);
  ok('格式信息等于按掩码计算值', fLeft === QR.formatBits(r.mask), fLeft + ' / ' + QR.formatBits(r.mask));
  const fmt = QR.formatBits(0);
  ok('格式位 15 位以内', fmt >= 0 && fmt < 32768, fmt);
  /* BCH 自检：去掩码后应被生成多项式 0x537 整除 */
  let v = (QR.formatBits(3) ^ 0x5412);
  for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10);
  ok('BCH 余数为 0', (v & 0x3FF) === 0, v);

  console.log('\n[5] 版本信息（v7 起）与容量边界');
  const big = QR.encode('https://honghub.example/download/honghub-1.7.94-x64.zip?sig=' + 'a'.repeat(90));
  ok('长链接自动上到高版本', big.ok && big.version >= 7, big.ok ? 'v' + big.version : big.error);
  if (big.ok) {
    /* 版本信息 BCH(18,6)：两处副本一致，且能被 0x1F25 整除 */
    const n = big.size, ver = big.version;
    let a = 0, b = 0;
    for (let k = 0; k < 18; k++) {
      const bit = (Math.floor(k / 3));
      a |= (big.modules[n - 11 + (k % 3)][bit] ? 1 : 0) << k;
      b |= (big.modules[bit][n - 11 + (k % 3)] ? 1 : 0) << k;
    }
    ok('版本信息两处一致', a === b, a + ' / ' + b);
    let tv = a;
    for (let i = 17; i >= 12; i--) if ((tv >> i) & 1) tv ^= 0x1F25 << (i - 12);
    ok('版本信息 BCH 余数为 0', (tv & 0xFFF) === 0, tv);
    ok('版本信息高位等于版本号', (a >> 12) === ver, (a >> 12) + ' / ' + ver);
  }
  const full = QR.encode('a'.repeat(14));
  ok('v1 恰好装满', full.ok === true && full.version === 1, full.ok ? 'v' + full.version : full.error);
  const over = QR.encode('a'.repeat(15));
  ok('v1 多 1 字节自动升版', over.ok === true && over.version === 2, over.ok ? 'v' + over.version : over.error);
  const tooLong = QR.encode('a'.repeat(214));
  ok('超出 10 版容量报错', tooLong.ok === false && /过长|超出/.test(tooLong.error), tooLong.error);
  ok('指定版本容量不足报错', QR.encode('a'.repeat(20), { version: 1 }).ok === false);
  ok('中文链接可编码', QR.encode('https://鸿汇影.example/s/测试').ok === true);
  ok('info 汇总可用', (function () { const i = QR.info('hi'); return i.ok && i.size === 21 && i.version === 1; })());
  ok('空串可编码且尺寸最小', (function () { const e = QR.encode(''); return e.ok && e.size === 21; })());

  console.log('\n' + (fail ? '\u2716 ' : '\u2714 ') + '通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
}

main();
