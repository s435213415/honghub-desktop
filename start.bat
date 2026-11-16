@echo off
cd /d "%~dp0"
rem 鸿汇影 · 免费桌面版 —— 双击即可运行（无需输入任何命令）
where node >nul 2>nul
if errorlevel 1 (
  echo ─────────────────────────────────────────────
  echo  未检测到 Node.js 运行环境。
  echo  方式一：安装 Node.js（选 LTS）后重试： https://nodejs.org
  echo  方式二：直接用「鸿汇影桌面版」安装包（已内置运行环境，双击安装即可）
  echo ─────────────────────────────────────────────
  pause
  exit /b 1
)
echo 正在启动「鸿汇影 · 免费桌面版」…
echo 稍候浏览器会自动打开；关闭本窗口即可停止服务。
start "" http://localhost:8787/
timeout /t 2 >nul
node server/server.js
echo 服务已停止。
pause
