'use strict';
/* 质量门禁：把仓库里现成的检查脚本（静态门禁 / UI 冒烟 / HAP 冒烟）搬上面板
   每个脚本一次运行落一份 logs/qc-<name>-<ts>.log，状态记在 logs/qc-<name>.json。
   只跑白名单里的三个脚本，不接任意命令。 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOGS = path.join(ROOT, 'logs');
const NODE = process.execPath;
const MAX_TAIL = 40;

const RUNNERS = {
  static: { label: '静态门禁', cmd: 'scripts/check-static.js', desc: 'JS 语法 + Python py_compile + 打包前自检 + 两条回归（102 项）' },
  ui: { label: 'UI 冒烟', cmd: 'scripts/smoke-ui.js', desc: '用 Edge 打开影视页，点主要按钮，统计按钮命中与脚本错误' },
  hap: { label: 'HAP 冒烟', cmd: 'scripts/smoke-hap.js', desc: '开鸿包安装与启动冒烟（依赖 hdc 连接设备）' },
  panels: { label: '面板连通性', cmd: 'scripts/check-panels.js', desc: '起临时实例逐个打开开发端面板，校验状态码、返回条与关键区块（只发 GET）' }
};

const PANELS = [
  { path: '/admin', must: ['鸿汇影'] },
  { path: '/admin/home', must: ['总目录', '返回运维看板'] },
  { path: '/admin/build', must: ['发版流水线', '返回运维看板'] },
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

function httpGet(port, pathname, timeoutMs) {
  return new Promise(function (resolve) {
    const req = require('http').get({ host: '127.0.0.1', port: port, path: pathname, timeout: timeoutMs || 6000 }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve({ code: res.statusCode, body: body }); });
    });
    req.on('timeout', function () { req.destroy(); resolve({ code: 0, body: '', timeout: true }); });
    req.on('error', function (e) { resolve({ code: 0, body: '', error: e.message }); });
  });
}

/* 面板连通性：拉一个临时实例（随机端口、开发端模式），逐页打开校验，跑完必杀进程 */
async function runPanels(logFile) {
  const port = 9200 + Math.floor(Math.random() * 300);
  const lines = [];
  const child = spawn(NODE, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), KH_DEV_MODE: '1', AUTO_RUN_ENABLED: '0', AUTO_OPTIMIZE: '0', AUTO_GOVERN: '0' }),
    windowsHide: true,
    stdio: 'ignore'
  });
  let ok = 0, bad = 0;
  try {
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      const probe = await httpGet(port, '/', 2000);
      if (probe.code) ready = true; else await new Promise(function (r) { setTimeout(r, 250); });
    }
    if (!ready) { lines.push('  [失败] 临时实例未能在 10 秒内启动'); bad++; }
    for (const p of PANELS) {
      if (!ready) break;
      const r = await httpGet(port, p.path, 8000);
      const missing = (p.must || []).filter(function (k) { return r.body.indexOf(k) < 0; });
      const pass = r.code === 200 && missing.length === 0;
      lines.push('  [' + (pass ? '通过' : '失败') + '] ' + p.path + ' → ' + (r.code || '超时') +
        (pass ? '' : '（缺少区块：' + (missing.join('、') || '无') + '）'));
      if (pass) ok++; else bad++;
    }
  } finally {
    try { child.kill(); } catch (e) {}
  }
  lines.push('');
  lines.push('面板连通性：' + ok + ' 通过 / ' + bad + ' 失败（共 ' + PANELS.length + ' 页）');
  return { lines: lines, ok: bad === 0 };
}

function stateFile(name) { return path.join(LOGS, 'qc-' + name + '.json'); }

