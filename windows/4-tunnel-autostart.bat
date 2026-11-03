@echo off
setlocal
title TAKDA tunnel - start with Windows
rem Installs your dashboard-made tunnel (TUNNEL_TOKEN in settings.bat) as a Windows
rem service, so it starts with the PC even when nobody is signed in.
rem Run it again to remove the service, for example before switching to a new token.

net session >nul 2>&1
if not errorlevel 1 goto isAdmin
echo Asking Windows for administrator rights...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 0

:isAdmin
if exist "%~dp0settings.bat" call "%~dp0settings.bat"

set "CF=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not "%CF%"=="cloudflared" if not exist "%CF%" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not "%CF%"=="cloudflared" if not exist "%CF%" goto noCloudflared

sc query cloudflared >nul 2>&1
if not errorlevel 1 goto installed
if not defined TUNNEL_TOKEN goto needToken

echo Installing the tunnel as a Windows service...
"%CF%" service install "%TUNNEL_TOKEN%"
if errorlevel 1 goto failed
echo.
echo Done. The tunnel now starts by itself with this PC.
echo You don't need to open 3-start-tunnel.bat any more.
echo Make sure the scheduler starts with Windows too (README.txt, "Keep it running").
pause
exit /b 0

:installed
echo The tunnel is already installed as a Windows service.
choice /c RK /m "Press R to remove it, or K to keep it"
if errorlevel 2 exit /b 0
"%CF%" service uninstall
if errorlevel 1 goto failed
echo Removed. Run this file again to install it with the token now in settings.bat.
pause
exit /b 0

:needToken
echo This needs a tunnel made in the Cloudflare dashboard, with its token in
echo settings.bat (TUNNEL_TOKEN). See README.txt, "Cloudflare Tunnel".
echo.
echo For a tunnel made with "cloudflared tunnel create", start 3-start-tunnel.bat
echo with Windows using Task Scheduler instead (README.txt, "Keep it running").
pause
exit /b 1

:failed
echo.
echo That didn't work: see the message above.
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
