'use strict';
/* 开发端面板连通性巡检：起一个临时实例（随机端口、开发端模式），逐个打开面板，
   校验状态码、返回条与关键区块，最后必杀临时进程。只发 GET，不触发任何写操作。 */
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

const PANELS = [
  { path: '/admin', must: ['鸿汇影'] },
  { path: '/admin/home', must: ['总目录', '返回运维看板'] },
  { path: '/admin/build', must: ['返回运维看板'] },
  { path: '/admin/release', must: ['返回运维看板'] },
  { path: '/admin/metrics', must: ['返回运维看板'] },
  { path: '/admin/alerts', must: ['返回运维看板'] },
  { path: '/admin/quality', must: ['质量门禁', '返回运维看板'] },
  { path: '/admin/extras', must: [] },
  { path: '/admin/features', must: [] },
  { path: '/admin/sites', must: [] },
  { path: '/admin/devices', must: [] },
  { path: '/admin/insights', must: [] }
];

function get(port, pathname, timeoutMs) {
  return new Promise(function (resolve) {
    const req = http.get({ host: '127.0.0.1', port: port, path: pathname, timeout: timeoutMs || 6000 }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve({ code: res.statusCode, body: body }); });
    });
    req.on('timeout', function () { req.destroy(); resolve({ code: 0, body: '', timeout: true }); });
    req.on('error', function (e) { resolve({ code: 0, body: '', error: e.message }); });
  });
}

(async function () {
  const port = 9200 + Math.floor(Math.random() * 300);
  const srv = spawn(NODE, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), KH_DEV_MODE: '1', AUTO_RUN_ENABLED: '0', AUTO_OPTIMIZE: '0', AUTO_GOVERN: '0' })
  });
  let ok = 0, bad = 0;
  try {
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      const probe = await get(port, '/', 2000);
      if (probe.code) ready = true;
      else await new Promise(function (r) { setTimeout(r, 250); });
    }
    if (!ready) {
      console.log('  [失败] 临时实例未能在 10 秒内启动');
      bad++;
    }
    for (const p of PANELS) {
      if (!ready) break;
      const r = await get(port, p.path, 8000);
      const missing = (p.must || []).filter(function (k) { return r.body.indexOf(k) < 0; });
      const pass = r.code === 200 && missing.length === 0;
      console.log('  [' + (pass ? '通过' : '失败') + '] ' + p.path + ' → ' + (r.code || '超时') +
        (pass ? '' : '（缺少区块：' + (missing.join('、') || '无') + '）'));
      if (pass) ok++; else bad++;
    }
  } finally {
    try { srv.kill(); } catch (e) {}
  }
  console.log('');
  console.log('面板连通性：' + ok + ' 通过 / ' + bad + ' 失败（共 ' + PANELS.length + ' 页）');
  process.exit(bad === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('  [失败] 巡检异常：' + (e && e.message));
  process.exit(1);
});
