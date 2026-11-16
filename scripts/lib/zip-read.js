'use strict';
/* 零依赖只读 ZIP 条目解析（HAP / hap 包内资源核查用）。
   支持 stored(0) 与 deflate(8)，不写盘、不引入第三方包。 */
const fs = require('fs');
const zlib = require('zlib');

function entries(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  const min = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效 ZIP/HAP：' + file);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    out.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, out };
}

function readEntry(file, wanted) {
  const { buf, out } = entries(file);
  const e = out.find(x => x.name === wanted);
  if (!e) throw new Error('包内缺少条目：' + wanted);
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error('不支持的压缩方式：' + e.method);
}

function readText(file, wanted, encoding) {
  return readEntry(file, wanted).toString(encoding || 'utf8');
}

module.exports = { entries, readEntry, readText };
