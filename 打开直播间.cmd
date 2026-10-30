@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 打开直播间窗口：没有地址栏、不管自动播放策略，打开就有声音
rem   --autoplay-policy=no-user-gesture-required  让浏览器放行自动播放
rem   --app=...                                   去掉标签栏/地址栏，适合投到 OBS 或副屏
rem   --user-data-dir                              单独一个配置目录，不污染平时的 Chrome

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo 没找到 Chrome，请先装 Chrome，或把 CHROME 改成你自己的浏览器路径。
  pause
  exit /b 1
)

start "" "%CHROME%" ^
  --autoplay-policy=no-user-gesture-required ^
  --app=http://127.0.0.1:8787/?auto=1 ^
  --window-size=1920,1080 ^
  --window-position=0,0 ^
  --user-data-dir="%~dp0data\chrome-live" ^
  --no-first-run ^
  --no-default-browser-check
