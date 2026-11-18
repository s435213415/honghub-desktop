#!/usr/bin/env node
'use strict';
/* 一键流水线：版本同步 → 页面/平台表重建 → HAP 出包签名 → 桌面端出包
 *            → 客户版 Setup → 免安装 zip → 下发（镜像站/桌面夹/清单） → 验收
 *
 * 用法（在工程根）：
 *   node scripts/oneclick-release.js            # 常规发版（不涨版本号）
 *   node scripts/oneclick-release.js --bump     # 显式涨一位版本号再出包
 *   node scripts/oneclick-release.js --skip-hap # 只重出 Windows 端
 *   node scripts/oneclick-release.js --no-release --no-client  # 只出桌面端主包
 *   node scripts/oneclick-release.js --dry      # 只打印将要执行的步骤
 *
 * 任何一步非 0 退出即中止，并在 logs/oneclick-*.log 里保留完整输出。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const args = process.argv.slice(2);
const BUMP = args.includes('--bump');
const SKIP_HAP = args.includes('--skip-hap');
const NO_CLIENT = args.includes('--no-client');
const NO_RELEASE = args.includes('--no-release');
const DRY = args.includes('--dry');
const CONTINUE_ON_FAIL = args.includes('--keep-going');

fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG = path.join(LOG_DIR, 'oneclick-' + stamp + '.log');
const lines = [];
function say(s) { console.log(s); lines.push(s); }
function flush() { try { fs.writeFileSync(LOG, lines.join('\n') + '\n', 'utf8'); } catch (e) {} }

const ENV = Object.assign({}, process.env, {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  PYTHONIOENCODING: 'utf-8',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/'
});
// 签名口令与 PATH 兜底（Windows 上直接双击 cmd 时 PATH 常常没有 System32）
ENV.PATH = 'C:\\Windows\\System32;C:\\Windows;C:\\Users\\admin\\Desktop\\command-line-tools\\tool\\jre\\bin;' + (process.env.PATH || '');
try { require('./lib/env').apply(); } catch (e) {}
for (const k of ['OH_KEY_PWD', 'PYTHON_BIN', 'KH_HDC', 'KH_DEPLOY_CMD']) if (process.env[k] && !ENV[k]) ENV[k] = process.env[k];

const STEPS = [];
function step(label, cmd, argv) { STEPS.push({ label, cmd, argv }); }

step('0/8 环境预检', process.execPath, [path.join(__dirname, 'doctor.js')]);
step('1/8 版本对齐' + (BUMP ? '（+1 位）' : '（不涨版本）'), process.execPath,
  [path.join(__dirname, 'version.js'), BUMP ? '--bump' : '--sync']);
step('2/8 页面频道/平台表重建', process.execPath, [path.join(__dirname, 'repair-page-sources.js')]);
step('2.1/8 平台格子重建（BUILTIN_SITES）', process.execPath, [path.join(__dirname, 'rebuild-builtin-sites.js')]);
if (!SKIP_HAP) {
  step('3/8 深开鸿前端生成', 'python', [path.join('harmony', 'build_hap.py')]);
  step('3.1/8 HAP 注入与签名', process.execPath, [path.join(__dirname, 'hap-sign.js')]);
}
step('4/8 桌面端出包（含内置 HAP / 清单）', process.execPath, [path.join(__dirname, 'build-exe.js'), '--no-bump', '--skip-zip']);
if (!NO_CLIENT) step('5/8 客户版 Setup（剥离 /admin 运维入口）', process.execPath, [path.join(__dirname, 'build-client-exe.js')]);
/* 6/8 去掉了 make-portable-zip：它从开发端 win-unpacked 打包，会把开发端页面下发成客户免安装包。
   客户免安装 zip 由 build-client-exe.js 在净化后直接从 win-unpacked 打，才是正确来源。 */
if (!NO_RELEASE) {
  step('7/8 下发（镜像站 + 桌面夹 + 清单）', process.execPath, [path.join(__dirname, 'auto-release.js')]);
  // 8/8 零积分公网下发：把签发好的成品同步到本机镜像站 8099，经 Cloudflare 隧道
  //      回下验证三件直链并输出公网下载链接。走本机文件+隧道流量，不消耗平台积分。
  step('7.1/8 零积分公网下发（上传+回下验证+链接）', process.execPath, [path.join(__dirname, 'publish-free.js')]);
}
step('8/8 验收', process.execPath, [path.join(__dirname, 'verify-release.js')]);
/* 8.1/8 旧公站点只读回验：确认线上清单=本地版本、三件直链可达。
   注意：站点发布能力只能由 WorkBuddy 宿主触发，脚本绝不在这里做发布动作
   （上一轮并发发布争用 dist/ 导致版本错位，教训已固化）。此处只回验，不写不发布。 */
if (!NO_RELEASE) step('8.1/8 旧公站点回验（只读告警）', process.execPath, [path.join(__dirname, 'site-publish.js'), '--verify', '--warn-only']);

say('=== 鸿汇影一键流水线 ' + new Date().toLocaleString('zh-CN') + ' ===');
say('工程：' + ROOT);
say('日志：' + LOG);
STEPS.forEach(function (s, i) { say('  ' + (i + 1) + ') ' + s.label); });
if (DRY) { flush(); say('（--dry：以上步骤仅预览，未执行）'); process.exit(0); }

const results = [];
for (const s of STEPS) {
  say('\n=== ' + s.label + ' ===');
  const t0 = Date.now();
  const r = spawnSync(s.cmd, s.argv, { cwd: ROOT, stdio: 'inherit', env: ENV });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  results.push({ label: s.label, ok, ms });
  say((ok ? '✔ ' : '✘ ') + s.label + ' · ' + Math.round(ms / 1000) + 's');
  flush();
  if (!ok) {
    say('\n流水线在此中止：' + s.label);
    say('排查建议：npm run doctor；HAP 签名失败看 logs 与 harmony/signing；电子包失败看 node_modules 是否完整。');
    flush();
    if (!CONTINUE_ON_FAIL) process.exit(r.status || 1);
  }
}

const fail = results.filter(function (x) { return !x.ok; }).length;
say('\n=== 流水线结束：' + (results.length - fail) + ' 步成功 / ' + fail + ' 步失败 ===');
try {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  say('当前版本 v' + v);
  for (const f of ['dist/鸿汇影桌面版 Setup ' + v + '.exe', 'dist/鸿汇影桌面版 Setup ' + v + '.zip', 'dist/HongHubMovie.hap']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
      say('  ' + path.basename(p) + ' · ' + buf.length.toLocaleString('en-US') + ' B · sha256 ' + sha.slice(0, 16) + '…');
    }
  }
} catch (e) {}
flush();
process.exit(fail ? 1 : 0);
