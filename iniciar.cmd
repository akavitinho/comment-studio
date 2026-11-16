@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instale as dependencias com npm install antes de iniciar.
  pause
  exit /b 1
)
if exist "build\runtime\ffmpeg.exe" if exist "build\runtime\ffprobe.exe" set "PATH=%CD%\build\runtime;%PATH%"
where.exe ffmpeg.exe >nul 2>&1
if errorlevel 1 goto missing_ffmpeg
where.exe ffprobe.exe >nul 2>&1
if errorlevel 1 goto missing_ffmpeg
set ELECTRON_RUN_AS_NODE=
start "Comment Studio" "node_modules\electron\dist\electron.exe" .
exit /b 0

:missing_ffmpeg
echo FFmpeg e FFprobe nao foram encontrados.
echo Instale os dois programas e adicione a pasta bin deles ao PATH do Windows.
echo Depois feche esta janela e abra o iniciar.cmd novamente.
pause
exit /b 1
