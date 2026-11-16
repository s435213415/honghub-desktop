'use strict';
/* 运行日志轮转：*.jsonl 超过阈值自动切分并 gzip 归档，避免长期运行把磁盘吃满。
   服务内的内存数组由 server.js 的 MAX_KEEP 独立限制，两者互不干扰。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA = path.join(__dirname, 'data');
const MAX_BYTES = Math.max(1024 * 256, Number(process.env.KH_LOG_MAX_BYTES || 5 * 1024 * 1024));
const MAX_FILES = Math.max(1, Number(process.env.KH_LOG_KEEP || 3));

function rotateOne(file) {
  const size = fs.statSync(file).size;
  if (size < MAX_BYTES) return null;
  const base = file.replace(/\.jsonl$/, '');
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const older = base + '.jsonl.' + i + '.gz';
    const newer = base + '.jsonl.' + (i + 1) + '.gz';
    if (fs.existsSync(older)) {
      if (i + 1 >= MAX_FILES) { try { fs.unlinkSync(older); } catch (e) {} }
      else fs.renameSync(older, newer);
    }
  }
  const raw = fs.readFileSync(file);
  fs.writeFileSync(base + '.jsonl.1.gz', zlib.gzipSync(raw));
  fs.writeFileSync(file, '');   // 后续 appendFileSync 会打开新 fd，不会写穿归档
  return { file: path.basename(file), bytes: size, archived: path.basename(base) + '.jsonl.1.gz' };
}

function rotate(dir) {
  const target = dir || DATA;
  if (!fs.existsSync(target)) return { ok: true, rotated: [] };
  const rotated = [];
  for (const name of fs.readdirSync(target)) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const r = rotateOne(path.join(target, name));
      if (r) rotated.push(r);
    } catch (e) { /* 单个日志轮转失败不影响服务 */ }
  }
  return { ok: true, rotated, maxBytes: MAX_BYTES, keep: MAX_FILES };
}

function start() {
  rotate();
  const t = setInterval(() => rotate(), 10 * 60 * 1000);
  if (t.unref) t.unref();
  return t;
}

module.exports = { rotate, start };
