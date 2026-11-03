@echo off
setlocal
title Back up the online database
cd /d "%~dp0..\packages\web"
set "BACKUP_DIR=C:\ZENE_CODING\TAKDA\backups"

set "BUN=bun"
where bun >nul 2>nul || set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "node_modules" goto nosetup
if exist "%~dp0settings.bat" call "%~dp0settings.bat"

if "%TURSO_URL%"=="" set /p "TURSO_URL=Turso database URL (starts with libsql://): "
if "%TURSO_TOKEN%"=="" set /p "TURSO_TOKEN=Turso token: "
if "%TURSO_URL%"=="" goto cancelled

if not exist "%BACKUP_DIR%\" mkdir "%BACKUP_DIR%" || goto mkfail
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%i"
set "OUT=%BACKUP_DIR%\online-%STAMP%.db"

rem Copy from the online database into a new file (nothing online changes).
set "SOURCE_URL=%TURSO_URL%"
set "SOURCE_TOKEN=%TURSO_TOKEN%"
set "DATABASE_URL=file:%OUT%"
set "DATABASE_AUTH_TOKEN="
"%BUN%" scripts\import-from-turso.ts >nul || goto fail
echo Saved  %OUT%
echo To use it on this PC: close the scheduler, then copy it over packages\web\data\scheduler.db.
pause
exit /b 0

:nosetup
echo Run 1-setup.bat first.
pause
exit /b 1

:mkfail
echo The folder %BACKUP_DIR% could not be created.
pause
exit /b 1

:cancelled
echo Cancelled.
pause
exit /b 1

:fail
echo The backup did not finish. Check the URL and token, then try again.
pause
exit /b 1
