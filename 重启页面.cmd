@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Restarting server + live page + admin page ...
node tools\restart-pages.mjs --server
echo.
echo Done. Live page keeps its queue; use --fresh to clear it.
pause
