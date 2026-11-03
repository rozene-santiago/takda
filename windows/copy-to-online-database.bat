@echo off
setlocal
title Copy schedules to the online database
cd /d "%~dp0..\packages\web"

set "BUN=bun"
where bun >nul 2>nul || set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "node_modules" goto nosetup
if exist "%~dp0settings.bat" call "%~dp0settings.bat"

rem Which file to copy: a .db file dropped on this script, or this PC's data file.
set "SRC=%CD%\data\scheduler.db"
if not "%~1"=="" set "SRC=%~f1"
if /i "%~x1"==".zip" goto zipfile
if not exist "%SRC%" goto nodata

echo Copies the schedules in
echo   %SRC%
echo into your online (Turso) database. Everything already online is REPLACED.
echo Accounts and passwords come along; everyone signs in again.
echo.
if "%TURSO_URL%"=="" set /p "TURSO_URL=Turso database URL (starts with libsql://): "
if "%TURSO_TOKEN%"=="" set /p "TURSO_TOKEN=Turso token: "
if "%TURSO_URL%"=="" goto cancelled
set "ANSWER="
set /p "ANSWER=Type YES to replace the online data: "
if /i not "%ANSWER%"=="YES" goto cancelled

set "SOURCE_URL=file:%SRC%"
set "SOURCE_TOKEN="
set "DATABASE_URL=%TURSO_URL%"
set "DATABASE_AUTH_TOKEN=%TURSO_TOKEN%"
echo.
"%BUN%" scripts\import-from-turso.ts || goto fail
echo.
echo Done. Open your online scheduler and sign in.
pause
exit /b 0

:nosetup
echo Run 1-setup.bat first.
pause
exit /b 1

:zipfile
echo That is the backup .zip. Unzip it first, then drop the scheduler.db inside onto this script.
pause
exit /b 1

:nodata
echo No data file found at %SRC%
pause
exit /b 1

:cancelled
echo Cancelled. Nothing was changed.
pause
exit /b 1

:fail
echo The copy did not finish. Check the URL and token, then try again.
pause
exit /b 1
