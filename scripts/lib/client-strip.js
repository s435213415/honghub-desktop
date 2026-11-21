'use strict';
/* 客户包开发端资产剥离（#99 纯净性加固）。
   被 build-client-exe.js 在打客户包前调用，作用于 win-unpacked 解包目录；仓库源码不动。

   剥离范围：
   - 12 个 *-admin.html 运维面板：仅 /admin 路由 readFileSync 读取，不被 require，删除不影响启动。
   - server/data 历史运行痕迹：snapshots / catalog-backups 整目录删除；data 根目录只保留
     白名单内的种子/状态 JSON，其余历史日志、页面缓存、备份快照、报告周报一律删除
     （运行时缺文件均有 try-catch 回退，可按需重建）。

   注意：server 模块 .js 因 server.js 顶层强 require，本模块不删除；对应开发接口已由
   DEV_MODE 关闭时 404 门控。后续若要连 .js 一并裁剪，需先把顶层 require 改为惰性可选。 */
const fs = require('fs');
const path = require('path');

const DATA_KEEP = new Set([
  'catalog.json', 'source-pool.json', 'feature-flags.json', 'allow-origins.json',
  'promo-config.json', 'update-channel.json', 'latest_device_optimization.json',
  'latest_bugfix.json', 'latest_govern.json', 'mined_features.json',
  'sources-report.json', 'source-hunt-report.json', 'sources-verify-state.json',
  'catalog-cycle.json', 'handoff.json', 'watchlist.json', 'alerts-config.json'
]);

function stripDevArtifacts(serverDir, log) {
  const say = log || function () {};
  let removed = 0, bytes = 0;
  const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return 0; } };

  // 1) 运维面板静态页
  try {
    for (const f of fs.readdirSync(serverDir)) {
      if (/-admin\.html$/.test(f)) {
        const p = path.join(serverDir, f);
        bytes += sizeOf(p); fs.unlinkSync(p); removed++;
      }
    }
  } catch (e) { say('[裁剪] admin 页面清理：' + (e && e.message || e)); }

  // 2) data 历史目录整删
  const dataDir = path.join(serverDir, 'data');
  try {
    for (const sub of ['snapshots', 'catalog-backups']) {
      const sp = path.join(dataDir, sub);
      if (fs.existsSync(sp)) { fs.rmSync(sp, { recursive: true, force: true }); removed++; }
    }
  } catch (e) { say('[裁剪] data 历史目录清理：' + (e && e.message || e)); }

  // 3) data 根目录：白名单外文件全删
  try {
    if (fs.existsSync(dataDir)) {
      for (const f of fs.readdirSync(dataDir, { withFileTypes: true })) {
        if (f.isDirectory()) continue;
        if (DATA_KEEP.has(f.name)) continue;
        const fp = path.join(dataDir, f.name);
        bytes += sizeOf(fp); fs.unlinkSync(fp); removed++;
      }
    }
  } catch (e) { say('[裁剪] data 历史文件清理：' + (e && e.message || e)); }

  say('[裁剪] 剥离开发端资产：' + removed + ' 项 · ' + bytes + ' B');
  return { removed, bytes };
}

module.exports = { stripDevArtifacts, DATA_KEEP };
