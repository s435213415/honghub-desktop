#!/usr/bin/env node
'use strict';
/* 把仓库自带 .githooks/ 挂到本机 git 配置（仅当前仓库，不改全局）。幂等。 */
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const r = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'],
  { cwd: ROOT, encoding: 'utf8' });
if (r.status !== 0) {
  console.error('设置 hooksPath 失败（当前目录可能不是 git 仓库）：' + String(r.stderr || '').trim());
  process.exit(1);
}
console.log('已启用提交前静态门禁：' + path.join(ROOT, '.githooks', 'pre-commit'));
console.log('此后每次 git commit 会自动跑 npm run check 的等价检查。');
