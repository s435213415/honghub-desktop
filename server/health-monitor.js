'use strict';
/* 运行健康监测：磁盘 / 内存 / 进程 / 日志水位，越线写 alerts.jsonl 并从接口可查。
   只读监测，不自动删文件、不自动重启服务 —— 处置交给自动修 Bug 闭环与运维。 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA = path.join(__dirname, 'data');
const ALERTS = path.join(DATA, 'alerts.jsonl');
const MIN_DISK_MB = Math.max(128, Number(process.env.KH_MIN_DISK_MB || 1024));
const MEM_WARN = 0.90;
const startedAt = Date.now();

function diskFreeMB(dir) {
  try {
    const st = fs.statfsSync ? fs.statfsSync(dir) : null;
    if (st && st.bavail && st.bsize) return Math.round(st.bavail * st.bsize / 1024 / 1024);
  } catch (e) { /* 老 Node 无 statfsSync */ }
  return null;
}

function logBytes() {
  let n = 0;
  if (!fs.existsSync(DATA)) return 0;
  for (const f of fs.readdirSync(DATA)) {
    if (!f.endsWith('.jsonl')) continue;
    try { n += fs.statSync(path.join(DATA, f)).size; } catch (e) {}
  }
  return n;
}

function snapshot() {
  const total = os.totalmem(), free = os.freemem();
  const disk = diskFreeMB(__dirname);
  const alerts = [];
  if (disk !== null && disk < MIN_DISK_MB) alerts.push({ level: 'critical', code: 'disk-low', detail: '可用磁盘 ' + disk + 'MB < 阈值 ' + MIN_DISK_MB + 'MB' });
  if (free / total < (1 - MEM_WARN)) alerts.push({ level: 'warn', code: 'mem-high', detail: '系统内存已用 ' + Math.round((1 - free / total) * 100) + '%' });
  const logs = logBytes();
  if (logs > 20 * 1024 * 1024) alerts.push({ level: 'warn', code: 'log-high', detail: '运行日志 ' + Math.round(logs / 1024 / 1024) + 'MB，检查轮转是否生效' });
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    diskFreeMB: disk, diskThresholdMB: MIN_DISK_MB,
    mem: { totalMB: Math.round(total / 1024 / 1024), freeMB: Math.round(free / 1024 / 1024), usedPct: Math.round((1 - free / total) * 100) },
    process: { rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024), node: process.version, platform: process.platform },
    logBytes: logs,
    alerts,
    healthy: alerts.filter(a => a.level === 'critical').length === 0
  };
}

function check() {
  const s = snapshot();
  if (s.alerts.length) {
    try {
      fs.mkdirSync(DATA, { recursive: true });
      for (const a of s.alerts) fs.appendFileSync(ALERTS, JSON.stringify(Object.assign({ at: Date.now() }, a)) + '\n');
    } catch (e) { /* 只读盘上不写告警，接口仍可返回 */ }
  }
  return s;
}

function recent(limit) {
  try {
    return fs.readFileSync(ALERTS, 'utf8').split('\n').filter(Boolean).slice(-(limit || 20)).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

function start() {
  check();
  const t = setInterval(() => check(), 5 * 60 * 1000);
  if (t.unref) t.unref();
  return t;
}

module.exports = { snapshot, check, recent, start };
