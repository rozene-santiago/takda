@echo off
rem ------------------------------------------------------------------
rem  Settings for the TAKDA scheduler and its Cloudflare Tunnel.
rem  To use them: copy this file to "settings.bat" (same folder),
rem  remove "rem " in front of the lines you need and fill in your values.
rem  Then restart 2-start-scheduler.bat and 3-start-tunnel.bat.
rem  Keep settings.bat private: the tunnel token works like a password.
rem ------------------------------------------------------------------

rem The web address people use: your tunnel's public hostname.
rem Used in teacher schedule links and emails.
rem set PUBLIC_URL=https://scheduler.yourdomain.com

rem Your named Cloudflare Tunnel, created once beforehand (README.txt). Fill in ONE:
rem  A) Tunnel made in the Cloudflare dashboard: its token, the long code starting
rem     with eyJ at the end of the install command the dashboard shows.
rem set TUNNEL_TOKEN=eyJhIjoi...
rem  B) Tunnel made on this PC with "cloudflared tunnel create takda": its name.
rem set TUNNEL_NAME=takda

rem Email, for "Share > Email each teacher their schedule".
rem Example for Gmail / Google Workspace: create an App Password for the account
rem (Google Account > Security > App passwords) and use it as SMTP_PASS.
rem set SMTP_HOST=smtp.gmail.com
rem set SMTP_PORT=587
rem set SMTP_USER=scheduler@yourschool.edu.ph
rem set SMTP_PASS=your-app-password
rem set SMTP_FROM=TAKDA Scheduler ^<scheduler@yourschool.edu.ph^>

rem Your online (Turso) database, used by copy-to-online-database.bat and
rem backup-online-database.bat (Render + Turso, see RENDER.md). Keep it private:
rem the token works like a password.
rem set TURSO_URL=libsql://takda-yourname.turso.io
rem set TURSO_TOKEN=eyJ...
