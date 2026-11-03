@echo off
setlocal
cd /d "%~dp0.."
set "BACKUP_DIR=C:\ZENE_CODING\TAKDA\backups"
if not exist "packages\web\data\scheduler.db" goto nodata
if not exist "%BACKUP_DIR%\" mkdir "%BACKUP_DIR%" || goto mkfail
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "STAMP=%%i"
copy /y "packages\web\data\scheduler.db" "%BACKUP_DIR%\scheduler-%STAMP%.db" >nul || goto copyfail
echo Saved  %BACKUP_DIR%\scheduler-%STAMP%.db
echo Tip: copy the %BACKUP_DIR% folder to a USB drive or Google Drive now and then.
pause
exit /b 0

:nodata
echo There is no data yet: packages\web\data\scheduler.db was not found.
pause
exit /b 1

:mkfail
echo The folder %BACKUP_DIR% could not be created.
pause
exit /b 1

:copyfail
echo The backup could not be copied to %BACKUP_DIR%.
pause
exit /b 1
