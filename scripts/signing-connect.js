#!/usr/bin/env node
'use strict';
/**
 * Windows 代码签名证书 · 一键接入
 *
 * 用法（用户只需做一步：把 .pfx 证书放进 certs/ 目录）：
 *   node scripts/signing-connect.js                 # 自动发现证书 + 接入 + 自检
 *   node scripts/signing-connect.js --pfx D:\my.pfx --password 口令
 *   node scripts/signing-connect.js --check         # 只检查当前接入状态
 *   node scripts/signing-connect.js --make-selftest # 生成一张本地测试证书（仅验证链路，SmartScreen 不信任）
 *
 * 做了什么：
 *   1) 找证书：--pfx > WIN_CSC_FILE > certs/*.pfx（按修改时间取最新）
 *   2) 读元数据：通过 .NET X509Certificate2 读 subject/签发者/有效期/指纹（口令只经环境变量，
 *      不写命令行，不打印）；判断是否有私钥、是否自签、是否已过期
 *   3) 写 .env：WIN_CSC_FILE / WIN_CSC_KEY_PASSWORD（若给了口令）
 *   4) 自检：调用 sign-windows.js --selftest，在副本上签名验证，绝不动正式产物
 *   5) 结论：明确告知「可用于正式分发」还是「仅链路自测/SmartScreen 会拦截」
 *
 * 安全：证书放 certs/（.gitignore 已排除），口令只写本机 .env（已 gitignore），
 *       仓库与公网下发物都不会包含证书或口令。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CERT_DIR = path.join(ROOT, 'certs');
const ENV_FILE = path.join(ROOT, '.env');
const ARGS = process.argv.slice(2);
const CHECK_ONLY = ARGS.includes('--check');
const MAKE_SELFTEST = ARGS.includes('--make-selftest');
const JSON_OUT = ARGS.includes('--json');
function arg(name) {
  const i = ARGS.indexOf('--' + name);
  return i >= 0 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--') ? ARGS[i + 1] : '';
}
function log(s) { if (!JSON_OUT) console.log(s); }

// ---- 读 .env 到对象（保留其它键）
function readEnv() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function writeEnvKey(key, value) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=.*$', 'm');
  const line = key + '=' + value;
  if (re.test(text)) text = text.replace(re, line);
  else text = text.replace(/\r?\n?$/, '') + '\n' + line + '\n';
  fs.writeFileSync(ENV_FILE, text.replace(/\r?\n/g, '\n'), 'utf8');
}

// ---- 发现证书
function findCert() {
  if (arg('pfx')) return path.resolve(arg('pfx'));
  const configured = process.env.WIN_CSC_FILE || readEnv().WIN_CSC_FILE;
  if (configured && fs.existsSync(configured)) return path.resolve(configured);
  if (fs.existsSync(CERT_DIR)) {
    const pfxs = fs.readdirSync(CERT_DIR).filter(f => /\.pfx$/i.test(f))
      .map(f => ({ p: path.join(CERT_DIR, f), t: fs.statSync(path.join(CERT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (pfxs.length) return pfxs[0].p;
  }
  return '';
}

// ---- 用 .NET 读证书元数据（口令经环境变量，不进命令行/日志）
function inspectCert(pfx, password) {
  const ps = [
    '$ErrorActionPreference="Stop"',
    '$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(' +
      JSON.stringify(pfx) + ', $env:KH_CONNECT_PWD, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)',
    '$self = ($cert.Subject -eq $cert.Issuer)',
    '$now = Get-Date',
    '$valid = ($now -ge $cert.NotBefore -and $now -le $cert.NotAfter)',
    '$o = [pscustomobject]@{',
    'subject=$cert.Subject',
    'issuer=$cert.Issuer',
    'notBefore=$cert.NotBefore.ToString("yyyy-MM-dd")',
    'notAfter=$cert.NotAfter.ToString("yyyy-MM-dd")',
    'thumbprint=$cert.Thumbprint',
    'hasPrivateKey=$cert.HasPrivateKey',
    'selfSigned=$self',
    'valid=$valid',
    '}',
    '$o | ConvertTo-Json -Compress'
  ].join('\n');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, { KH_CONNECT_PWD: password || '' })
  });
  if (r.status !== 0) {
    let err = String(r.stderr || r.stdout || '').trim();
    if (/password|密码/i.test(err)) err = '口令错误或证书受密码保护但未提供正确口令';
    return { ok: false, error: err.slice(0, 240) };
  }
  try { return { ok: true, meta: JSON.parse(r.stdout.trim()) }; }
  catch (e) { return { ok: false, error: '解析证书元数据失败：' + r.stdout.slice(0, 120) }; }
}

// ---- 生成本地测试证书（仅验证链路）
function makeSelftest() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const out = path.join(CERT_DIR, 'codesign-selftest.pfx');
  const pwd = 'KaihongLocalSignTest2026';
  // 用 .NET 在内存里构造并导出，不写证书存储：
  // New-SelfSignedCertificate + CertStoreLocation 在受限账户会报 NTE_PERM(0x80090010)，
  // ConvertTo-SecureString 又会被安全策略拦截；CertificateRequest.CreateSelfSigned +
  // X509Certificate2.Export(Pfx, 明文口令) 纯内存，最稳，口令也只经此处不进命令行日志。
  const ps = [
    '$ErrorActionPreference="Stop"',
    '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
    '$req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest(' +
      '"CN=Kaihong Local Sign Test", $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, ' +
      '[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)',
    // 必须加代码签名 EKU(1.3.6.1.5.5.7.3.3)，否则签名时报「证书不适用于代码签名」
    '$ekuOids = New-Object System.Security.Cryptography.OidCollection',
    '$ekuOids.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.3")) | Out-Null',
    '$req.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($ekuOids, $true)))',
    '$req.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))',
    '$cert = $req.CreateSelfSigned([datetime]::Now.AddDays(-1), [datetime]::Now.AddYears(3))',
    '$bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ' +
      JSON.stringify(pwd) + ')',
    '[System.IO.File]::WriteAllBytes(' + JSON.stringify(out) + ', $bytes)',
    'Write-Output ("OK " + $cert.Thumbprint)'
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8', timeout: 120000
  });
  if (r.status === 0 && fs.existsSync(out)) {
    log('✔ 已生成本地测试证书：' + out);
    log('  ⚠ 该证书自签、SmartScreen 不信任，仅用于验证签名链路，不可用于正式分发。');
    writeEnvKey('WIN_CSC_FILE', out.replace(/\\/g, '/'));
    writeEnvKey('WIN_CSC_KEY_PASSWORD', pwd);
    log('  已写入 .env（WIN_CSC_FILE / WIN_CSC_KEY_PASSWORD）。');
    return 0;
  }
  log('✘ 生成失败：' + String(r.stderr || r.stdout || '').trim().slice(0, 300));
  return 1;
}

function main() {
  if (MAKE_SELFTEST) process.exit(makeSelftest());
  const result = { schema: 1, at: new Date().toISOString(), checkOnly: CHECK_ONLY };

  if (CHECK_ONLY) {
    const cur = process.env.WIN_CSC_FILE || readEnv().WIN_CSC_FILE;
    result.configured = !!cur;
    result.exists = !!(cur && fs.existsSync(cur));
    log(result.configured
      ? '当前证书配置：' + cur + (result.exists ? '（文件存在）' : '（文件缺失）')
      : '当前未配置代码签名证书（SmartScreen 可能拦截未签名包）');
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const pfx = findCert();
  if (!pfx) {
    log('未找到代码签名证书。');
    log('请把 .pfx 证书放进目录：' + CERT_DIR);
    log('然后重新运行：node scripts/signing-connect.js');
    log('（若无正式证书，可先运行 --make-selftest 生成仅供链路自测的证书）');
    result.ok = false; result.error = 'no-certificate';
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  log('发现证书：' + pfx);
  const password = arg('password') || process.env.WIN_CSC_KEY_PASSWORD || readEnv().WIN_CSC_KEY_PASSWORD || '';
  const ins = inspectCert(pfx, password);
  if (!ins.ok) {
    log('✘ 读取证书失败：' + ins.error);
    result.ok = false; result.error = ins.error;
    if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  const m = ins.meta;
  log('  主题：' + m.subject);
  log('  签发：' + m.issuer);
  log('  有效期：' + m.notBefore + ' ~ ' + m.notAfter);
  log('  指纹：' + m.thumbprint);
  log('  私钥：' + (m.hasPrivateKey ? '有' : '无') + ' · 自签：' + (m.selfSigned ? '是' : '否') + ' · 当前有效：' + (m.valid ? '是' : '否'));

  if (!m.hasPrivateKey) { log('✘ 证书不含私钥，无法签名。'); process.exit(1); }
  if (!m.valid) { log('✘ 证书已过期或尚未生效。'); process.exit(1); }

  // 写 .env（路径用正斜杠，避免转义问题）
  writeEnvKey('WIN_CSC_FILE', pfx.replace(/\\/g, '/'));
  if (arg('password')) writeEnvKey('WIN_CSC_KEY_PASSWORD', arg('password'));
  log('✔ 已写入 .env（WIN_CSC_FILE' + (arg('password') ? ' / WIN_CSC_KEY_PASSWORD' : '') + '）');

  // 自检：在副本上签名验证
  log('\n开始签名链路自检（不动正式产物）…');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'sign-windows.js'), '--selftest'], {
    cwd: ROOT, encoding: 'utf8', timeout: 240000,
    env: Object.assign({}, process.env, { WIN_CSC_FILE: pfx.replace(/\\/g, '/') })
  });
  log(r.stdout ? r.stdout.trim() : '');
  const reportPath = path.join(ROOT, 'dist', 'codesign.json');
  let report = {};
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) {}
  const passed = /passed|signed/i.test(report.status || '');
  result.cert = m; result.selftest = report.status || ''; result.ok = passed;
  log('\n' + (passed
    ? (m.selfSigned
        ? '✔ 签名链路自检通过。注意：此证书为自签，SmartScreen 仍会拦截，正式分发请换用受信任 CA 签发的证书。'
        : '✔ 签名链路自检通过，证书来自 CA，可用于正式分发。')
    : '✘ 签名链路自检未通过，请检查证书/口令/签名工具。'));
  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  process.exit(passed ? 0 : 1);
}

main();
