#!/usr/bin/env node
'use strict';
/* 鸿汇影 · 开发端交付脚本生成器
   把桌面交付夹里那几个 .cmd / .vbs 固定下来，避免换机或重新出包时丢失修复。

   生成 3 个脚本（全部纯 ASCII / 无 BOM / CRLF，规避 GBK cmd 下的解析问题）：
     1) 安装后转开发端.cmd  — 自动定位安装目录写 dev-mode.flag（支持中文目录名/自定义路径）
     2) 启动开发者端.cmd    — 免安装版启动，通配符找 exe，不写死中文文件名
     3) 创建桌面快捷方式.vbs — 生成带 exe 图标的桌面快捷方式

   用法：node scripts/build-dev-package.js [目标目录]
   默认目标：~/Desktop/鸿汇影·开发端_v<package.version>
*/
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const OUT = process.argv[2] || path.join(os.homedir(), 'Desktop', '鸿汇影·开发端_v' + VER);

const FILES = {
  '安装后转开发端.cmd': [
    '@echo off',
    'setlocal',
    'REM Enable dev mode by dropping dev-mode.flag next to the installed exe.',
    'REM Auto-locate the install dir via resources\\app\\electron-main.js so that',
    'REM custom install paths and localized folder names are handled correctly.',
    'set "FOUND="',
    'for /d %%D in ("%LOCALAPPDATA%\\Programs\\*" "%ProgramFiles%\\*" "%ProgramFiles(x86)%\\*") do (',
    '  if not defined FOUND if exist "%%D\\resources\\app\\electron-main.js" set "FOUND=%%D"',
    ')',
    'if not defined FOUND (',
    '  echo [ERROR] HongHub install directory not found. Please run the setup first.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo 1 > "%FOUND%\\dev-mode.flag"',
    'echo [OK] Dev mode enabled: %FOUND%\\dev-mode.flag',
    'echo Restart the app, it will open the admin board at http://127.0.0.1:8787/admin',
    'echo To return to client mode, just delete that dev-mode.flag file.',
    'pause',
    ''
  ].join('\r\n'),

  '启动开发者端.cmd': [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'set KH_DEV_MODE=1',
    'REM Located by wildcard so a renamed/unicode exe name can never break startup.',
    'set "EXE="',
    'for %%f in ("%~dp0*.exe") do set "EXE=%%f"',
    'if not defined EXE (',
    '  echo [ERROR] Main exe not found in this folder.',
    '  pause',
    '  exit /b 1',
    ')',
    'start "" "%EXE%" --dev',
    ''
  ].join('\r\n'),

  '创建桌面快捷方式.vbs': [
    "' Create desktop shortcut for HongHub dev build (no admin rights needed)",
    'Option Explicit',
    'Dim ws, fso, desktop, folder, exe, target, lnk, f',
    'Set ws = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'desktop = ws.SpecialFolders("Desktop")',
    'folder = ws.CurrentDirectory',
    "' Locate the single main exe in this folder by wildcard (avoids unicode name issues)",
    'exe = ""',
    'For Each f In fso.GetFolder(folder).Files',
    '    If LCase(fso.GetExtensionName(f.Name)) = "exe" Then',
    '        exe = f.Path',
    '        Exit For',
    '    End If',
    'Next',
    'If exe = "" Then',
    '    MsgBox "Main exe not found in:" & vbCrLf & folder, 48, "HongHub"',
    '    WScript.Quit 1',
    'End If',
    'target = desktop & "\\HongHub-Dev.lnk"',
    'Set lnk = ws.CreateShortcut(target)',
    'lnk.TargetPath = exe',
    'lnk.Arguments = "--dev"',
    'lnk.WorkingDirectory = folder',
    'lnk.IconLocation = exe & ",0"',
    'lnk.Description = "HongHub Desktop - Dev (admin board)"',
    'lnk.Save',
    'MsgBox "Desktop shortcut created:" & vbCrLf & target, 64, "HongHub"',
    ''
  ].join('\r\n')
};

if (!fs.existsSync(OUT)) {
  fs.mkdirSync(OUT, { recursive: true }); // 新版本首次出包时目录还不存在，自动创建
}
let n = 0;
for (const [name, content] of Object.entries(FILES)) {
  const buf = Buffer.from(content, 'ascii'); // 纯 ASCII，永不产生 BOM
  fs.writeFileSync(path.join(OUT, name), buf);
  if (buf[0] === 0xef) throw new Error(name + ' 意外带 BOM');
  console.log('  生成 ' + name + ' · ' + buf.length + ' B · no-BOM');
  n++;
}
console.log('开发端脚本生成完成：' + n + ' 个 → ' + OUT);

