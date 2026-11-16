/* 深开鸿真机链路：查设备 → 装包（覆盖安装）→ 启动 → 截图取证 → 校验装机版本。
   用法：
     node scripts/hap-device.js                  # 只查设备与已装版本
     node scripts/hap-device.js --install        # 覆盖安装 dist/HongHubMovie.hap
     node scripts/hap-device.js --run            # 安装 + 启动 + 截图 + 版本校验（最常用）
     node scripts/hap-device.js --shot           # 只截图取证
     node scripts/hap-device.js --install --hap=<路径>   # 指定包
   前置：hdc 在 PATH 或默认 SDK 路径；设备已连（USB 或无线调试）。
   原则：只在设备上做覆盖安装（install -r），不卸载、不清数据；任何一步失败如实回报。 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ARG = process.argv.slice(2);
const has = (f) => ARG.includes(f);
const HAP = (ARG.find((a) => a.startsWith('--hap=')) || '').split('=')[1] ||
  path.join(ROOT, 'dist', 'HongHubMovie.hap');
const BUNDLE = 'com.honghub.harmony';
const ABILITY = 'EntryAbility';
const SHOT_DIR = path.join(ROOT, 'dist', '_device-shots');

const HDC_CANDIDATES = [
  'hdc',
  'C:/Users/admin/Desktop/command-line-tools/sdk/26.0.1/toolchains/hdc.exe',
  'C:/Users/admin/Desktop/command-line-tools/sdk/default/openharmony/toolchains/hdc.exe'
];
function findHdc() {
  for (const c of HDC_CANDIDATES) {
    if (c === 'hdc') {
      const r = spawnSync('hdc', ['-v'], { encoding: 'utf8', shell: true });
      if (r.status === 0 && (r.stdout || '').length) return { cmd: 'hdc', via: 'PATH' };
      continue;
    }
    if (fs.existsSync(c)) return { cmd: c, via: c };
  }
  return null;
}

const ok = (s) => console.log('  [PASSED] ' + s);
const bad = (s) => console.log('  [FAILED] ' + s);
const info = (s) => console.log('  ' + s);

function run(cmd, args, timeout) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeout || 60000 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function targets(hdc) {
  const r = run(hdc, ['list', 'targets']);
  const lines = r.out.split(/\r?\n/).filter((l) => l.trim() && !l.includes('Empty'));
  return { code: r.code, raw: r.out, list: lines };
}

function installedVersion(hdc) {
  const r = run(hdc, ['shell', 'bm', 'dump', '-n', BUNDLE], 30000);
  if (r.code !== 0) return { ok: false, raw: r.out };
  const v = (r.out.match(/"versionName"\s*:\s*"([^"]+)"/) || [])[1];
  const c = (r.out.match(/"versionCode"\s*:\s*(\d+)/) || [])[1];
  return { ok: !!v, v, c, raw: r.out };
}

function install(hdc) {
  if (!fs.existsSync(HAP)) { bad('找不到 HAP：' + HAP); return false; }
  const size = fs.statSync(HAP).size;
  info('装包 ' + path.basename(HAP) + ' · ' + size + ' B（覆盖安装 install -r，不清数据）');
  const r = run(hdc, ['install', '-r', HAP], 180000);
  const text = r.out;
  if (r.code === 0 && /success/i.test(text)) { ok('安装成功'); return true; }
  if (/9568320|signature|verify/i.test(text)) bad('签名校验未通过：' + text.slice(0, 300));
  else bad('安装失败（退出码 ' + r.code + '）：' + text.slice(0, 300));
  return false;
}

function launch(hdc) {
  const r = run(hdc, ['shell', 'aa', 'start', '-a', ABILITY, '-b', BUNDLE], 30000);
  if (r.code === 0 || /start ability successfully|successfully/i.test(r.out)) { ok('已启动 ' + BUNDLE + '/' + ABILITY); return true; }
  bad('启动失败：' + r.out.slice(0, 300));
  return false;
}

function shot(hdc) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const remote = '/data/local/tmp/honghub_shot.jpeg';
  const local = path.join(SHOT_DIR, 'honghub_' + new Date().toISOString().replace(/[:.]/g, '-') + '.jpeg');
  run(hdc, ['shell', 'snapshot_display', '-f', remote], 30000);
  const r = run(hdc, ['file', 'recv', remote, local], 60000);
  if (!fs.existsSync(local)) {
    // 老版本系统没有 snapshot_display，退回 screencap
    run(hdc, ['shell', 'screencap', '-p', remote], 30000);
    run(hdc, ['file', 'recv', remote, local], 60000);
  }
  if (fs.existsSync(local)) {
    const s = fs.statSync(local).size;
    ok('截图 ' + local + ' · ' + s + ' B');
    if (s < 20000) info('注意：截图偏小（' + s + ' B），可能停在启动页/白屏，请人工看一眼');
    return { path: local, size: s };
  }
  bad('截图失败');
  return null;
}

(function main() {
  const hdcInfo = findHdc();
  if (!hdcInfo) { bad('未找到 hdc（PATH 与 SDK 默认路径都没有）'); process.exit(1); }
  const hdc = hdcInfo.cmd;
  console.log('=== 深开鸿真机链路（hdc: ' + hdcInfo.via + '）===');
  const t = targets(hdc);
  if (!t.list.length) {
    bad('没有检测到设备（hdc list targets 为空）');
    info('检查：USB 线/无线调试是否开启、设备是否已授权调试、hdc 版本是否匹配');
    process.exit(2);
  }
  ok('设备：' + t.list.join(' | '));

  const before = installedVersion(hdc);
  if (before.ok) info('装机现状 ' + BUNDLE + ' = ' + before.v + ' / #' + before.c);
  else info('装机现状：未安装或无法读取（' + before.raw.split(/\r?\n/)[0] + '）');

  let installed = true;
  if (has('--install') || has('--run')) installed = install(hdc);
  if (!installed) process.exit(1);

  if (has('--run') || has('--shot')) {
    if (has('--run')) launch(hdc);
    const s = shot(hdc);
    if (has('--run')) {
      const after = installedVersion(hdc);
      if (after.ok) ok('装机版本 ' + after.v + ' / #' + after.c);
      else bad('装完读不到版本：' + after.raw.slice(0, 200));
      if (s) info('取证截图：' + path.relative(ROOT, s.path));
    }
  }
  console.log('\n=== 完成 ===');
  info('下次要一条命令跑全流程：npm run hap:device');
})();
