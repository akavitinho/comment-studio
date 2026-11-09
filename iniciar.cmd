@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instale as dependencias com npm install antes de iniciar.
  pause
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "Comment Studio" "node_modules\electron\dist\electron.exe" .
