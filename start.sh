#!/bin/bash
# 鸿汇影 · 免费桌面版 启动器（Linux / macOS）—— 双击或在终端运行即可
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装： https://nodejs.org （选 LTS）"
  echo "或直接使用「鸿汇影桌面版」安装包（已内置运行环境）。"
  exit 1
fi
echo "正在启动「鸿汇影 · 免费桌面版」…"
echo "稍候浏览器会自动打开；关闭本窗口或按 Ctrl+C 即停止。"
node server/server.js &
SRV=$!
sleep 2
xdg-open http://localhost:8787/ 2>/dev/null || open http://localhost:8787/ 2>/dev/null || echo "请手动在浏览器打开 http://localhost:8787/"
wait $SRV
echo "服务已停止。"
