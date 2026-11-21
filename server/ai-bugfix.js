/**
 * 鸿汇影 · 开发端「AI 自动修 Bug」（真改码闭环）
 * --------------------------------------------------------------
 * 与 auto-bugfix（规则/模板式自愈）互补：本模块把真实缺陷交给模型给出
 * 「精确字符串替换」补丁，再经本机安全闸校验后才落盘，闭环失败如实登记。
 *
 * 流程（每条问题）：
 *   1) 读问题条目（file / error）→ 取源文件窗口（≤2600 字符）
 *   2) 调兼容 OpenAI Chat 通道（复用 ai-advisor 的密钥配置）要严格 JSON
 *      {"file":"相对路径","find":"原片段","replace":"新片段","reason":"为何这样改"}
 *   3) 安全闸：路径白名单 + find 必须唯一命中 + 替换后语法检查（js: vm.Script / py: py_compile）
 *   4) 写前备份到 data/snapshots/ai-fix/；校验不过立即还原并登记 failed
 *   5) 输出 data/latest_ai_bugfix.json（含每条 fixed/failed 与原因）
 *
 * 边界（不做假）：
 *   - 未配置 KH_AI_BASE_URL / KH_AI_API_KEY / KH_AI_MODEL 时如实返回 not-configured，
 *     并提示回退 auto-codefix 机械修复；不伪造"AI 已修"。
 *   - 只允许改源码目录（server/ scripts/ app/ harmony 的 .py/.ts/.ets electron-main.js），
 *     不碰 dist/ 产物、data/、node_modules、证书与密钥。
 *   - 一次只应用一处替换；模型给出的多文件补丁按条逐条处理，任一校验失败不影响其它条。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const SERVER = __dirname;
const ROOT = path.join(SERVER, '..');
const DATA = path.join(SERVER, 'data');
const QUEUE = path.join(DATA, 'bugfix_queue.jsonl');
const LATEST = path.join(DATA, 'latest_ai_bugfix.json');
const SNAP = path.join(DATA, 'snapshots', 'ai-fix');
const MAX_ITEMS = Math.max(1, Math.min(10, Number(process.env.KH_AIFIX_MAX || 4)));

function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function mkdir(p) { try { fs.mkdirSync(p, { recursive: true }); return true; } catch (e) { return false; } }
function sha(p) { try { return require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch (e) { return ''; } }

function aiConfig() {
  return {
    base: String(process.env.KH_AI_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.KH_AI_API_KEY || '',
    model: process.env.KH_AI_MODEL || '',
    timeoutMs: Math.max(5000, Number(process.env.KH_AI_TIMEOUT_MS || 20000))
  };
}
function aiReady() {
  const c = aiConfig();
  return !!(c.base && c.apiKey && c.model);
}

/* 只允许这些相对目录/文件，防止模型指向产物、证书或系统路径 */
const ALLOW = [
  /^server\/[\w.-]+\.js$/,
  /^scripts\/[\w.-]+\.js$/,
  /^scripts\/lib\/[\w.-]+\.js$/,
  /^app\/kh-[\w.-]+\.js$/,
  /^app\/index\.html$/,
  /^harmony\/[\w./-]+\.py$/,
  /^electron-main\.js$/,
  /^preload\.js$/
];
function allowed(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.includes('..') || path.isAbsolute(p)) return false;
  return ALLOW.some((re) => re.test(p));
}

function pyExe() {
  for (const c of [process.env.PYTHON_BIN, path.join(os.homedir(), 'HongHubServer', 'runtime', 'python', 'python.exe')]) {
    if (c && exists(c)) return c;
  }
  for (const n of ['python', 'python3']) {
    const r = spawnSync(n, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (!r.error && r.status === 0) return n;
  }
  return null;
}

/* 语法校验：通过返回 ''，失败返回原因 */
function syntaxCheck(rel, text) {
  if (/\.js$/i.test(rel)) {
    try { new vm.Script(text, { filename: rel }); return ''; }
    catch (e) { return 'JS 语法错误：' + String(e && e.message || e).slice(0, 140); }
  }
  if (/\.py$/i.test(rel)) {
    const py = pyExe();
    if (!py) return '本机没有 python，无法复核 .py 补丁';
    const tmp = path.join(os.tmpdir(), 'kh-aifix-' + Date.now() + '.py');
    try {
      fs.writeFileSync(tmp, text);
      const r = spawnSync(py, ['-m', 'py_compile', tmp], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      if (r.status === 0) return '';
      return 'PY 语法错误：' + String((r.stderr || r.stdout || '')).trim().split('\n').slice(0, 2).join(' ').slice(0, 140);
    } catch (e) { return 'PY 校验异常：' + String(e && e.message || e).slice(0, 120); }
    finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  return '';
}

function postJson(messages, c, maxTokens) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(c.base + '/chat/completions'); } catch (e) { resolve({ ok: false, reason: 'AI 端点非法' }); return; }
    const body = JSON.stringify({ model: c.model, messages, temperature: 0.1, max_tokens: maxTokens || 900 });
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + c.apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: c.timeoutMs
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; if (out.length > 65536) { try { req.destroy(); } catch (e) {} } });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) { resolve({ ok: false, reason: 'AI 接口 HTTP ' + res.statusCode }); return; }
        try {
          const j = JSON.parse(out);
          const reply = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
          resolve(reply ? { ok: true, reply: String(reply) } : { ok: false, reason: 'AI 返回空内容' });
        } catch (e) { resolve({ ok: false, reason: 'AI 返回不是合法 JSON' }); }
      });
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, reason: 'AI 响应超时' }); });
    req.on('error', (e) => resolve({ ok: false, reason: 'AI 连接失败：' + String(e && e.message || e).slice(0, 100) }));
    req.write(body);
    req.end();
  });
}

