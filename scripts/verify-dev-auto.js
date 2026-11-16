#!/usr/bin/env node
'use strict';
/* 开发者端自动能力自检（零副作用、随起随停）
   ------------------------------------------------------------------
   验证三条自动化链路在本机开发者端真实可用：
     1. 自动修复 / 自愈   -> /health（auto / govern / diagnostics）+ /api/automation
     2. 自动升级           -> /api/manifest（版本清单 + 产物 SHA256）
     3. 跟踪操作系统       -> /api/device/optimization（设备画像与自动优化下发）
   另检内容热更新 /api/features/sync。
   在随机空闲端口起一次中枢服务，全部接口 HTTP 200 即通过，随后立即退出，
   不占用 8787、不改动任何用户数据。用法：npm run verify:dev-auto
*/
const http = require('http');
const net = require('net');

const pickPort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

(async () => {
  const PORT = await pickPort();
  process.env.PORT = String(PORT);
  // 探活期间拉长公网清单刷新周期，避免无谓的网络请求；不关闭自动化开关，
  // 以便如实反映开发者端默认运行状态（auto.enabled 应为 true）。
  process.env.KH_PUBLIC_REFRESH_MS = '999999999';
  require('../server/server.js');

  const get = (p) => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, (res) => {
      let s = '';
      res.on('data', (d) => s += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(s) }); }
        catch (e) { resolve({ status: res.statusCode, raw: s.slice(0, 160) }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });

  await new Promise((r) => setTimeout(r, 1200));

  const health = await get('/health');
  const h = health.json || {};
  console.log('【1】自动修复 / 自愈   /health                     HTTP', health.status);
  console.log('    版本:', h.release && (h.release.versionName + ' / #' + h.release.versionCode));
  console.log('    auto.enabled:', h.auto && h.auto.enabled, '| mode:', h.auto && h.auto.mode,
    '| govern.enabled:', h.govern && h.govern.enabled);
  console.log('    健康诊断:', h.diagnostics && ('healthy=' + h.diagnostics.healthy +
    ' diskFreeMB=' + h.diagnostics.diskFreeMB + ' alerts=' + h.diagnostics.alerts));

  const mani = await get('/api/manifest');
  const lat = ((mani.json || {}).release || {}).latest || {};
  console.log('【2】自动升级          /api/manifest              HTTP', mani.status);
  console.log('    latest:', lat.versionName, '/ #' + lat.versionCode,
    '| hapSha256:', String(lat.hapSha256 || '').slice(0, 16), '| downloadUrl:', !!lat.downloadUrl);

  const opt = await get('/api/device/optimization');
  console.log('【3】跟踪操作系统      /api/device/optimization   HTTP', opt.status,
    '| ok:', (opt.json || {}).ok);

  const auto = await get('/api/automation');
  console.log('【4】自治 / 自动修复   /api/automation            HTTP', auto.status,
    '| enabled:', (auto.json || {}).enabled);

  const feat = await get('/api/features/sync');
  console.log('【5】内容热更新        /api/features/sync         HTTP', feat.status,
    '| ok:', (feat.json || {}).ok);

  const results = [health, mani, opt, auto, feat];
  const allOk = results.every((r) => r.status === 200);
  console.log('\n结论: 开发者端自动能力', allOk ? '全部可用 ✅' : '存在异常 ❌');
  process.exit(allOk ? 0 : 1);
})();
