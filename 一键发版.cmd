@echo off
setlocal
cd /d "%~dp0"
rem 签名口令 OH_KEY_PWD 由 scripts/oneclick-release.js 从 .env 加载，禁止在此硬编码
set PATH=C:\Windows\System32;C:\Windows;%PATH%
node scripts\oneclick-release.js %*
echo.
echo Exit code: %ERRORLEVEL%
pause