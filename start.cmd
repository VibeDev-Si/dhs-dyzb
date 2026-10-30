@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 大肥鱼 · 直播页服务
echo.
echo   大肥鱼直播页  http://127.0.0.1:8787
echo   操作台        http://127.0.0.1:8787/admin
echo.
if not exist node_modules (
  echo   首次运行，正在安装弹幕直连需要的依赖...
  call npm install --no-audit --no-fund
  echo.
)
node server.mjs
echo.
echo   服务已退出（错误信息见上面）。
pause
