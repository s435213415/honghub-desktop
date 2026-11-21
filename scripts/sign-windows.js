#!/usr/bin/env node
'use strict';
/* Windows Authenticode 代码签名（可插拔）。
   未配置证书时明确输出 SKIPPED 且不阻断构建；配置后必须在 postpack 之前执行，
   因为签名会改变 exe 字节，sha256 需要随后重算。

   --selftest：把安装包复制到 _signtmp/ 副本上签名并验证，绝不动正式产物
   （正式产物的 SHA256 已写进 dist/release.json、桌面交付物与资料库）。
   可设 WIN_CSC_TARGET 指定单个文件，WIN_CSC_TARGETS 用分号分隔多个文件；
   WIN_CSC_TIMESTAMP= 可关闭时间戳。

   1.7.80 起支持多目标（Setup / 免安装主程序）并统一写 dist/codesign.json：
   记录整体 status（任一失败即 failed、全部跳过为 skipped）与每个文件的明细。 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const env = require('./lib/env');

const ROOT = env.ROOT;
env.apply();
const LOADED = env.loadEnv();
const SELFTEST = process.argv.includes('--selftest');
// 自检模式若未指定证书，自动使用仓库内生成的本地测试证书（仅验证链路，不用于正式分发）
const SELF_CERT = path.join(ROOT, 'certs', 'codesign-selftest.pfx');
const CERT = process.env.WIN_CSC_FILE || LOADED.WIN_CSC_FILE || (SELFTEST && fs.existsSync(SELF_CERT) ? SELF_CERT : '');
const PWD = process.env.WIN_CSC_KEY_PASSWORD || LOADED.WIN_CSC_KEY_PASSWORD ||
  (SELFTEST && CERT === SELF_CERT ? 'KaihongLocalSignTest2026' : '');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const EXE = path.join(ROOT, 'dist', '鸿汇影桌面版 Setup ' + VERSION + '.exe');
const TARGETS = String(process.env.WIN_CSC_TARGETS || process.env.WIN_CSC_TARGET || '')
  .split(';').map(s => s.trim()).filter(Boolean);
if (!TARGETS.length) TARGETS.push(SELFTEST ? path.join(ROOT, '_signtmp', 'Setup-selftest.exe') : EXE);
const TIMESTAMP = process.env.WIN_CSC_TIMESTAMP !== undefined ? process.env.WIN_CSC_TIMESTAMP : 'http://timestamp.digicert.com';
const REPORT = path.join(ROOT, 'dist', 'codesign.json');

function writeReport(status, detail, files, tool) {
  const out = {
    status, version: VERSION, tool: tool || null,
    file: files.length === 1 ? files[0].file : null,
    files: files, selftest: SELFTEST, detail, at: new Date().toISOString()
  };
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify(out, null, 2) + '\n');
  } catch (e) { /* 报告写不进去不影响发版 */ }
  console.log('  [代码签名] ' + status.toUpperCase() + ' — ' + detail);
  process.exit(0);   // 可插拔能力：缺证书/缺工具都不阻断发版
}

const skipAll = (detail) => writeReport('skipped', detail,
  TARGETS.map(t => ({ file: path.basename(t), status: 'skipped', detail })), null);

if (!CERT) skipAll('未配置 WIN_CSC_FILE；SmartScreen 可能拦截未签名安装包。配置见 .env.example');
if (!fs.existsSync(CERT)) skipAll('证书文件不存在：' + CERT);

/* 自检：把正式 Setup 复制成副本再签，正式产物一个字节都不动 */
if (SELFTEST && !process.env.WIN_CSC_TARGET && !process.env.WIN_CSC_TARGETS) {
  if (!fs.existsSync(EXE)) skipAll('安装包不存在，跳过：' + path.basename(EXE));
  fs.mkdirSync(path.dirname(TARGETS[0]), { recursive: true });
  fs.copyFileSync(EXE, TARGETS[0]);
  console.log('  [代码签名] 自检模式：已复制安装包到副本 ' + path.basename(TARGETS[0]) + '（正式产物不变）');
}

