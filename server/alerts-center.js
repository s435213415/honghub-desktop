/* 告警中心：把「只在接口里有、没人看见」的告警变成能看、能确认、能外发的通道。
   组成三块：
   1) list()       —— 聚合 health-monitor 的快照与最近告警，按 critical/warn/info 分级去重
   2) config 读写   —— 开关、最低外发级别、Webhook 地址、去重窗（落 server/data/alerts-config.json）
   3) dispatch()   —— 定时把「新出现且达到最低级别」的告警推给 Webhook，结果留痕在 alerts-outbox.json
   约束：不自动恢复任何发版行为，只做通知；外发失败只记录，不影响中枢运行。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const CFG_FILE = path.join(DATA, 'alerts-config.json');
const STATE_FILE = path.join(DATA, 'alerts-state.json');
const OUTBOX_FILE = path.join(DATA, 'alerts-outbox.json');
const INJECT_FILE = path.join(DATA, 'alerts-injected.json');   // 问题上报链路喂进来的告警
const INJECT_KEEP = 120;

const LEVELS = { critical: 0, warn: 1, info: 2 };
const DEFAULTS = { enabled: false, minLevel: 'critical', webhookUrl: '', dedupeMin: 30 };

function ensureDir() { try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {} }
function jread(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }
function jwrite(p, v) { ensureDir(); try { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); return true; } catch (e) { return false; } }

function config() { return Object.assign({}, DEFAULTS, jread(CFG_FILE, {})); }
function saveConfig(patch) {
  const next = Object.assign({}, config(), patch || {});
  next.webhookUrl = String(next.webhookUrl || '').trim();
  next.minLevel = LEVELS[next.minLevel] !== undefined ? next.minLevel : DEFAULTS.minLevel;
  next.dedupeMin = Math.max(1, Math.min(1440, Number(next.dedupeMin) || DEFAULTS.dedupeMin));
  jwrite(CFG_FILE, next);
  return next;
}

/* 聚合：优先用 healthMonitor 的实时与最近告警，拿不到就返回空壳而不是报错 */
function readInjected() {
  const arr = jread(INJECT_FILE, []);
  return Array.isArray(arr) ? arr : [];
}
/* 外部告警入口：同 code 合并，保留首次/最近时间与累计次数；
   问题上报的跨设备高频错误由此进入告警中心，Webhook 才会真的响。 */
function push(items) {
  const now = Date.now();
  const arr = readInjected();
  let changed = 0;
  (items || []).forEach(function (a) {
    if (!a || !a.code) return;
    const code = String(a.code).slice(0, 40);
    const lastAt = Number(a.lastAt || a.lastSeen || now) || now;
    const hit = arr.find(function (x) { return x.code === code; });
    if (hit) {
      hit.n = (hit.n || 1) + 1;
      hit.lastAt = Math.max(Number(hit.lastAt) || 0, lastAt);
      if (a.detail) hit.detail = String(a.detail).slice(0, 160);
      if (a.level === 'critical' || (a.level === 'warn' && hit.level !== 'critical')) hit.level = a.level;
      changed += 1;
    } else {
      arr.unshift({ level: a.level === 'critical' ? 'critical' : (a.level === 'warn' ? 'warn' : 'info'),
        code: code, detail: String(a.detail || '').slice(0, 160),
        firstAt: lastAt, lastAt: lastAt, n: 1, source: a.source || 'report' });
      changed += 1;
    }
  });
  if (changed) jwrite(INJECT_FILE, arr.slice(0, INJECT_KEEP));
  return { ok: true, changed: changed, total: arr.length };
}

function list() {
  let snap = {};
  let recent = [];
  let graded = { levels: { critical: [], warn: [], info: [] }, total: 0, healthy: true, deduped: [] };
  try { snap = require('./health-monitor').snapshot(); } catch (e) { snap = {}; }
  try { recent = require('./health-monitor').recent(120); } catch (e) { recent = []; }
  try { graded = require('./devops').gradeAlerts((snap.alerts || []).concat(recent, readInjected()), {}); } catch (e) {}
  const cfg = config();
  const outbox = jread(OUTBOX_FILE, []).slice(0, 12);
  return {
    ok: true,
    at: new Date().toISOString(),
    health: {
      cpu: snap.cpu, mem: snap.mem, diskFreeMB: snap.diskFreeMB, uptimeSec: snap.uptimeSec,
      ok: snap.ok !== false
    },
    totals: {
      critical: graded.levels.critical.length,
      warn: graded.levels.warn.length,
      info: graded.levels.info.length,
      total: graded.total,
      healthy: graded.healthy
    },
    alerts: graded.deduped || [],
    config: cfg,
    outbox: outbox
  };
}

