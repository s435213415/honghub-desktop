'use strict';
/* 客户版产物指纹（出包链防返工的单一真相）。
   背景：1.7.87 归档把开发端 exe 当成客户包写进 releases/ 与回滚索引，根因是
   「权威哈希」desktop-setup.exe.sha256 在 build-exe 阶段还是开发端值，archive 只能盲猜。
   现在由 build-client-exe.js 在产出客户版时写指纹（arch/尺寸/哈希/文件名），
   archive-release.js 只认指纹，哈希不符或指纹缺失一律拒绝归档，不再猜。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  let n;
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function stampPath(dist, arch) {
  return path.join(dist, 'client', '.client-build-' + (arch || 'x64') + '.json');
}

function stat(file) {
  const st = fs.statSync(file);
  return { file: path.basename(file), size: st.size, sha256: sha256File(file) };
}

/* 写指纹：setup 与 zip 都记真实尺寸与哈希；zip 不存在则不写 zip 字段（--skip-zip 场景） */
function write(dist, arch, ver, setupPath, zipPath) {
  const obj = { schema: 1, arch: arch, version: ver, builtAt: new Date().toISOString() };
  try { obj.setup = stat(setupPath); } catch (e) { throw new Error('写指纹失败（Setup 不可读）：' + e.message); }
  if (zipPath && fs.existsSync(zipPath)) {
    try { obj.zip = stat(zipPath); } catch (e) { /* zip 可选 */ }
  }
  const p = stampPath(dist, arch);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return obj;
}

function read(dist, arch) {
  const p = stampPath(dist, arch);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/* 校验某文件是否就是指纹记录的那一个客户版产物。
   返回 { ok, reason, size, sha256 }，reason 直接可打印给人和日志看。 */
function verify(stamp, file) {
  if (!stamp) return { ok: false, reason: '缺少客户版指纹（先跑 scripts/build-client-exe.js）' };
  if (!stamp.setup || !stamp.setup.sha256) return { ok: false, reason: '指纹里没有 Setup 记录' };
  if (!fs.existsSync(file)) return { ok: false, reason: '文件不存在：' + file };
  const st = fs.statSync(file);
  if (st.size !== Number(stamp.setup.size)) {
    return { ok: false, reason: '体积不符（文件 ' + st.size + ' B ≠ 指纹 ' + stamp.setup.size + ' B）' };
  }
  const sha = sha256File(file);
  if (sha !== String(stamp.setup.sha256).toLowerCase()) {
    const show = (h) => h.slice(0, 12) + '…' + h.slice(-8);
    return { ok: false, reason: 'SHA256 不符（文件 ' + show(sha) + ' ≠ 指纹 ' + show(String(stamp.setup.sha256).toLowerCase()) + '）', size: st.size, sha256: sha };
  }
  return { ok: true, size: st.size, sha256: sha };
}

module.exports = { sha256File, stampPath, write, read, verify, stat };
