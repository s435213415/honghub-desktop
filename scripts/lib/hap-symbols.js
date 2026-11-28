'use strict';
/* HAP 包内容原生符号核查（1.7.87 教训的固化）。
   背景：harmony/build_hap.py 只做前端注入、不编译 ArkTS，所以「源码改了但没跑 hvigor」时
   HAP 版本号与哈希都自洽，签名与验收全过，原生改动却根本没进包。
   现在签名后按符号清单逐条搜包内 .abc/.ets/.js/.json 字节流，缺一条就 exit 1。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const zipRead = require('./zip-read');

const DEFAULT_SYMBOLS = ['openVideo'];
const TEXT_EXT = ['.abc', '.ets', '.ts', '.js', '.json', '.bin', '.so', '.xml', '.yaml'];

/* 清单来源：harmony/required-symbols.txt（每行一个，# 开头为注释） ∪ 默认清单 */
function loadSymbols(root) {
  const list = new Set(DEFAULT_SYMBOLS);
  const p = path.join(root, 'harmony', 'required-symbols.txt');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      list.add(s);
    }
  }
  return Array.from(list);
}

function entryData(buf, e) {
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) {
    try { return zlib.inflateRawSync(raw); } catch (err) { return null; }
  }
  return null;
}

/* 一次读完包内所有文本/二进制候选条目，返回每条符号是否命中及命中位置 */
function check(hapFile, symbols) {
  const list = symbols && symbols.length ? symbols : DEFAULT_SYMBOLS;
  const { buf, out } = zipRead.entries(hapFile);
  const targets = out.filter(e => TEXT_EXT.some(ext => e.name.toLowerCase().endsWith(ext)));
  const found = list.map(() => false);
  const hits = list.map(() => []);
  for (const e of targets) {
    const d = entryData(buf, e);
    if (!d) continue;
    for (let i = 0; i < list.length; i++) {
      if (found[i]) continue;
      if (d.includes(Buffer.from(list[i], 'utf8'))) { found[i] = true; hits[i].push(e.name); }
    }
    if (found.every(Boolean)) break;
  }
  return {
    symbols: list,
    found, hits, entries: targets.length,
    missing: list.filter((s, i) => !found[i])
  };
}

module.exports = { DEFAULT_SYMBOLS, loadSymbols, check };
