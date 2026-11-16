#!/usr/bin/env node
'use strict';
/* 自动批量下发：扫描本次发版的全部架构产物，生成 dist/archs.json 分发清单。
 * - 主链 npm run pack 结束时自动调用（只做清单，不下载、不阻断出包）
 * - npm run pack:archs 会额外尝试真正构建 ia32 / arm64 原生包
 *   （缺二进制或下载失败自动标记 skipped，绝不阻断主交付）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const delivery = require(path.join(ROOT, 'server', 'delivery-plan.js'));
const deviceOptimizer = require(path.join(ROOT, 'server', 'device-optimizer.js'));
const ARCHS = (process.env.KH_ARCHS || 'x64,ia32,arm64').split(',').map(s => s.trim()).filter(Boolean);
const BUILD = process.env.KH_ARCHS_BUILD === '1';

/* 分块流式哈希：不把 77MB 安装包整包读进内存，低内存构建机也能出包 */
function sha(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function size(p) { return fs.statSync(p).size; }
function json(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } }

/* 收集产物：x64 用主链通用包；其它架构用带后缀的原生包 */
function collect(opts) {
  const o = Object.assign({ distDir: path.join(ROOT, 'dist'), version: json(path.join(ROOT, 'package.json'), {}).version, stampFile: path.join(ROOT, 'server', 'feature-version.json') }, opts || {});
  const D = o.distDir;
  const ver = o.version;
  const out = { schema: 1, versionName: ver, generatedAt: new Date().toISOString(), archs: {}, hap: null, features: null };
  const stamp = json(o.stampFile, {});
  out.features = { count: stamp.count || 0, hash: stamp.hash || null, ids: stamp.ids || [] };

  for (const arch of ARCHS) {
    const names = arch === 'x64'
      ? ['desktop-setup.exe', '鸿汇影桌面版 Setup ' + ver + '.exe']
      : ['鸿汇影桌面版 Setup ' + ver + '-' + arch + '.exe', 'desktop-setup-' + arch + '.exe'];
    const hit = names.map(n => path.join(D, n)).find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
    if (hit) {
      out.archs[arch] = {
        status: 'ready', file: path.basename(hit), size: size(hit), sha256: sha(hit),
        url: '/download/' + encodeURIComponent(path.basename(hit)),
        native: arch !== 'x64'
      };
    } else {
      out.archs[arch] = {
        status: arch === 'x64' ? 'missing' : 'fallback',
        file: arch === 'x64' ? 'desktop-setup.exe' : '鸿汇影桌面版 Setup ' + ver + '-' + arch + '.exe',
        url: '/download/desktop-setup.exe',
        fallbackTo: 'x64',
        note: arch === 'x64' ? '主链通用包尚未生成' : '无原生包，自动回退 x64 通用包（ARM64 Windows 可经系统模拟运行）'
      };
    }
  }
  const hap = path.join(D, 'honghub-harmony.hap');
  if (fs.existsSync(hap)) {
    out.hap = { status: 'ready', file: path.basename(hap), size: size(hap), sha256: sha(hap), url: '/download/honghub-harmony.hap' };
  }
  return out;
}

/* 按需构建某个架构的原生包：独立输出目录，避免覆盖 x64 主产物 */
function buildArch(arch, ver) {
  const outDir = path.join(ROOT, 'dist', 'arch-' + arch);
  const CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
  const ENV = Object.assign({}, process.env, {
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
    ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/'
  });
  fs.mkdirSync(outDir, { recursive: true });
  const base = [CLI, '--win', '--' + arch, '--config.directories.output=' + outDir.replace(/\\/g, '/')];
  let r = spawnSync(process.execPath, base.concat(['--dir']), { cwd: ROOT, stdio: 'pipe', env: ENV, timeout: 8 * 60 * 1000 });
  if (r.status !== 0) return { ok: false, reason: 'electron 二进制下载/构建失败（' + arch + '）' };
  r = spawnSync(process.execPath, base.concat(['--prepackaged', path.join(outDir, 'win-unpacked').replace(/\\/g, '/')]), { cwd: ROOT, stdio: 'pipe', env: ENV, timeout: 8 * 60 * 1000 });
  if (r.status !== 0) return { ok: false, reason: 'NSIS 打包失败（' + arch + '）' };
  const setup = path.join(outDir, '鸿汇影桌面版 Setup ' + ver + '.exe');
  if (!fs.existsSync(setup)) return { ok: false, reason: '未找到架构安装包' };
  const dst = path.join(ROOT, 'dist', '鸿汇影桌面版 Setup ' + ver + '-' + arch + '.exe');
  fs.copyFileSync(setup, dst);
  fs.writeFileSync(dst + '.sha256', sha(dst) + '  ' + path.basename(dst) + '\n');
  return { ok: true, file: path.basename(dst), size: size(dst) };
}

function main() {
  const ver = json(path.join(ROOT, 'package.json'), {}).version;
  console.log('=== 自动批量下发清单 v' + ver + ' ===');
  if (BUILD) {
    for (const arch of ARCHS) {
      if (arch === 'x64') continue;
      const dst = path.join(ROOT, 'dist', '鸿汇影桌面版 Setup ' + ver + '-' + arch + '.exe');
      if (fs.existsSync(dst)) { console.log('  ' + arch + ' 原生包已存在，跳过构建'); continue; }
      console.log('  构建 ' + arch + ' 原生包…');
      const r = buildArch(arch, ver);
      console.log('  ' + (r.ok ? '成功 ' + r.file + ' (' + r.size + ' B)' : '跳过：' + r.reason));
    }
  }
  const snap = collect({ version: ver });
  fs.writeFileSync(path.join(ROOT, 'dist', 'archs.json'), JSON.stringify(snap, null, 2) + '\n');
  const ready = Object.keys(snap.archs).filter(a => snap.archs[a].status === 'ready');
  console.log('  架构产物：' + ready.join(' / ') + '（其余自动回退 x64）');
  console.log('  开鸿 HAP：' + (snap.hap ? snap.hap.size + ' B' : '未生成'));
  console.log('  功能清单：' + snap.features.count + ' 项 · ' + (snap.features.hash || '-'));
  console.log('  已写出 dist/archs.json（供 /api/batch 批量分发）');
  // OS 版本检测 → 自动优化 → 自动修复 → 写入适配矩阵，随本次发版一起下发
  const opt = deviceOptimizer.run();
  console.log('  系统版本适配：' + opt.summary.families + ' 个系统家族 / ' + opt.summary.osVersions +
    ' 个版本 · 自动修复 ' + opt.summary.fixesApplied + ' 项（无需人工复核）');
  // 一次发版 = 一份「不限设备 / 不限内存」的下发清单，并附版本 / 校验值供自动更新比对
  const d = delivery.writeDelivery(snap);
  console.log('  下发通道：免安装在线版（任意内存）/ 开鸿 HAP / 完整安装包（x64·ia32·arm64）');
  console.log('  内存档位：' + Object.keys(d.memoryTiers).map(k => k + '≤' +
    (d.memoryTiers[k].maxBufferSizeMB + 'MB 缓冲')).join(' · '));
  console.log('  已写出 dist/delivery.json（/api/delivery · /api/delivery/plan 自动更新比对）');
}

if (require.main === module) main();
module.exports = { collect: collect, buildArch: buildArch };
