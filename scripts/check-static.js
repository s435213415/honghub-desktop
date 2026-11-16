#!/usr/bin/env node
'use strict';
/* CI / pre-commit 静态门禁：不打包、不依赖 dist 产物、不改任何文件（只读断言）。
   聚合 node --check / py_compile / 打包前自检的静态部分。 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const errs = [];
let checks = 0;

function walk(dir, exts, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '__pycache__' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some(e => name.endsWith(e))) out.push(p);
  }
  return out;
}

function run(label, bin, args, env) {
  checks++;
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', env: env || process.env });
  if (r.status !== 0) {
    errs.push(label + '：' + String(r.stderr || r.stdout || 'exit ' + r.status).trim().slice(0, 240));
    console.error('  [失败] ' + label);
  } else console.log('  [通过] ' + label);
}

console.log('=== 静态门禁 ===');

// 1) 所有 JS 语法（排除产物目录与第三方）
const js = ['electron-main.js'].concat(walk(path.join(ROOT, 'scripts'), ['.js'], []))
  .concat(walk(path.join(ROOT, 'server'), ['.js'], []))
  .filter(p => fs.existsSync(p));
for (const f of js) run(path.relative(ROOT, f), process.execPath, ['--check', f]);

// 2) 所有 Python 语法
const py = process.env.PYTHON_BIN || 'python';
const pys = ['build_desktop.py', 'gen_assets.py'].concat(walk(path.join(ROOT, 'harmony'), ['.py'], []))
  .filter(p => fs.existsSync(p));
for (const f of pys) run(path.relative(ROOT, f) + ' (py_compile)', py, ['-m', 'py_compile', f]);

// 3) 打包前自检的静态部分（不校验 dist 产物、不改写页面）
run('打包前自检（静态模式）', process.execPath, [path.join(__dirname, 'prebuild-check.js')],
  Object.assign({}, process.env, { KH_CHECK_STATIC: '1' }));

// 4) 自动修 Bug / 功能流回归自检
run('自动修 Bug 故障注入回归', process.execPath, [path.join(__dirname, 'selftest-bugfix.js')]);
run('反馈→新功能→下发闭环回归', process.execPath, [path.join(__dirname, 'selftest-feature-flow.js')]);

console.log('\n静态门禁：' + checks + ' 项，失败 ' + errs.length + ' 项');
if (errs.length) {
  errs.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('全部通过');
