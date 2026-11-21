#!/usr/bin/env node
'use strict';
/* 源码级自动改码修复器（零依赖，供 auto-bugfix 调用，也可单独跑）
   ------------------------------------------------------------------
   范围：server/*.js、scripts/*.js、scripts/lib/*.js（Node 语法）
        KaihongMovie/*.py（Python 语法，探测本机 python）
   检测：JS 用内置 vm.Script；PY 用 python -m py_compile（输出到临时目录，不改原文件）
   修复：只做「机械式闭合符补全 / 尾随逗号」这类确定性修复，验证通过才写回；
         绝不改业务逻辑、不删文件、不隔离源码。修不好就明确报告并登记，
         由上一层的 bugfix 队列下一轮 / 下次出包继续处理，绝不谎报成功。
   安全：每次改动前把原文件备份到 server/data/snapshots/src/，可人工回滚。
   接口：scan() -> {files:[...], problems:[...]}
        fix(problems) -> {fixed:[...], failed:[...]}
        run() -> {ok, scanned, problems, fixed, failed, verified}
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SERVER = __dirname;                       // .../HongHub-Desktop/server
const ROOT = path.join(SERVER, '..');
const SNAP = path.join(SERVER, 'data', 'snapshots', 'src');
const WORKSPACE = path.join(os.homedir(), 'WorkBuddy');
const PY_CANDIDATES = [
  process.env.PYTHON_BIN,
  path.join(os.homedir(), 'HongHubServer', 'runtime', 'python', 'python.exe')
].filter(Boolean);

function exists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function mkdir(p) { try { fs.mkdirSync(p, { recursive: true }); return true; } catch (e) { return false; } }
function sha(p) { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch (e) { return ''; } }

function findPython() {
  for (const c of PY_CANDIDATES) if (exists(c)) return c;
  for (const n of ['python', 'python3']) {
    const r = spawnSync(n, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (!r.error && r.status === 0) return n;
  }
  return null;
}

/* 收集要检查的源码文件（限量，避免扫到 node_modules / dist 等） */
function collect() {
  const out = [];
  const dirs = [
    { dir: path.join(ROOT, 'server'), ext: '.js', recursive: false },
    { dir: path.join(ROOT, 'scripts'), ext: '.js', recursive: false },
    { dir: path.join(ROOT, 'scripts', 'lib'), ext: '.js', recursive: false }
  ];
  for (const d of dirs) {
    try {
      for (const name of fs.readdirSync(d.dir)) {
        const p = path.join(d.dir, name);
        if (exists(p) && name.endsWith(d.ext)) out.push({ file: p, lang: 'js' });
      }
    } catch (e) {}
  }
  // 工作区 KaihongMovie 下的 .py（发版源工程）
  try {
    for (const ws of fs.readdirSync(WORKSPACE, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue;
      const km = path.join(WORKSPACE, ws.name, 'KaihongMovie');
      if (!fs.existsSync(km)) continue;
      for (const name of fs.readdirSync(km)) {
        const p = path.join(km, name);
        if (exists(p) && name.endsWith('.py')) out.push({ file: p, lang: 'py' });
      }
      break; // 只取第一个命中的工作区（发版源唯一）
    }
  } catch (e) {}
  return out;
}

function jsError(code) {
  try { new vm.Script(code); return null; } catch (e) { return e.message; }
}
function pyError(file, py) {
  if (!py) return null; // 无 python 则跳过，不误报
  const tmp = path.join(os.tmpdir(), 'kh_pycheck_' + crypto.randomBytes(4).toString('hex'));
  mkdir(tmp);
  try {
    const r = spawnSync(py, ['-m', 'py_compile', file], {
      env: Object.assign({}, process.env, { PYTHONPYCACHEPREFIX: tmp, PYTHONDONTWRITEBYTECODE: '' }),
      encoding: 'utf8', timeout: 30000, windowsHide: true
    });
    if (!r.error && r.status === 0) return null;
    return String((r.stderr || r.stdout || '')).trim().split('\n').slice(-1)[0].slice(0, 200) || 'py 语法检查失败';
  } catch (e) { return null; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
}

function scan() {
  const files = collect();
  const py = findPython();
  const problems = [];
  for (const f of files) {
    if (!exists(f.file)) continue;
    let code, err;
    try { code = fs.readFileSync(f.file, 'utf8'); } catch (e) { continue; }
    if (f.lang === 'js') err = jsError(code);
    else err = pyError(f.file, py);
    if (err) problems.push({ file: f.file, lang: f.lang, error: err });
  }
  return { files: files, problems: problems, python: py };
}

/* 机械式闭合符补全：只追加/插入成对闭合符并验证语法，绝不触碰业务逻辑。 */
function tryCloseJs(code) {
  const tails = ['}', ');', '});', '})', ']', ';', '}}', '};', '});\n}', '}\n)', '}\n];'];
  const seen = new Set();
  for (const t of tails) {
    const c = code + t;
    if (!seen.has(c)) { seen.add(c); if (!jsError(c)) return c; }
  }
  // 末尾 300 字符内，在闭合符前补一个 '}'
  const start = Math.max(0, code.length - 300);
  for (let i = code.length - 1; i >= start; i--) {
    const ch = code.charAt(i);
    if (ch === ')' || ch === '}') {
      const c = code.slice(0, i) + '}' + code.slice(i);
      if (!jsError(c)) return c;
    }
  }
  return null;
}

function backup(file) {
  try {
    mkdir(SNAP);
    const name = path.basename(file) + '.' + Date.now() + '.bak';
    fs.copyFileSync(file, path.join(SNAP, name));
    return name;
  } catch (e) { return null; }
}

/* 修：仅 JS 做补全（PY 语法错误不猜测业务逻辑，只备份+登记交下一轮人工/出包链） */
function fix(problems) {
  const fixed = [], failed = [];
  for (const p of problems) {
    const before = sha(p.file);
    const bak = backup(p.file);
    let ok = false, how = '';
    if (p.lang === 'js') {
      try {
        const code = fs.readFileSync(p.file, 'utf8');
        const candidate = tryCloseJs(code);
        if (candidate && !jsError(candidate)) {
          // 写回前再确认磁盘内容未被并发改动
          if (sha(p.file) === before) {
            fs.writeFileSync(p.file, candidate);
            ok = !jsError(fs.readFileSync(p.file, 'utf8'));
            how = '闭合符补全';
          }
        }
      } catch (e) {}
    }
    if (ok) fixed.push({ file: p.file, lang: p.lang, how: how, backup: bak });
    else failed.push({ file: p.file, lang: p.lang, error: p.error, backup: bak,
      note: p.lang === 'py' ? 'Python 语法错误需按报错行人工确认（已备份，不猜测业务逻辑）' : '未能安全自动修复（已备份，交下一轮/下次出包）' });
  }
  return { fixed: fixed, failed: failed };
}

function run() {
  const s = scan();
  const r = fix(s.problems);
  const after = scan();
  return {
    ok: true,
    scanned: s.files.length,
    python: s.python,
    problems: s.problems,
    fixed: r.fixed,
    failed: r.failed,
    verified: after.problems.length === 0,
    remaining: after.problems
  };
}

module.exports = { scan, fix, run };

if (require.main === module) {
  const r = run();
  console.log(JSON.stringify({ ok: r.ok, scanned: r.scanned, problems: r.problems.length,
    fixed: r.fixed, failed: r.failed, verified: r.verified }, null, 2));
}
