#!/usr/bin/env node
'use strict';
/* 把外部 HAP 工作台（默认桌面「新建文件夹 (6)」）的脚本、未签名包、签名密钥
   导入项目内 harmony/signing/。幂等；只读源目录，绝不改动或删除用户桌面文件。 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'harmony', 'signing');
const SRC = process.env.KH_HAP_PROJECT || path.join(os.homedir(), 'Desktop', '新建文件夹 (6)');

const FILES = [
  ['_inject_honghub.py', '_inject_honghub.py'],
  ['sign-hap.py', 'sign-hap.py'],
  ['entry-default-unsigned.hap', 'entry-default-unsigned.hap'],
  ['sign-keys/app-key.p12', 'sign-keys/app-key.p12'],
  ['sign-keys/profile-key.p12', 'sign-keys/profile-key.p12'],
  ['sign-keys/ca.p12', 'sign-keys/ca.p12'],
  ['sign-keys/ca.cer', 'sign-keys/ca.cer']
];

function main() {
  fs.mkdirSync(path.join(DEST, 'sign-keys'), { recursive: true });
  fs.mkdirSync(path.join(DEST, 'entry', 'build', 'default', 'outputs', 'default'), { recursive: true });
  let copied = 0, missing = 0;
  for (const [from, to] of FILES) {
    const s = path.join(SRC, from), d = path.join(DEST, to);
    // 项目内的 Python 脚本已改造成相对路径版，不能被外部旧版（写死绝对路径）覆盖
    if (/\.py$/.test(to) && fs.existsSync(d)) {
      const cur = fs.readFileSync(d, 'utf8');
      if (/_ROOT|KH_ADAPTED_HTML/.test(cur)) { console.log('  保留项目内已改造的 ' + to); continue; }
    }
    if (!fs.existsSync(s)) {
      if (!fs.existsSync(d)) { console.log('  缺 ' + from + '（项目内也无副本）'); missing++; }
      continue;
    }
    fs.copyFileSync(s, d);
    copied++;
  }
  const envFile = path.join(ROOT, '.env');
  const example = path.join(ROOT, '.env.example');
  if (!fs.existsSync(envFile) && fs.existsSync(example)) {
    fs.copyFileSync(example, envFile);
    console.log('  已从 .env.example 生成 .env（本机私有，勿提交）');
  }
  console.log('签名工作台导入：' + copied + ' 个文件来自 ' + SRC);
  if (missing) {
    console.error('缺少 ' + missing + ' 个必需文件；可执行 npm run doctor 查看明细。');
    process.exit(1);
  }
  console.log('项目内签名链：' + DEST);
}

main();