/* 发一条 Webhook。用 http/https 原生模块，避免依赖 fetch 在 Electron 下不可用 */
function postJson(url, payload, timeoutMs) {
  return new Promise(function (resolve) {
    let u;
    try { u = new URL(url); } catch (e) { resolve({ ok: false, error: '地址不合法' }); return; }
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'User-Agent': 'HongHub-DevOps/1.0' },
      timeout: timeoutMs || 8000
    }, function (res) {
      let txt = '';
      res.on('data', function (c) { if (txt.length < 2048) txt += c; });
      res.on('end', function () { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: txt.slice(0, 300) }); });
    });
    req.on('timeout', function () { req.destroy(new Error('超时')); });
    req.on('error', function (e) { resolve({ ok: false, error: e.message }); });
    req.write(body);
    req.end();
  });
}

function recordOutbox(entry) {
  const arr = jread(OUTBOX_FILE, []);
  arr.unshift(entry);
  jwrite(OUTBOX_FILE, arr.slice(0, 60));
}

function textOf(a) {
  return '【鸿汇影·' + (a.level === 'critical' ? '严重' : a.level === 'warn' ? '警告' : '提示') + '】' +
    (a.code || '未命名告警') + '\n' + (a.detail || '') + '\n时间：' + new Date(a.lastAt || Date.now()).toLocaleString('zh-CN', { hour12: false }) +
    '\n主机：' + os.hostname();
}

/* 手动测试：忽略开关与级别，直接发一条样例 */
async function sendTest(urlOverride) {
  const cfg = config();
  const url = String(urlOverride || cfg.webhookUrl || '').trim();
  if (!url) return { ok: false, error: '还没填 Webhook 地址' };
  const payload = { text: '【鸿汇影·测试】告警通道联通性测试\n主机：' + os.hostname(), level: 'info', code: 'test', at: Date.now(), source: '鸿汇影开发端' };
  const r = await postJson(url, payload);
  recordOutbox({ at: Date.now(), kind: 'test', url: url.replace(/\/\/[^/]+\//, '//***/'), ok: !!r.ok, status: r.status || 0, error: r.error || '', body: r.body || '' });
  return Object.assign({ url: url.replace(/\/\/[^/]+\//, '//***/') }, r);
}

/* 定时派发：只在 critical/warn 达到「最低外发级别」时才推，且同 code 在去重窗内只推一次 */
let timer = null;
let lastSeenAt = (jread(STATE_FILE, {}).lastSeenAt) || 0;

async function dispatchOnce() {
  const cfg = config();
  if (!cfg.enabled || !cfg.webhookUrl) return { sent: 0, skipped: '未启用或无地址' };
  let graded;
  try {
    graded = require('./devops').gradeAlerts(
      (require('./health-monitor').snapshot().alerts || [])
        .concat(require('./health-monitor').recent(120), readInjected()), {});
  }
  catch (e) { return { sent: 0, skipped: '取不到告警' }; }
  const now = Date.now();
  const dedupeMs = cfg.dedupeMin * 60 * 1000;
  const minOrder = LEVELS[cfg.minLevel];
  const due = (graded.deduped || []).filter(function (a) {
    if (LEVELS[a.level] > minOrder) return false;
    const at = Number(a.lastAt || 0);
    if (at <= lastSeenAt) return false;          // 上一轮已处理过
    if (now - at > dedupeMs && at <= lastSeenAt) return false;
    return true;
  });
  let sent = 0;
  for (const a of due.slice(0, 10)) {
    const r = await postJson(cfg.webhookUrl, { text: textOf(a), level: a.level, code: a.code, at: a.lastAt, source: '鸿汇影开发端' });
    recordOutbox({ at: Date.now(), kind: 'alert', code: a.code, level: a.level, ok: !!r.ok, status: r.status || 0, error: r.error || '', body: r.body || '' });
    if (r.ok) sent += 1;
  }
  const maxAt = Math.max(lastSeenAt, ...(graded.deduped || []).map(function (a) { return Number(a.lastAt || 0); }), now - 1000);
  lastSeenAt = maxAt;
  jwrite(STATE_FILE, { lastSeenAt: lastSeenAt, at: Date.now() });
  return { sent: sent, due: due.length };
}

function start(intervalMs) {
  if (timer) return false;
  timer = setInterval(function () { dispatchOnce().catch(function () {}); }, Math.max(30000, Number(intervalMs || 60 * 1000)));
  try { timer.unref && timer.unref(); } catch (e) {}
  return true;
}

module.exports = { list, config, saveConfig, sendTest, dispatchOnce, start, push };
