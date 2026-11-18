#!/usr/bin/env node
'use strict';
/* 旧版本自动归档：把 dist 根里非当前版本的历史 exe/zip 移入
   dist/_archive_public_versions/v<版本>/，dist 根只留当前版本产物，根治 dist 膨胀。
   * 用 rename 移动（同盘瞬时、可回滚），绝不物理删除。
   * 只认精确版本号命名，绝不碰 desktop-setup.exe 别名 / win-unpacked / public / client / 签名材料。
   * 归档后同步修正 releases/index.json 里 historical 条目的路径，避免索引指向已移走的文件。
   用法：
     node scripts/prune-and-archive.js         执行归档
     node scripts/prune-and-archive.js --dry   只预览，不动文件
   串在 archive-release.js 之后（oneclick 5.6 步）由 release.js 之后的主流程调用。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARCHIVE = path.join(DIST, '_archive_public_versions');
const REL_INDEX = path.join(ROOT, 'releases', 'index.json');
const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[prune-archive] ' + a.join(' '));

function currentVersion() {
  try { return String(JSON.parse(fs.readFileSync(path.join(DIST, 'release.json'), 'utf8')).versionName || ''); }
  catch (e) { return ''; }
}

// 只匹配这三种历史产物（客户 Setup / 开发端 / 免安装 zip），精确到版本号
// 兼容两种命名：dist 根「鸿汇影桌面版 Setup/开发端 X.exe」与 client「鸿汇影桌面版 Setup X.exe / 鸿汇影免安装 X.zip」
const NAME_RE = /^(?:鸿汇影桌面版 (?:Setup|开发端)|鸿汇影免安装) (\d+\.\d+\.\d+)\.(exe|zip)$/;

function main() {
  const cur = currentVersion();
  if (!cur) { log('✗ 读不到当前版本，拒绝归档'); process.exit(1); }
  const moved = [];
  // 扫描 dist 根 + dist/client（客户版产物目录）两处历史产物
  const sources = [DIST, path.join(DIST, 'client')];
  for (const dir of sources) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names) {
      const m = NAME_RE.exec(name);
      if (!m) continue;
      const ver = m[1];
      if (ver === cur) continue; // 当前版本留在原处
      const src = path.join(dir, name);
      let st;
      try { st = fs.statSync(src); } catch (e) { continue; }
      if (!st.isFile()) continue;
      const destDir = path.join(ARCHIVE, 'v' + ver);
      const dest = path.join(destDir, name);
      if (fs.existsSync(dest)) {
        const ds = fs.statSync(dest);
        if (ds.size === st.size) { log('  跳过（已归档）' + name); continue; }
        // 目标已存在但大小不同（同版本不同构建，如 client 的客户版 vs dist 根的版本）：
        // 不覆盖已有归档，改放 v<ver>/from-<来源>/ 子目录，两侧都保留可回滚。
        const altDir = path.join(destDir, 'from-' + path.basename(dir));
        const alt = path.join(altDir, name);
        if (fs.existsSync(alt) && fs.statSync(alt).size === st.size) { log('  跳过（已归档于子目录）' + name); continue; }
        moved.push({ name, ver, src, dest: alt, destDir: altDir, size: st.size, from: path.basename(dir) });
        continue;
      }
      moved.push({ name, ver, src, dest, destDir, size: st.size, from: path.basename(dir) });
    }
  }

  if (!moved.length) { log('✓ 无需归档，dist 根只有当前版本 v' + cur); return; }

  let bytes = 0;
  for (const it of moved) {
    bytes += it.size;
    const tag = it.from === 'client' ? ' [client]' : '';
    if (DRY) { log('  [dry]' + tag + ' ' + it.name + ' → _archive_public_versions/v' + it.ver + '/ (' + (it.size / 1048576).toFixed(1) + ' MB)'); continue; }
    fs.mkdirSync(it.destDir, { recursive: true });
    fs.renameSync(it.src, it.dest);
    log('  归档' + tag + ' ' + it.name + ' → v' + it.ver + '/ (' + (it.size / 1048576).toFixed(1) + ' MB)');
  }
  if (DRY) { log('[dry] 共 ' + moved.length + ' 个文件 / ' + (bytes / 1048576).toFixed(0) + ' MB 待归档'); return; }

  // 修正 releases/index.json 里 historical 条目：路径从 dist/ 改到归档目录
  fixIndex(moved);
  log('✓ 归档完成：' + moved.length + ' 个文件 / ' + (bytes / 1048576).toFixed(0) + ' MB 移出 dist 根');
  log('  dist 根仅留当前版本 v' + cur + '；归档可回滚于 ' + path.relative(ROOT, ARCHIVE));
}

function fixIndex(moved) {
  try {
    if (!fs.existsSync(REL_INDEX)) return;
    const idx = JSON.parse(fs.readFileSync(REL_INDEX, 'utf8'));
    let changed = 0;
    for (const v of (idx.versions || [])) {
      if (!v.historical) continue;
      const d = v.artifacts && v.artifacts.desktop;
      if (!d || typeof d.path !== 'string' || d.path.indexOf('dist/') !== 0) continue;
      const name = path.basename(d.path);
      const hit = moved.find(x => x.name === name);
      if (!hit) continue;
      const rel = 'dist/_archive_public_versions/v' + hit.ver + '/' + name;
      d.path = rel;
      v.dir = 'dist/_archive_public_versions/v' + hit.ver;
      if (v.downloadUrl) v.downloadUrl = '/download/archive/' + encodeURIComponent(name);
      changed++;
    }
    if (changed) {
      fs.writeFileSync(REL_INDEX, JSON.stringify(idx, null, 2) + '\n');
      log('  回滚索引已更新 ' + changed + ' 条历史路径 → 归档目录');
    }
  } catch (e) { log('  ⚠ 回滚索引更新失败（不影响归档）：' + (e && e.message || e)); }
}

main();
