# Putting the scheduler online with Render + Turso (free)

The full server version, with sign-in, roles, one shared schedule, teacher
share links and email, runs on **Render**. Its data lives in a **Turso**
database. Both have free plans.

Things to know about the free plan:

- The app **sleeps after 15 minutes without visitors**. The next visit waits
  about a minute while it wakes up. Your data is safe, because it lives in
  Turso, not on Render.
- The repository on GitHub can stay **private**.

You need the code on GitHub first. See GITHUB-PAGES.md, steps 1–4. Skip the
Pages part, and you may keep **Keep this code private** ticked. If you don't use
GitHub Pages, turn off its automatic build so it doesn't fail on every update:
on GitHub, open **Actions** → **Deploy to GitHub Pages** → **⋯** → **Disable workflow**.

## 1. Create the database (Turso)

1. Sign up at https://turso.tech (you can sign in with GitHub).
2. Create a database, for example `takda`. When asked for a location, choose
   the one closest to Singapore. The app and database talk a lot, so keeping
   them close makes the app faster.
3. Open the database and copy its **URL**. It starts with `libsql://`.
4. Create a **token** for the database with read and write access, and copy it.
   Keep it secret: anyone with the URL and token can read and change the data.

## 2. Create the app (Render)

1. Sign up at https://render.com with your GitHub account.
2. In the Render dashboard, choose **New → Blueprint** and connect your
   `takda` repository. Render reads `render.yaml` from it
   (free plan, Singapore region, health check, Docker build).
3. When Render asks for the values, paste:
   - `DATABASE_URL`: the Turso URL (`libsql://…`)
   - `DATABASE_AUTH_TOKEN`: the Turso token
4. Click **Apply** or **Deploy**. The first build takes about 5–10 minutes.
   Your address appears at the top of the service page, for example
   `https://takda.onrender.com` (Render adds a few letters if that name is taken).

## 3. Create the admin account

For safety, the first admin account can't be created over the internet until
you allow it once:

1. On the service page → **Environment** → add `ALLOW_REMOTE_SETUP` with value
   `1` → **Save**. Wait for it to redeploy.
2. Open your address and create the admin account.
3. Back in **Environment**, delete `ALLOW_REMOTE_SETUP` → **Save**.

Then add your colleagues under **Setup → Accounts** (admin, editor or viewer).

## 4. Bring your existing schedules (optional)

On the Windows PC that runs the scheduler:

- **Data from this PC:** double-click `windows\copy-to-online-database.bat`.
  Paste the Turso URL and token when asked.
- **Data from the claude.ai version:** open **Backup & restore** →
  **Download backup (.zip)**, unzip it, and drag the `scheduler.db` inside
  onto `copy-to-online-database.bat`.

This replaces what is in the online database. Accounts and passwords come
along, and everyone signs in again. The claude.ai version has no accounts, so
after copying from it, create the admin as in step 3.

## Optional settings (Render → Environment)

| Name | Use |
|---|---|
| `PUBLIC_URL` | Your Render address, for teacher schedule links and emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Emailing teachers their schedules |

## Updating

Push the new code to GitHub (GitHub Desktop: **Commit to main**, then
**Push origin**). Render rebuilds and redeploys by itself. Your data stays
in Turso.

## Backups

Keep your own copies of the online data. On the Windows PC, double-click
`windows\backup-online-database.bat`. It saves the whole online database as a
file in `C:\ZENE_CODING\TAKDA\backups`, and nothing online changes. To skip pasting the
URL and token each time, put them in `windows\settings.bat` (see
`settings-example.bat`). Inside the app, **Setup → Save Points** keeps named
copies you can go back to.