function stripFence(s) { return String(s || '').replace(/^```(json|JSON)?\s*/i, '').replace(/```\s*$/, '').trim(); }

/* 从队列取未处置的真实缺陷；文件必须存在且在白名单内 */
function pickIssues(limit) {
  const out = [];
  if (!exists(QUEUE)) return out;
  let lines = [];
  try { lines = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean); } catch (e) { return out; }
  const seen = new Set();
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch (e) { continue; }
    const file = String(o.file || '').replace(/\\/g, '/').replace(/^.*HongHub-Desktop\//, '');
    if (!file || !allowed(file)) continue;
    if (seen.has(file)) continue;            // 同一文件只让模型看一次，避免重复补丁
    const abs = path.join(ROOT, file);
    if (!exists(abs)) continue;
    seen.add(file);
    out.push({ file: file, error: String(o.note || o.error || '该文件此前被登记为缺陷待处理').slice(0, 200), at: o.at || 0 });
  }
  return out;
}

/* 给模型的源码窗口：整文件不超过 2600 字符则全文，否则取错误附近 */
function sourceWindow(abs, err) {
  let text = '';
  try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { return { text: '', window: '' }; }
  if (text.length <= 2600) return { text: text, window: text };
  const lines = text.split('\n');
  let anchor = 0;
  const key = String(err || '');
  for (let i = 0; i < lines.length; i++) {
    if (key && lines[i].includes(key.slice(0, 24))) { anchor = i; break; }
  }
  const from = Math.max(0, anchor - 30);
  const slice = lines.slice(from, from + 70).join('\n');
  return { text: text, window: slice };
}

async function askModel(issue, abs, win, c) {
  const sys = '你是鸿汇影桌面端（Node.js + 纯前端 ES5 模块）的修复助手。只输出严格 JSON，不要解释：\n'
    + '{"file":"<与输入相同的相对路径>","find":"<原文中逐字出现的片段，20-400 字符>","replace":"<替换后的片段>","reason":"<一句话原因>"}\n'
    + '硬性要求：find 必须是原文里逐字出现且唯一的片段；replace 必须保持既有函数名、导出、注释风格；'
    + '不要新增依赖、不要写文件或执行命令、不要改版本号、不要删除既有能力；无法确定原因时输出 {"file":"","find":"","replace":"","reason":"证据不足"}。';
  const user = '文件：' + issue.file + '\n登记问题：' + issue.error + '\n\n源码片段（行号从片段的第 1 行算）：\n' + win;
  const r = await postJson([{ role: 'system', content: sys }, { role: 'user', content: user }], c, 900);
  if (!r.ok) return { ok: false, reason: r.reason };
  let j = null;
  try { j = JSON.parse(stripFence(r.reply)); } catch (e) { j = null; }
  if (!j || typeof j !== 'object') return { ok: false, reason: 'AI 未给出可解析的补丁 JSON' };
  if (!j.find) return { ok: false, reason: 'AI 判定证据不足：' + String(j.reason || '未给出原因').slice(0, 80) };
  return { ok: true, patch: j };
}

