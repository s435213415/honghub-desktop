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
  console.error('目标目录不存在：' + OUT);
  process.exit(1);
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