function readState(name) {
  try { return JSON.parse(fs.readFileSync(stateFile(name), 'utf8')); } catch (e) { return null; }
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

function tail(file, n) {
  try {
    const buf = fs.readFileSync(file, 'utf8');
    const lines = buf.split(/\r?\n/).filter(function (x) { return x.trim() !== ''; });
    return lines.slice(-(n || MAX_TAIL));
  } catch (e) { return []; }
}

/* 判定成败：优先看脚本自己的汇总行，其次看退出码 */
function judge(name, lines, code) {
  const joined = lines.join('\n');
  if (name === 'static') {
    const m = joined.match(/静态门禁：(\d+)\s*项，失败\s*(\d+)\s*项/);
    if (m) return { ok: Number(m[2]) === 0, summary: '共 ' + m[1] + ' 项，失败 ' + m[2] + ' 项' };
    if (/全部通过/.test(joined)) return { ok: true, summary: '全部通过' };
  }
  if (name === 'ui') {
    const m = joined.match(/按钮\s*(\d+)\/(\d+)[^·]*·\s*错误\s*(\d+)/);
    if (m) return { ok: Number(m[3]) === 0, summary: '按钮命中 ' + m[1] + '/' + m[2] + ' · 脚本错误 ' + m[3] };
  }
  if (name === 'hap') {
    if (/通过|OK|成功/.test(joined)) return { ok: true, summary: '冒烟通过' };
  }
  if (name === 'panels') {
    const m = joined.match(/面板连通性：(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    if (m) return { ok: Number(m[2]) === 0, summary: m[1] + ' 页通过 / ' + m[2] + ' 页失败' };
  }
  return { ok: code === 0, summary: code === 0 ? '退出码 0' : ('退出码 ' + code) };
}

function listLogs(name) {
  try {
    return fs.readdirSync(LOGS)
      .filter(function (f) { return f.indexOf('qc-' + name + '-') === 0 && f.slice(-4) === '.log'; })
      .sort().reverse().slice(0, 8)
      .map(function (f) {
        const st = fs.statSync(path.join(LOGS, f));
        return { file: f, at: st.mtime.toISOString(), kb: Math.round(st.size / 1024) };
      });
  } catch (e) { return []; }
}

function status(name) {
  const meta = RUNNERS[name];
  const st = readState(name) || {};
  const logs = listLogs(name);
  const latest = logs[0] ? logs[0].file : null;
  const running = !!st.running && alive(st.pid);
  const out = {
    name: name,
    label: meta.label,
    desc: meta.desc,
    cmd: meta.cmd,
    running: running,
    at: st.at || (logs[0] && logs[0].at) || null,
    durationMs: st.durationMs || null,
    code: st.code === undefined ? null : st.code,
    log: latest,
    logs: logs,
    tail: latest ? tail(path.join(LOGS, latest)) : []
  };
  if (!running && latest) {
    const j = judge(name, out.tail, st.code);
    out.ok = j.ok; out.summary = j.summary;
  } else if (running) {
    out.ok = null; out.summary = '正在运行…';
  } else {
    out.ok = null; out.summary = '还没有运行记录';
  }
  return out;
}

function all() {
  const items = Object.keys(RUNNERS).map(status);
  return { ok: true, at: new Date().toISOString(), items: items };
}

function run(name) {
  const meta = RUNNERS[name];
  if (!meta) return { ok: false, error: '不支持的检查项：' + name };
  const prev = readState(name);
  if (prev && prev.running && alive(prev.pid)) return { ok: false, error: meta.label + ' 正在运行，等它结束' };
  if (meta.cmd && !fs.existsSync(path.join(ROOT, meta.cmd))) return { ok: false, error: '脚本不存在：' + meta.cmd };
  try { fs.mkdirSync(LOGS, { recursive: true }); } catch (e) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = 'qc-' + name + '-' + stamp + '.log';
  const abs = path.join(LOGS, logFile);
  const startedAt = Date.now();

  if (name === 'panels') {
    // 面板巡检交给独立脚本跑：它自己拉临时实例，服务停了也不影响它跑完
    fs.writeFileSync(abs, '');
  }

  const fd = fs.openSync(abs, 'a');
  const child = spawn(NODE, [path.join(ROOT, meta.cmd)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { KH_DEV_MODE: '1' }),
    windowsHide: true,
    stdio: ['ignore', fd, fd]
  });
  fs.writeFileSync(stateFile(name), JSON.stringify({
    running: true, pid: child.pid, at: new Date(startedAt).toISOString(), log: logFile
  }, null, 2));
  child.on('exit', function (code) {
    try {
      fs.writeFileSync(stateFile(name), JSON.stringify({
        running: false, pid: child.pid, at: new Date(startedAt).toISOString(),
        log: logFile, code: code, durationMs: Date.now() - startedAt
      }, null, 2));
    } catch (e) {}
    try { fs.closeSync(fd); } catch (e) {}
  });
  return { ok: true, started: true, name: name, pid: child.pid, log: logFile };
}

module.exports = { all, status, run, RUNNERS };
