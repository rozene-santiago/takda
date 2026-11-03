@echo off
setlocal
title TAKDA tunnel - keep this window open
rem Runs YOUR named Cloudflare Tunnel (created once beforehand, see README.txt).
rem The tunnel is chosen in settings.bat: TUNNEL_TOKEN (made in the dashboard)
rem or TUNNEL_NAME (made with "cloudflared tunnel create").
if exist "%~dp0settings.bat" call "%~dp0settings.bat"

rem Already installed as a Windows service by 4-tunnel-autostart.bat? Then it is running.
sc query cloudflared 2>nul | findstr /c:"RUNNING" >nul
if not errorlevel 1 goto serviceRunning

set "CF=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not "%CF%"=="cloudflared" if not exist "%CF%" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not "%CF%"=="cloudflared" if not exist "%CF%" goto noCloudflared

if defined TUNNEL_TOKEN goto haveTunnel
if defined TUNNEL_NAME goto haveTunnel
goto noTunnel

:haveTunnel
rem Reminder only: the tunnel connects even if the scheduler is not running yet.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:4200/api/auth/status | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 echo NOTE: the scheduler is not running. Start 2-start-scheduler.bat as well.
if errorlevel 1 echo.
echo Connecting your Cloudflare Tunnel to http://localhost:4200
if defined PUBLIC_URL echo People open:  %PUBLIC_URL%
echo Ready when you see "Registered tunnel connection" below.
echo Close this window to take the site offline.
echo.
if defined TUNNEL_TOKEN goto runToken

rem Tunnel made on this PC with "cloudflared tunnel create": run it by name.
rem With a config.yml of your own, its ingress rules are used; otherwise everything goes to the scheduler.
set "CFG="
if exist "%USERPROFILE%\.cloudflared\config.yml" set "CFG=1"
if exist "%USERPROFILE%\.cloudflared\config.yaml" set "CFG=1"
if defined CFG goto runNameWithConfig
"%CF%" tunnel run --url http://localhost:4200 "%TUNNEL_NAME%"
goto stopped

:runNameWithConfig
"%CF%" tunnel run "%TUNNEL_NAME%"
goto stopped

:runToken
"%CF%" tunnel run --token "%TUNNEL_TOKEN%"
goto stopped

:stopped
echo.
echo The tunnel has stopped. If it stopped straight away, check TUNNEL_TOKEN or
echo TUNNEL_NAME in settings.bat (see README.txt, "Cloudflare Tunnel").
pause
exit /b 0

:serviceRunning
echo Your tunnel already runs as a Windows service and starts with this PC.
echo There is nothing to start here. To remove the service, run 4-tunnel-autostart.bat.
pause
exit /b 0

:noTunnel
echo No tunnel is set in settings.bat yet.
echo   1. Create your named tunnel once: README.txt, "Cloudflare Tunnel".
echo   2. Copy settings-example.bat to settings.bat and fill in TUNNEL_TOKEN
echo      (dashboard tunnel) or TUNNEL_NAME (command-line tunnel).
echo   3. Run this file again.
pause
exit /b 1

:noCloudflared
echo cloudflared is not installed. Open Command Prompt and run:
echo.
echo     winget install --id Cloudflare.cloudflared
echo.
echo Then run this file again.
pause
exit /b 1
