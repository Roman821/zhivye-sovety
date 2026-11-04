@echo off
setlocal
cd /d "%~dp0"
set "SOVETY_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "SOVETY_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%SOVETY_NODE%" launch.mjs
if errorlevel 1 goto failed
start "" "http://127.0.0.1:18765"
exit /b 0
:failed
echo Could not start. Node.js 24 or newer is required. See data/server.log.
pause
