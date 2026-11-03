@echo off
setlocal
title TAKDA - one-time setup
cd /d "%~dp0.."

rem --- Bun (the program that runs the scheduler) ---
where bun >nul 2>nul
if not errorlevel 1 (
  set "BUN=bun"
  goto haveBun
)
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN%" goto haveBun
echo Installing Bun (one time only)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
if not exist "%BUN%" (
  echo.
  echo Bun could not be installed. Install it from https://bun.sh and run this file again.
  pause
  exit /b 1
)
:haveBun

echo.
echo Installing the scheduler's packages (this can take a few minutes)...
"%BUN%" install --filter @template/web
if errorlevel 1 goto fail

echo.
echo Building the web app...
cd packages\web
"%BUN%" x vite build
if errorlevel 1 goto fail

echo.
echo ============================================================
echo  Setup finished. Next: double-click 2-start-scheduler.bat
echo ============================================================
pause
exit /b 0

:fail
echo.
echo Setup stopped because of the error above.
pause
exit /b 1
