TAKDA on a Windows PC
=====================

Put this whole folder somewhere simple, for example C:\ZENE_CODING\TAKDA\class-scheduler
(avoid Desktop/Documents if they sync to OneDrive: syncing can damage the data file).

1-setup.bat             Run once (and again after every update). Installs Bun and builds the app.
2-start-scheduler.bat   Starts the scheduler at http://localhost:4200. Keep its window open.
3-start-tunnel.bat      Runs your named Cloudflare Tunnel (your permanent web address).
4-tunnel-autostart.bat  Optional: makes the tunnel start with Windows (run again to remove).
backup-now.bat          Copies the data file into C:\ZENE_CODING\TAKDA\backups.
copy-to-online-database.bat  Copies your schedules into an online Turso database (Render, see RENDER.md).
backup-online-database.bat   Saves a copy of the online database into C:\ZENE_CODING\TAKDA\backups.
settings-example.bat    Your tunnel, web address and email settings (see inside).

Your data:  packages\web\data\scheduler.db   (back this file up)


First start: create the admin account
-------------------------------------
The first time, open http://localhost:4200 ON THIS PC and create the admin account
(your name, a username and a password of 8+ characters). For safety this only
works from this PC or your school network, not through the tunnel.

Then add everyone else in Setup > Accounts:
  Admin   everything, including accounts
  Editor  can change schedules and setup
  Viewer  can only look, print and download
Everyone signs in with their own account, so Setup > Activity Log shows who
changed what. Forgotten password: an admin sets a new one in Setup > Accounts.


Updating from the previous version (keeps your data)
----------------------------------------------------
  1. Close the 2-start-scheduler window.
  2. Run backup-now.bat.
  3. Copy your old  packages\web\data  folder and  windows\settings.bat  somewhere safe.
  4. Replace the class-scheduler folder with this new one.
  5. Put the data folder back into packages\web\  and settings.bat back into windows\
  6. Run 1-setup.bat, then 2-start-scheduler.bat (and 3-start-tunnel.bat if you use it).
The data file is upgraded automatically the first time it opens.


Bring data over from the claude.ai version
------------------------------------------
  1. In the claude.ai version, open "Backup & restore" in the menu > Download backup (.zip).
  2. Close the 2-start-scheduler window (this stops the scheduler).
  3. Unzip the backup and copy scheduler.db into packages\web\data\ (replace the old one).
  4. Start 2-start-scheduler.bat again.


Teacher schedule links and email
--------------------------------
On Teacher Schedule > Share you can copy a private link for each teacher (their
week, always up to date, plus a calendar file), download calendar files or PDFs,
and email every teacher. For links and email to use your real web address, and
for email to work at all, copy settings-example.bat to settings.bat and fill it in.


Cloudflare Tunnel (your permanent web address)
----------------------------------------------
The scheduler is reached through a NAMED tunnel that you create once. Its
address never changes, e.g. https://scheduler.yourdomain.com. You need a
domain that uses Cloudflare.

Install cloudflared once: open Command Prompt and run
    winget install --id Cloudflare.cloudflared

Create the tunnel ONE of these two ways:

 A) In the Cloudflare dashboard (recommended)
    1. Networking > Tunnels > Create Tunnel (Cloudflared). Name it, e.g. takda.
       Choose Windows as the environment.
    2. The page shows an install command that ends in a long code starting with
       eyJ. That code is the tunnel token. Copy only the code (you don't need to
       run the command).
    3. Copy settings-example.bat to settings.bat and fill in:
           set TUNNEL_TOKEN=eyJ...the code...
           set PUBLIC_URL=https://scheduler.yourdomain.com
    4. Double-click 3-start-tunnel.bat. Wait until the dashboard shows the
       tunnel as Healthy.
    5. In the tunnel: Routes > Add route > Published application.
       Subdomain: scheduler, Domain: yours, Service URL: http://localhost:4200
    6. Optional: run 4-tunnel-autostart.bat once (it asks for administrator
       rights). The tunnel then starts with Windows as a service, and you can
       close 3-start-tunnel.bat.

 B) With commands on this PC
    1. cloudflared tunnel login          (choose your domain in the browser)
    2. cloudflared tunnel create takda
    3. cloudflared tunnel route dns takda scheduler.yourdomain.com
    4. In settings.bat:   set TUNNEL_NAME=takda
                          set PUBLIC_URL=https://scheduler.yourdomain.com
    5. Double-click 3-start-tunnel.bat. All traffic goes to the scheduler,
       unless you keep your own config.yml in %USERPROFILE%\.cloudflared.

Keep settings.bat private: anyone with the token can run your tunnel.
The first admin account can't be created through the tunnel (see above).

The scheduler has its own sign-in, so Cloudflare Access is optional. If you
do use Access, add a Bypass policy for the path  /s/*  so teachers can open
their schedule links without it.


Keep it running
---------------
- Start the scheduler with Windows: Task Scheduler > Create Task.
    General:    name it, choose "Run whether user is logged on or not".
    Triggers:   New > At startup.
    Actions:    Start a program > this folder's 2-start-scheduler.bat,
                Start in: this "windows" folder.
    Conditions: untick "Start the task only if the computer is on AC power".
    Settings:   untick "Stop the task if it runs longer than".
- Start the tunnel with Windows: way A, run 4-tunnel-autostart.bat once.
  Way B, add 3-start-tunnel.bat to Task Scheduler the same way.
- Settings > System > Power: set sleep to Never when plugged in.
