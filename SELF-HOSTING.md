# Self-hosting the Class Scheduler

This copy runs entirely on your own machine or server. No Runable account,
cloud database or API keys are needed. All data is kept in one file:
`packages/web/data/scheduler.db`. **Back that file up.**

## Windows PC (no Docker)

Open the `windows` folder and follow `windows\README.txt`: run `1-setup.bat` once,
then `2-start-scheduler.bat`. `backup-now.bat` copies the data file into `C:\ZENE_CODING\TAKDA\backups`.

## Option A: Docker (easiest for a server)

1. Install Docker Desktop (Windows/Mac) or Docker Engine (Linux).
2. In this folder, run:
   ```
   docker compose up -d --build
   ```
3. Open http://localhost:4200 (or http://SERVER-IP:4200 from other computers on the network).

Your data is saved in `./data/scheduler.db` next to this file.

## Option B: Bun (no Docker)

1. Install Bun: https://bun.sh (Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`).
2. Then:
   ```
   bun install --filter @template/web   # from the project folder; installs only the web app
   cd packages/web
   bunx vite build
   PORT=4200 bun src/server.ts
   ```
   (Windows PowerShell: `$env:PORT=4200; bun src/server.ts`)
3. Open http://localhost:4200.

To keep it running after reboots on Linux, use pm2 (`bunx pm2 start "bun src/server.ts" --name scheduler`) or a systemd service.

## Bringing over your existing data

Your current schedules are stored in the old Runable/Turso cloud database. Copy them over once, with the server stopped:

```
cd packages/web
SOURCE_URL="libsql://<your-db>.turso.io" SOURCE_TOKEN="<token>" bun scripts/import-from-turso.ts
```

`SOURCE_URL` and `SOURCE_TOKEN` are the `DATABASE_URL` and `DATABASE_AUTH_TOKEN` values from the
`.env` file in your original zip. This replaces anything already in the local database.

The same script copies the other way, or file to file: set `SOURCE_URL="file:/path/to/scheduler.db"`
and point `DATABASE_URL` / `DATABASE_AUTH_TOKEN` at the destination (see RUNABLE.md).

## Static / server-less version (optional)

`bun run build:hosted` (in `packages/web`) builds a version where the whole app,
database included, runs in the browser. It outputs plain files in `dist-hosted/`
that can go on any static web host. In that version data is saved in each
browser, and the corner badge offers **Download backup / Restore from backup**.

## Hosting as a claude.ai artifact

`bun run build:artifact` (in `packages/web`) makes the static version and then
runs `scripts/prepare-artifact.mjs`, which adjusts `dist-hosted/` for the
artifact host (pdf.js support files packed into JSON, page entry rewritten).
Publish `dist-hosted/index.html` with the other files beside it, declaring the
`db`, `downloads` and `user` (scope `profile`) capabilities. The artifact has no
accounts of its own: people the artifact is shared with for viewing get a read-only
app, and the activity log shows names from claude.ai. Inside the artifact, Print produces a PDF
and Export / Download backup go through the download prompt; backups are a
`.zip` holding the same `scheduler.db` the server version uses.

## Settings

See `.env.example`. You can change the port with `PORT`, and the database location
with `DATABASE_URL` (e.g. `file:/srv/scheduler/scheduler.db`). `PUBLIC_URL` is the
address used in teacher schedule links and emails; `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` turn on emailing schedules.

## Accounts and sign-in (server version)

On a new install, open the app from the server itself or the local network and
create the admin account (this is refused through a tunnel or proxy so nobody else
can claim the install; `ALLOW_REMOTE_SETUP=1` lifts that). Admins add people in
**Setup > Accounts** as admin, editor or viewer. Sessions last 30 days; five wrong
passwords in ten minutes pause sign-in for that name for five minutes. Every change
is recorded in **Setup > Activity Log** with the person's name.

Teacher schedule links (`/s/<token>`) and their calendar files need no sign-in; anyone
with a link can see that one teacher's week, and **Share > Copy schedule link > New link**
replaces it. If Cloudflare Access protects the site, add a Bypass policy for `/s/*`.

## What's in the app

- **Setup**: grade levels, sections (homeroom, number of students, adviser), subjects
  (special rooms such as labs or the gym, morning/afternoon preference), rooms (seats),
  periods (bell schedules per grade and per day), blocked times, school years/terms,
  print template, save points, accounts, activity log. Lists import from CSV or Excel
  and **Export setup** writes them all to one workbook in the same column order.
- **Allocations**: periods per week per grade and subject, double periods (blocks of
  2–4) and a maximum per day.
- **Teaching Loads**: who teaches each subject in each section; auto-assign within
  teachers' limits; import; push the choices onto the timetable.
- **Teachers**: subjects, grades, max periods per week and per day, times they are not
  available.
- **Class Schedule**: drag and drop or tap to edit; new classes get the teacher from the
  teaching load and the subject's room or the section's homeroom. Auto-fill fills empty
  periods or rebuilds a section or the whole school, and lists anything it could not place
  and why. Tools copy a schedule to other sections, copy one day to another, or move all
  of one teacher's classes to someone else.
- **Teacher / Room Schedule**: each timetable, the all-teachers matrix (Excel export),
  free rooms per day, printing, PDFs for everyone in one .zip, calendar (.ics) files,
  private links and email.
- **Substitutions**: pick the date and the absent teacher; free teachers are ranked
  (free, teaches the subject, fewest recent covers); print a day sheet and slips.
- **Reports**: teacher loads per day, missing or extra periods per section, room use,
  conflicts; one-click Excel export.
- **Undo/redo** for every change, kept in the database (survives refresh and works across
  pages, up to 40 steps). Switching school year clears it.
- Checks: overlapping periods, end before start, duplicate names, out-of-range numbers,
  plus conflict warnings for teacher availability, daily limits, room seats and room type.

## What changed from the Runable version

- Removed the "Made with Runable" badge, the Runable analytics script and the platform dependency.
- The database now defaults to a local SQLite file and creates its tables automatically.
- Removed the `.env` file that held cloud credentials.
- Added the Docker files, the data import script and the static build.
- The mobile (Expo) and desktop (Electron) folders are unchanged. The mobile app's `app.json` still points at the old Runable URL, and the mobile app has no sign-in screen yet, so it cannot talk to a server that requires sign-in. Use the web app in the phone's browser instead (it is built for small screens).
