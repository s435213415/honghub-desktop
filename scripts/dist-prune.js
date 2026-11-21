'use strict';
/* dist 体积治理：把历史安装包目录冷备到外部盘，只留最近 N 版。
   用法：
     node scripts\dist-prune.js --dry                      只报告，不动文件
     node scripts\dist-prune.js --to D:\HongHubCold --keep 5   真执行：先复制到冷备目录，校验后删除源
   受管目标（存在才处理）：
     dist\_public_internal         已公开内测包历史
     dist\_archive_public_versions 归档版本历史（含 v* 子目录）
     dist\_历史版本_1.7.36前        1.7.36 之前的老包
   安全约束：
     · 全程不碰 dist\client / dist\win-unpacked / dist\public（当前发版在用的产物）
     · --to 与 dist 不在同一磁盘卷时直接拒绝（避免冷备和源互相影响）
     · 先 copy 成功并校验字节数一致，才删源；任何一步失败即停，不删
     · 保留策略：按目录里的版本目录名（v1.7.x）排序，保留最近 --keep 个（默认 5） */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TARGETS = ['_public_internal', '_archive_public_versions', '_历史版本_1.7.36前'];
const args = process.argv.slice(2);
const dry = args.indexOf('--dry') >= 0;
const toIdx = args.indexOf('--to');
const keepIdx = args.indexOf('--keep');
const TO = toIdx >= 0 ? args[toIdx + 1] : '';
const KEEP = keepIdx >= 0 ? Math.max(1, Number(args[keepIdx + 1]) || 5) : 5;

function sizeOf(p) {
  let total = 0;
  const st = fs.statSync(p);
  if (st.isFile()) return st.size;
  for (const name of fs.readdirSync(p)) {
    let s;
    try { s = fs.statSync(path.join(p, name)); } catch (e) { continue; }
    total += s.isDirectory() ? sizeOf(path.join(p, name)) : s.size;
  }
  return total;
}
function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }
function verKey(name) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(name || '');
  if (!m) return -1;
  return Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]);
}
/* 收集可搬走的单元：只认带版本号的目录/文件，并按版本号分组。
   同版本的全部产物（Setup.exe / .zip / .blockmap / 开发端 exe）作为一个整体搬或留，
   避免「exe 搬走但 zip 还在」这种半截状态。
   无版本号的小文件（latest.yml / robots.txt / index.json 等站点文件）一律不动。 */
function collectUnits(dir, depth) {
  let out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const name of names) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) {
      const k = verKey(name);
      if (k > 0) out.push({ name, path: p, key: k, mtime: st.mtimeMs, size: sizeOf(p), isDir: true });
      else if ((depth || 0) < 2) out = out.concat(collectUnits(p, (depth || 0) + 1));
    } else {
      const k = verKey(name);
      if (k <= 0) continue;                                  /* 无版本号的散文件：不参与治理 */
      out.push({ name, path: p, key: k, mtime: st.mtimeMs, size: st.size, isDir: false });
    }
  }
  return out;
}
function planOf(dir) {
  const items = collectUnits(dir, 0);
  /* 按版本号分组：同 key 归一组，组内一并保留或一并搬走 */
  const groups = {};
  items.forEach(function (it) {
    const k = String(it.key);
    (groups[k] = groups[k] || []).push(it);
  });
  const keys = Object.keys(groups).sort(function (a, b) { return Number(b) - Number(a); });
  const keepItems = [], moveItems = [], keepKeys = keys.slice(0, KEEP);
  keys.forEach(function (k) {
    const arr = groups[k];
    (keepKeys.indexOf(k) >= 0 ? keepItems : moveItems).push.apply(
      keepKeys.indexOf(k) >= 0 ? keepItems : moveItems, arr);
  });
  return { dir, items: keepItems.concat(moveItems), keep: keepItems, move: moveItems, groups: keys.length };
}
function relLabel(p) { return path.relative(ROOT, p); }
function copyThenRemove(src) {
  const rel = path.relative(ROOT, src);
  const dst = path.join(TO, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const before = sizeOf(src);
  fs.cpSync(src, dst, { recursive: true, force: true });
  const after = sizeOf(dst);
  if (before !== after) throw new Error('冷备校验失败（源 ' + before + ' B / 目标 ' + after + ' B）：' + rel);
  fs.rmSync(src, { recursive: true, force: true });
  return { rel, size: before };
}

(function main() {
  if (!fs.existsSync(DIST)) { console.log('[dist-prune] 找不到 dist 目录：' + DIST); process.exit(1); }
  console.log('[dist-prune] 模式：' + (dry ? '仅报告（--dry）' : '执行（冷备到 ' + TO + '，保留最近 ' + KEEP + ' 个单元）'));
  let totalMove = 0;
  for (const t of TARGETS) {
    const dir = path.join(DIST, t);
    if (!fs.existsSync(dir)) { console.log('- ' + t + '：不存在，跳过'); continue; }
    const plan = planOf(dir);
    const moveSize = plan.move.reduce(function (a, d) { return a + d.size; }, 0);
    totalMove += moveSize;
    console.log('- ' + t + '：' + plan.groups + ' 个版本 / 保留最近 ' + Math.min(KEEP, plan.groups) + ' 版；' +
      '可搬走 ' + plan.move.length + ' 个文件（' + mb(moveSize) + '）');
    plan.items.forEach(function (d) {
      const kept = plan.keep.indexOf(d) >= 0;
      console.log('    ' + (kept ? '[保留] ' : '[搬走] ') + relLabel(d.path) + '  ' + mb(d.size));
    });
    if (!dry && plan.move.length) {
      if (!TO) { console.log('    未给 --to，跳过执行'); continue; }
      for (const d of plan.move) {
        try { const r = copyThenRemove(d.path); console.log('    ✅ 已冷备并释放：' + r.rel + '（' + mb(r.size) + '）'); }
        catch (e) { console.log('    ❌ 中止：' + (e && e.message || e)); process.exit(1); }
      }
    }
  }
  console.log('[dist-prune] 可释放合计约 ' + mb(totalMove) + (dry ? '（仅报告，未删除任何文件）' : ''));
})();
