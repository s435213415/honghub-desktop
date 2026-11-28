'use strict';
/* ArkTS 源码 ↔ 壳包新鲜度判定（1.7.87 漏包事故的固化）。
   build_hap.py 只注入前端、不编译 ArkTS，所以「源码改了但没跑 hvigor」时
   签出来的 HAP 版本对、哈希自洽，却没有原生改动。这里给签名脚本和自测共用一份判定。 */
const fs = require('fs');
const path = require('path');

function newestMtime(dir) {
  let newest = 0;
  let files = 0;
  (function walk(d) {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const it of list) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p);
      else {
        try { const st = fs.statSync(p); files++; if (st.mtimeMs > newest) newest = st.mtimeMs; } catch (e) {}
      }
    }
  })(dir);
  return { newest, files };
}

/* toleranceMs：文件系统时间精度容差，避免"同一秒内写入"被误判为过期 */
function checkFresh(etsDir, shellHap, toleranceMs) {
  const tol = Number.isFinite(toleranceMs) ? toleranceMs : 2000;
  if (!fs.existsSync(shellHap)) {
    return { ok: false, code: 'shell-missing', reason: '壳包不存在：' + shellHap };
  }
  if (!fs.existsSync(etsDir)) {
    return { ok: false, code: 'ets-missing', reason: 'ArkTS 源码目录不存在：' + etsDir };
  }
  const ets = newestMtime(etsDir);
  const shellM = fs.statSync(shellHap).mtimeMs;
  if (!ets.files) return { ok: true, code: 'empty', reason: '源码目录为空，跳过', etsNewest: 0, shellMtime: shellM, files: 0 };
  if (ets.newest > shellM + tol) {
    return {
      ok: false, code: 'stale',
      reason: 'ArkTS 源码比壳包新（' + new Date(ets.newest).toLocaleString('zh-CN') + ' > ' +
              new Date(shellM).toLocaleString('zh-CN') + '），原生改动未编译',
      etsNewest: ets.newest, shellMtime: shellM, files: ets.files
    };
  }
  return { ok: true, code: 'fresh', etsNewest: ets.newest, shellMtime: shellM, files: ets.files };
}

module.exports = { newestMtime, checkFresh };