// 优先 signtool（Windows SDK）
function findSigntool() {
  const roots = [
    process.env.WIN_SIGNTOOL || '',
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin'
  ];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    if (root.endsWith('.exe') && fs.existsSync(root)) return root;
    const dirs = root.indexOf('Kits') >= 0 ? fs.readdirSync(root).filter(d => /^\d+\.\d+\.\d+\.\d+$/.test(d)) : [''];
    for (const d of dirs) {
      const p = path.join(root, d, 'x64', 'signtool.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  const w = spawnSync('where', ['signtool'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout) {
    const p = w.stdout.trim().split(/\r?\n/)[0];
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* PowerShell 通道：本机 PATH 可能不含 System32（构建会话里常见），先用绝对路径，再退回 PATH。 */
function findPowerShell() {
  const cands = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'pwsh.exe')
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return 'powershell';
}

const TOOL = findSigntool();
const SHELL = findPowerShell();
const q = (s) => '"' + String(s).replace(/"/g, '`"') + '"';

function signWithSigntool(target) {
  const args = ['sign', '/f', CERT, '/fd', 'SHA256'];
  if (TIMESTAMP) args.push('/tr', TIMESTAMP, '/td', 'SHA256');
  if (PWD) args.push('/p', PWD);
  args.push(target);
  const r = spawnSync(TOOL, args, { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) return { status: 'failed', detail: 'signtool 返回 ' + r.status + '：' + String(r.stdout || r.stderr || '').trim().slice(0, 180) };
  const v = spawnSync(TOOL, ['verify', '/pa', target], { encoding: 'utf8', timeout: 60000 });
  return {
    status: v.status === 0 ? 'signed' : 'failed',
    detail: v.status === 0 ? 'Authenticode 签名并校验通过（SHA256' + (TIMESTAMP ? ' + 时间戳' : '') + '）' : '签名完成但 verify 未通过'
  };
}

/* PowerShell 兜底。
   关键坑一：构建会话的 PSModulePath 常被 pwsh7 的 Modules 目录占满，Windows PowerShell 5.1 会
   「找得到 Set-AuthenticodeSignature 但模块加载失败」；子进程环境里换成 5.1 自己的模块路径。
   关键坑二：Set-AuthenticodeSignature 要求证书在当前用户证书存储里；先把证书临时导入 My 存储，
   签完立即移除（finally 保证清理）。口令只经环境变量传入，不进命令行/日志。
   自签证书链不受信任时 Status=UnknownError 属预期，硬判据是「签名块存在且指纹匹配」。 */
function signWithPowerShell(target) {
  const ps = [
    '$ErrorActionPreference="Stop"',
    '$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(' +
      q(CERT) + ', $env:KH_CSC_PWD, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet)',
    'if (-not $cert.HasPrivateKey) { Write-Error "PFX 未包含私钥，无法签名"; exit 1 }',
    '$store = New-Object System.Security.Cryptography.X509Certificates.X509Store("My","CurrentUser")',
    '$imported = $false',
    'try {',
    '  $store.Open("ReadWrite"); $store.Add($cert); $imported = $true; $store.Close()',
    '  $signParams = @{ FilePath=' + q(target) + '; Certificate=$cert; HashAlgorithm="SHA256" }',
    '  if ($env:KH_CSC_TIMESTAMP) { $signParams.TimestampServer = $env:KH_CSC_TIMESTAMP }',
    '  $r = Set-AuthenticodeSignature @signParams',
    '  $v = Get-AuthenticodeSignature -FilePath ' + q(target),
    '  if (-not $v.SignerCertificate) { Write-Error ("签名块缺失: " + $r.Status + " " + $r.StatusMessage); exit 1 }',
    '  if ($v.SignerCertificate.Thumbprint -ne $cert.Thumbprint) { Write-Error "签名证书指纹不匹配"; exit 1 }',
    '  if ($v.Status -notin @("Valid","UnknownError")) { Write-Error ("签名状态异常: " + $v.Status); exit 1 }',
    '  Write-Output ("SIGNED " + $v.Status + " " + $v.SignerCertificate.Thumbprint)',
    '} finally {',
    '  if ($imported) { try { $store.Open("ReadWrite"); $store.Remove($cert); $store.Close() } catch {} }',
    '}'
  ].join('\n');
  const r = spawnSync(SHELL, ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8', timeout: 180000,
    env: Object.assign({}, process.env, {
      KH_CSC_PWD: PWD, KH_CSC_TIMESTAMP: TIMESTAMP,
      PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
    })
  });
  const outText = String(r.stdout || '').trim();
  if (r.status === 0) return { status: 'signed', detail: 'Authenticode 签名并校验通过（PowerShell 通道）' + (outText ? ' · ' + outText.slice(0, 120) : '') };
  if (!TOOL) return { status: 'skipped', detail: '未找到 signtool 且 PowerShell 签名不可用：' + String(r.stderr || r.error || '').toString().trim().slice(0, 180) };
  return { status: 'failed', detail: 'PowerShell 签名失败：' + String(r.stderr || r.error || '').toString().trim().slice(0, 180) };
}

const files = [];
let anyFail = false, anySign = false, skipNote = '';
for (const target of TARGETS) {
  const name = path.basename(target);
  if (!fs.existsSync(target)) {
    files.push({ file: name, status: 'skipped', detail: '文件不存在，跳过' });
    if (!skipNote) skipNote = '目标文件不存在：' + name;
    continue;
  }
  const res = TOOL ? signWithSigntool(target) : signWithPowerShell(target);
  if (res.status === 'failed' && TOOL) {
    /* signtool 存在但失败时，再给 PowerShell 通道一次机会（常见于 signtool 版本/时间戳网络问题） */
    const alt = signWithPowerShell(target);
    if (alt.status === 'signed') res.status = 'signed', res.detail = alt.detail;
  }
  if (res.status === 'failed') anyFail = true;
  if (res.status === 'signed') anySign = true;
  if (res.status === 'skipped' && !skipNote) skipNote = res.detail;
  files.push({ file: name, status: res.status, detail: res.detail });
  console.log('  [代码签名] ' + name + ' → ' + res.status.toUpperCase());
}

const tool = TOOL || (anySign ? 'PowerShell Set-AuthenticodeSignature' : null);
if (anyFail) writeReport('failed', '至少一个目标签名或校验失败，见 files', files, tool);
if (anySign) writeReport(SELFTEST ? 'selftest-passed' : 'signed',
  files.filter(f => f.status === 'signed').map(f => f.file).join(' / ') + ' 已签名并通过校验', files, tool);
skipAll(skipNote || '无可签目标');