/* 签名密钥自动同步：每次出包都把工程里的签名链复制进开发端交付夹，
   工程里轮换密钥后，桌面开发端夹自动跟着更新，不用手工拷贝。
   只进开发端夹，绝不进客户成品与下发通道。 */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b);
    else fs.copyFileSync(a, b);
  }
}

function syncSigningKeys() {
  const src = path.join(ROOT, 'harmony', 'signing');
  const dst = path.join(OUT, '签名密钥');
  if (!fs.existsSync(path.join(src, 'keys'))) { console.log('  签名材料缺失，跳过同步'); return; }
  fs.mkdirSync(dst, { recursive: true });
  copyTree(path.join(src, 'keys'), path.join(dst, 'keys'));
  for (const f of ['app-chain.pem', 'app.p7b', 'outCertChain.cer', 'outprofile.p7b', 'profile-chain.pem', 'README.txt', 'resign_hap.py']) {
    const p = path.join(src, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dst, f));
  }
  let pwd = 'OpenHarmony123';
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/OH_KEY_PWD\s*=\s*(\S+)/);
    if (m) pwd = m[1];
  } catch (e) { /* 用默认口令 */ }
  let token = '';
  for (const p of [path.join(ROOT, 'server', 'data', 'access-token.txt'),
                   'C:\\Users\\admin\\HongHub-Dev\\resources\\app\\server\\data\\access-token.txt']) {
    try { token = fs.readFileSync(p, 'utf8').trim(); if (token) break; } catch (e) {}
  }
  fs.writeFileSync(path.join(dst, '签名口令.txt'), 'OH_KEY_PWD=' + pwd + '\r\nkeyAlias=app-key / profile-key\r\n');
  fs.writeFileSync(path.join(dst, '说明.txt'), [
    '鸿汇影 · 深开鸿签名材料（仅开发端，绝不外发）',
    '==================================================',
    '用途：重签 HAP，保证升级后签名链不变、可覆盖安装。',
    '  app-key.p12        应用私钥（keyAlias: app-key）',
    '  profile-key.p12    profile 私钥（keyAlias: profile-key）',
    '  app-chain.pem      应用证书链',
    '  app.p7b            应用 profile（备用 outprofile.p7b）',
    '口令：见同目录「签名口令.txt」或工程根 .env 的 OH_KEY_PWD。',
    '命令行工具：C:\\Users\\admin\\Desktop\\软件开发工具\\command-line-tools',
    '  sdk\\26.0.1\\toolchains\\lib\\hap-sign-tool.jar',
    '  tool\\jre\\bin\\java.exe',
    '重签：工程根执行 python harmony\\signing\\resign_hap.py',
    '注意：p12/pem/p7b 只放开发端夹，绝不进客户成品与下发通道。',
    ''
  ].join('\r\n'));
  fs.writeFileSync(path.join(OUT, '密钥与口令清单_v' + VER + '.txt'), [
    '鸿汇影 · 密钥与口令清单（v' + VER + '）',
    '==================================================',
    '一、开发端运维面板',
    '  本机：http://127.0.0.1:8787/admin',
    '  局域网：http://<本机IPv4>:8787/admin（ipconfig 查）',
    '  访问口令：' + (token || '见 server/data/access-token.txt'),
    '  口令文件：C:\\Users\\admin\\HongHub-Dev\\resources\\app\\server\\data\\access-token.txt',
    '  面板支持 ?token= 自动登录；本机回环可用 /api/dev/access-token 自助读取。',
    '',
    '二、深开鸿 HAP 签名（仅开发端，绝不外发）',
    '  口令：OH_KEY_PWD=' + pwd,
    '  应用私钥：签名密钥\\keys\\sign-keys\\app-key.p12（keyAlias app-key）',
    '  profile 私钥：签名密钥\\keys\\sign-keys\\profile-key.p12（keyAlias profile-key）',
    '  证书链：签名密钥\\keys\\app-chain.pem · 证书：app-end.cer',
    '  profile：签名密钥\\keys\\app.p7b（备用 outprofile.p7b）',
    '  命令行工具：C:\\Users\\admin\\Desktop\\软件开发工具\\command-line-tools',
    '  一键重签：工程根执行 python harmony\\signing\\resign_hap.py',
    '',
    '三、客户下发（只发客户成品）',
    '  客户不接触口令、签名私钥、开发端安装包。',
    '  下发文件：鸿汇影桌面版 Setup <版本>.exe / 鸿汇影免安装 <版本>.zip / HongHubMovie.hap',
    ''
  ].join('\r\n'));
  console.log('  签名密钥已同步：' + dst);
}
syncSigningKeys();
