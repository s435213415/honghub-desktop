#!/usr/bin/env node
'use strict';
/* 深开鸿设备热插拔自动冒烟：常驻轮询 hdc，检测到设备接入即自动跑完整冒烟，
   把结果落到 dist/hap-watch.json，并可回传本机中枢 /api/device/report。

   无设备时保持待机并明确标 waiting，绝不假装通过；--once 检测一次即退出。
   变量：KH_HDC / KH_WATCH_INTERVAL（毫秒，默认 5000）/ KH_WATCH_HUB（默认本机 8787）。 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const env = require('./lib/env');
env.apply();

const ROOT = path.join(__dirname, '..');
const HDC = env.findHdc();
const INTERVAL = Math.max(1500, Number(process.env.KH_WATCH_INTERVAL || 5000));
const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry-run');
const REPORT = path.join(ROOT, 'dist', 'hap-watch.json');
const HUB = process.env.KH_WATCH_HUB || 'http://127.0.0.1:8787';
let lastTargets = '';
let lastRunAt = 0;
let cycles = 0;

function write(state, extra) {
  const o = Object.assign({
    state, hdc: HDC, intervalMs: INTERVAL, cycles,
    lastTargets: lastTargets || '[Empty]', lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    at: new Date().toISOString()
  }, extra || {});
  try { fs.mkdirSync(path.dirname(REPORT), { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(o, null, 2) + '\n'); } catch (e) {}
  return o;
}

function targets() {
  if (!HDC) return { ok: false, list: [], err: '未找到 hdc.exe' };
  const r = spawnSync(HDC, ['list', 'targets'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (r.error || r.status !== 0) return { ok: false, list: [], err: r.error ? r.error.message : String(r.stderr || '').trim() };
  const list = String(r.stdout || '').split(/\r?\n/).map(s => s.trim())
    .filter(s => s && !/^\[Empty\]$/i.test(s) && !/list targets/i.test(s));
  return { ok: true, list };
}

function reportToHub(smoke) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      schema: 1, kind: 'hap-smoke', platform: 'harmony',
      os: 'KaihongOS / OpenHarmony', deviceId: smoke.targets && smoke.targets[0] || '',
      smokeStatus: smoke.status, bundle: smoke.bundle, at: new Date().toISOString()
    });
    try {
      const u = new URL('/api/device/report', HUB);
      const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        timeout: 3000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      r.on('timeout', () => { r.destroy(); resolve(0); });
      r.on('error', () => resolve(0));
      r.end(payload);
    } catch (e) { resolve(0); }
  });
}

async function runSmoke(list) {
  lastRunAt = Date.now();
  console.log('[hap-watch] 检测到设备：' + list.join(', ') + ' → 自动运行真机冒烟');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'smoke-hap.js')],
    { encoding: 'utf8', timeout: 240000, windowsHide: true });
  let smoke = null;
  try { smoke = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'hap-smoke.json'), 'utf8')); } catch (e) {}
  smoke = smoke || { status: 'failed', reason: '冒烟未产出报告：' + String(r.stderr || '').trim().slice(0, 160) };
  smoke.targets = list;
  const hubCode = await reportToHub(smoke);
  const o = write(smoke.status === 'passed' ? 'passed' : (smoke.status === 'skipped' ? 'skipped' : 'failed'),
    { status: smoke.status, reason: smoke.reason, steps: smoke.steps || [], hubReport: hubCode });
  console.log('[hap-watch] 冒烟结果 ' + o.status + ' · 回传中枢 HTTP ' + hubCode +
    (smoke.reason ? ' · ' + smoke.reason : ''));
}

function tick() {
  cycles++;
  const t = targets();
  if (!t.ok) { write('waiting', { reason: 'hdc 不可用：' + t.err }); }
  else {
    const key = t.list.join(',');
    const appeared = t.list.length > 0 && key !== lastTargets;
    lastTargets = key;
    if (!t.list.length) write('waiting', { reason: '当前无设备连接，接入开发板后自动运行' });
    else if (appeared || (Date.now() - lastRunAt > 30 * 60 * 1000)) {
      if (DRY) write('dry-run', { reason: '设备已连接，--dry-run 未执行安装', devices: t.list });
      else runSmoke(t.list);
    } else write('idle', { reason: '设备已冒烟过，等待重新插拔或 30 分钟复检', devices: t.list });
  }
  if (ONCE) { console.log('[hap-watch] --once 结束：' + JSON.stringify(write.last || {})); return; }
  setTimeout(tick, INTERVAL);
}

if (!HDC) {
  console.log('[hap-watch] 未找到 hdc.exe，无法监听；可设 KH_HDC 指定路径');
  write('unavailable', { reason: '未找到 hdc.exe' });
  process.exit(0);
}
console.log('[hap-watch] 已启动 · hdc=' + HDC + ' · 间隔 ' + INTERVAL + 'ms' + (ONCE ? ' · --once' : ''));
tick();
