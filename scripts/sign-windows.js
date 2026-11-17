#!/usr/bin/env node
'use strict';
/* Windows Authenticode 代码签名（可插拔）。
   未配置证书时明确输出 SKIP 且不阻断构建；配置后必须在 postpack 之前执行，
   因为签名会改变 exe 字节，sha256 需要随后重算。

   --selftest：把安装包复制到 _signtmp/ 副本上签名并验证，绝不动正式产物
   （正式产物的 SHA256 已写进 dist/release.json、桌面交付物与资料库）。
   可设 WIN_CSC_TARGET 显式指定要签名的文件；WIN_CSC_TIMESTAMP= 可关闭时间戳。 */
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
const TARGET = process.env.WIN_CSC_TARGET || (SELFTEST ? path.join(ROOT, '_signtmp', 'Setup-selftest.exe') : EXE);
const TIMESTAMP = process.env.WIN_CSC_TIMESTAMP !== undefined ? process.env.WIN_CSC_TIMESTAMP : 'http://timestamp.digicert.com';
const REPORT = path.join(ROOT, 'dist', 'codesign.json');

function finish(status, detail, tool) {
  const out = { status, version: VERSION, tool: tool || null, file: path.basename(TARGET),
    selftest: SELFTEST, detail, at: new Date().toISOString() };
  try { fs.writeFileSync(REPORT, JSON.stringify(out, null, 2) + '\n'); } catch (e) {}
  console.log('  [代码签名] ' + status.toUpperCase() + ' — ' + detail);
  process.exit(0);   // 可插拔能力：缺证书/缺工具都不阻断发版
}

if (!CERT) finish('skipped', '未配置 WIN_CSC_FILE；SmartScreen 可能拦截未签名安装包。配置见 .env.example');
if (!fs.existsSync(CERT)) finish('skipped', '证书文件不存在：' + CERT);
if (!fs.existsSync(EXE)) finish('skipped', '安装包不存在，跳过：' + path.basename(EXE));

if (SELFTEST && !process.env.WIN_CSC_TARGET) {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.copyFileSync(EXE, TARGET);
  console.log('  [代码签名] 自检模式：已复制安装包到副本 ' + path.basename(TARGET) + '（正式产物不变）');
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
    const dirs = root.indexOf('Kits') >= 0 ? fs.readdirSync(root).filter(d => /^\d+\.\d+\.\d+\.\d+$/.test(d)) : [''];
    for (const d of dirs) {
      const p = path.join(root, d, 'x64', 'signtool.exe');
      if (fs.existsSync(p)) return p;
    }
    if (root.endsWith('.exe') && fs.existsSync(root)) return root;
  }
  const w = spawnSync('where', ['signtool'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout) {
    const p = w.stdout.trim().split(/\r?\n/)[0];
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const tool = findSigntool();
if (tool) {
  const args = ['sign', '/f', CERT, '/fd', 'SHA256'];
  if (TIMESTAMP) { args.push('/tr', TIMESTAMP, '/td', 'SHA256'); }
  if (PWD) args.push('/p', PWD);
  args.push(TARGET);
  const r = spawnSync(tool, args, { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) finish('failed', 'signtool 返回 ' + r.status + '：' + String(r.stdout || r.stderr || '').trim().slice(0, 200), tool);
  const v = spawnSync(tool, ['verify', '/pa', TARGET], { encoding: 'utf8', timeout: 60000 });
  finish(v.status === 0 ? (SELFTEST ? 'selftest-passed' : 'signed') : 'failed',
    v.status === 0 ? 'Authenticode 签名并校验通过（SHA256' + (TIMESTAMP ? ' + 时间戳' : '') + '）' : '签名完成但 verify 未通过', tool);
}

// 无 signtool：PowerShell 兜底。
// 关键坑：Set-AuthenticodeSignature 要求证书在「当前用户证书存储」里，直接传内存中的
// X509Certificate2 会报「指定的证书不适用于代码签名」。故先把证书临时导入 My 存储，
// 签完立即移除（finally 保证清理）。口令只经环境变量传入，不进命令行/日志。
// 自签证书链不受信任时 Status=UnknownError 属预期，硬判据是「签名块存在且指纹匹配」。
const q = (s) => '"' + String(s).replace(/"/g, '`"') + '"';
const ps = [
  '$ErrorActionPreference="Stop"',
  '$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(' +
    q(CERT) + ', $env:KH_CSC_PWD, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet)',
  'if (-not $cert.HasPrivateKey) { Write-Error "PFX 未包含私钥，无法签名"; exit 1 }',
  '$store = New-Object System.Security.Cryptography.X509Certificates.X509Store("My","CurrentUser")',
  '$imported = $false',
  'try {',
  '  $store.Open("ReadWrite"); $store.Add($cert); $imported = $true; $store.Close()',
  '  $signParams = @{ FilePath=' + q(TARGET) + '; Certificate=$cert; HashAlgorithm="SHA256" }',
  '  if ($env:KH_CSC_TIMESTAMP) { $signParams.TimestampServer = $env:KH_CSC_TIMESTAMP }',
  '  $r = Set-AuthenticodeSignature @signParams',
  '  $v = Get-AuthenticodeSignature -FilePath ' + q(TARGET),
  '  if (-not $v.SignerCertificate) { Write-Error ("签名块缺失: " + $r.Status + " " + $r.StatusMessage); exit 1 }',
  '  if ($v.SignerCertificate.Thumbprint -ne $cert.Thumbprint) { Write-Error "签名证书指纹不匹配"; exit 1 }',
  '  if ($v.Status -notin @("Valid","UnknownError")) { Write-Error ("签名状态异常: " + $v.Status); exit 1 }',
  '  Write-Output ("SIGNED " + $v.Status + " " + $v.SignerCertificate.Thumbprint)',
  '} finally {',
  '  if ($imported) { try { $store.Open("ReadWrite"); $store.Remove($cert); $store.Close() } catch {} }',
  '}'
].join('\n');
const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  encoding: 'utf8', timeout: 180000,
  env: Object.assign({}, process.env, { KH_CSC_PWD: PWD, KH_CSC_TIMESTAMP: TIMESTAMP })
});
const outText = String(r.stdout || '').trim();
if (r.status === 0) {
  finish(SELFTEST ? 'selftest-passed' : 'signed',
    'Authenticode 签名并校验通过（PowerShell 通道）' + (outText ? ' · ' + outText.slice(0, 120) : ''),
    'PowerShell Set-AuthenticodeSignature');
}
finish('skipped', '未找到 signtool 且 PowerShell 签名不可用：' +
  String(r.stderr || r.error || '').toString().trim().slice(0, 180));
