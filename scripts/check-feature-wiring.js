#!/usr/bin/env node
'use strict';
/* 功能接线体检：核对 features/manifest.json 与两端前端是否对得上
   检查三件事：
   1) 每个 builtin 动作在 app/index.html 里能不能找到实现（找不到 = 点了没反应）
   2) 开发端专属动作（KH_DEV_ACTION）是否确实不该出现在客户端
   3) manifest 与 HAP 端 www/index.html 是否同步
   退出码：0 全部通过；1 有错位。
   用法：node scripts/check-feature-wiring.js
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app', 'index.html');
const HAP = path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'www', 'index.html');
const MAN = path.join(ROOT, 'features', 'manifest.json');
/* 前端模块化后，实现体在 app/kh-*.js：用聚合视图做接线检查，避免扫壳页得到「全部未实现 / 全部假绿」。 */
const fe = require('./frontend-source');

const raw = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.features || []);
const app = fe.merged(APP);
const hap = fs.existsSync(HAP) ? fs.readFileSync(HAP, 'utf8') : '';

const devReSrc = (app.match(/var KH_DEV_ACTION = (\/[^\n]*\/);/) || [])[1];
if (!devReSrc) { console.error('✗ 找不到 KH_DEV_ACTION 规则'); process.exit(1); }
const DEV_RE = new RegExp(devReSrc.slice(1, devReSrc.lastIndexOf('/')));

const missing = [];
const clientVisibleDev = [];
for (const f of list) {
  const a = String(f.action || '');
  const isBuiltin = a.indexOf('builtin:') === 0;
  const devOnly = DEV_RE.test(a) || a === 'script' || a === 'webhook';
  if (!isBuiltin) continue;
  const key = a.slice('builtin:'.length);
  /* 实现可能写成 'builtin:report' 或 a === 'builtin:kidmode'，按完整的 builtin:键 匹配 */
  const implemented = new RegExp('builtin:' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])').test(app);
  if (!implemented) missing.push(f.id + ' → ' + a + (devOnly ? '（开发端专属，可接受）' : '（客户端可见却无实现 ✗）'));
  if (!devOnly && !implemented) clientVisibleDev.push(f.id);
}

const devOnlyCount = list.filter((f) => {
  const a = String(f.action || '');
  return DEV_RE.test(a) || a === 'script' || a === 'webhook';
}).length;

/* 两端同步：开发端规则与阶跃块都要一致 */
const syncKeys = ['KH_DEV_ACTION', "builtin:audit", "builtin:handofftake", "builtin:kidmode"];
const drift = syncKeys.filter((k) => app.indexOf(k) >= 0 !== (hap.indexOf(k) >= 0));

console.log('功能总数 ' + list.length + ' · 仅开发端 ' + devOnlyCount + ' · 客户端可见 ' + (list.length - devOnlyCount));
if (missing.length) console.log('未接到界面的动作：\n  ' + missing.join('\n  '));
else console.log('✅ 每个内置动作都能在页面里找到实现');
if (clientVisibleDev.length) console.log('✗ 客户端可见但无实现：' + clientVisibleDev.join(', '));
else console.log('✅ 客户端可见功能全部有实现');
if (drift.length) console.log('✗ 两端不同步：' + drift.join(', '));
else console.log('✅ app 与 HAP 前端规则一致');

const bad = clientVisibleDev.length > 0 || drift.length > 0;
process.exit(bad ? 1 : 0);