function applyPatch(issue, patch) {
  const rel = String(patch.file || issue.file).replace(/\\/g, '/');
  if (!allowed(rel)) return { ok: false, reason: '补丁目标不在允许改动的源码范围：' + rel };
  if (rel !== issue.file) return { ok: false, reason: 'AI 想把补丁打到另一个文件（' + rel + '），已拒绝跨文件改动' };
  const abs = path.join(ROOT, rel);
  let before = '';
  try { before = fs.readFileSync(abs, 'utf8'); } catch (e) { return { ok: false, reason: '读不到源文件' }; }
  const find = String(patch.find || '');
  const replace = String(patch.replace || '');
  if (!find || find === replace) return { ok: false, reason: 'AI 补丁为空或与原片段相同' };
  const first = before.indexOf(find);
  if (first < 0) return { ok: false, reason: 'AI 给的 find 片段在源文件里找不到（可能基于截断窗口），已拒绝' };
  if (before.indexOf(find, first + 1) >= 0) return { ok: false, reason: 'AI 给的 find 片段在源文件里出现多次，无法唯一定位' };
  const after = before.slice(0, first) + replace + before.slice(first + find.length);
  const bad = syntaxCheck(rel, after);
  if (bad) return { ok: false, reason: '补丁未通过语法校验：' + bad };
  mkdir(SNAP);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = path.join(SNAP, rel.replace(/[\\/]/g, '_') + '.' + stamp + '.bak');
  try { fs.writeFileSync(bak, before); } catch (e) { return { ok: false, reason: '备份失败，未写回' }; }
  try { fs.writeFileSync(abs, after); } catch (e) {
    try { fs.writeFileSync(abs, before); } catch (_) {}
    return { ok: false, reason: '写回失败（' + String(e && e.message || e).slice(0, 80) + '），已还原' };
  }
  /* 写后复核：读回再校验一次，防止磁盘编码问题 */
  let readback = '';
  try { readback = fs.readFileSync(abs, 'utf8'); } catch (e) { readback = ''; }
  if (readback !== after) {
    try { fs.writeFileSync(abs, before); } catch (_) {}
    return { ok: false, reason: '写回内容与预期不一致，已还原' };
  }
  return { ok: true, file: rel, backup: bak, sha256: sha(abs), reason: patch.reason || '' };
}

async function run(opts) {
  opts = opts || {};
  const started = Date.now();
  const c = aiConfig();
  const out = {
    ok: false, configured: aiReady(),
    mode: 'ai-patch-closed-loop',
    startedAt: started,
    items: [], fixed: [], failed: [],
    notes: []
  };
  if (!aiReady()) {
    out.reason = 'not-configured';
    out.notes.push('未配置 KH_AI_BASE_URL / KH_AI_API_KEY / KH_AI_MODEL：AI 改码能力不可用（外部条件）。');
    out.notes.push('当前可用回退：auto-codefix 只做闭合符/逗号等机械修复，不做业务改动。');
    out.finishedAt = Date.now();
    try { mkdir(DATA); fs.writeFileSync(LATEST, JSON.stringify(out, null, 2)); } catch (e) {}
    return out;
  }
  const issues = Array.isArray(opts.issues) && opts.issues.length ? opts.issues.slice(0, MAX_ITEMS) : pickIssues(MAX_ITEMS);
  if (!issues.length) {
    out.ok = true;
    out.notes.push('队列里没有可交给 AI 的源码缺陷（或文件不在允许范围），本轮无需改码。');
    out.finishedAt = Date.now();
    try { fs.writeFileSync(LATEST, JSON.stringify(out, null, 2)); } catch (e) {}
    return out;
  }
  for (const issue of issues) {
    const abs = path.join(ROOT, issue.file);
    const src = sourceWindow(abs, issue.error);
    if (!src.text) { out.failed.push({ file: issue.file, reason: '读不到源文件' }); continue; }
    const r = await askModel(issue, abs, src.window, c);
    if (!r.ok) { out.failed.push({ file: issue.file, reason: r.reason }); out.items.push({ file: issue.file, applied: false, reason: r.reason }); continue; }
    const ap = applyPatch(issue, r.patch);
    if (!ap.ok) {
      out.failed.push({ file: issue.file, reason: ap.reason });
      out.items.push({ file: issue.file, applied: false, reason: ap.reason });
      continue;
    }
    out.fixed.push({ file: ap.file, backup: ap.backup, reason: ap.reason || r.patch.reason || '' });
    out.items.push({ file: ap.file, applied: true, reason: ap.reason || r.patch.reason || '' });
  }
  out.ok = out.failed.length === 0;
  out.summary = { total: issues.length, fixed: out.fixed.length, failed: out.failed.length };
  out.finishedAt = Date.now();
  out.notes.push(out.fixed.length
    ? '已改源码的条目需重跑 check-static / smoke-ui / verify-release 复检后才算发布级通过。'
    : '本轮没有成功落盘的补丁，源码未变。');
  mkdir(DATA);
  try { fs.writeFileSync(LATEST, JSON.stringify(out, null, 2)); } catch (e) {}
  return out;
}

function latest() {
  try { return JSON.parse(fs.readFileSync(LATEST, 'utf8')); } catch (e) { return null; }
}
function status() {
  return { configured: aiReady(), model: aiReady() ? aiConfig().model : '', last: latest() };
}

module.exports = { run: run, status: status, latest: latest, isConfigured: aiReady };
