@echo off
setlocal
title TAKDA scheduler - keep this window open
cd /d "%~dp0..\packages\web"

set "BUN=bun"
where bun >nul 2>nul || set "BUN=%USERPROFILE%\.bun\bin\bun.exe"

if not exist "dist\index.html" (
  echo The app isn't built yet. Run 1-setup.bat first.
  pause
  exit /b 1
)

set PORT=4200
rem Optional settings (public address, email): copy settings-example.bat to settings.bat and edit it.
if exist "%~dp0settings.bat" call "%~dp0settings.bat"
echo The scheduler is running at  http://localhost:4200
echo Data file:  %CD%\data\scheduler.db
echo Close this window to stop the scheduler.
echo.
"%BUN%" src\server.ts
echo.
echo The scheduler has stopped.
pause
