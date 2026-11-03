# Putting the scheduler on GitHub Pages

GitHub Pages can only host plain web files, so it runs the **browser-only
version** of the scheduler:

- Schedules are saved **in each browser**, on that computer. They are not shared
  between people or computers, and clearing the browser's site data erases them.
  To move them or keep a copy, use **Backup & restore** → **Download backup** / **Restore from backup**.
- There is no sign-in. Anyone with the link gets their own empty copy and
  can't see yours.
- Teacher share links and emailing schedules need the server version.

For one shared schedule with logins, use the server version: Render + Turso
(free, see RENDER.md), a Windows PC with Cloudflare Tunnel (SELF-HOSTING.md),
or Runable (RUNABLE.md).

## One-time setup (no command line)

1. Create a free account at https://github.com and install **GitHub Desktop**
   (https://desktop.github.com). Sign in to it.
2. Unzip the source zip somewhere, for example `C:\ZENE_CODING\TAKDA\github\class-scheduler`.
3. In GitHub Desktop: **File → Add local repository…** and choose that
   `class-scheduler` folder. When it says the folder isn't a Git repository,
   click **create a repository**, name it `takda`, then **Create repository**.
4. Click **Publish repository**. Untick **Keep this code private** (free
   accounts need a public repository for Pages), then **Publish repository**.
5. On github.com, open the repository → **Settings** → **Pages**. Under
   **Build and deployment → Source**, choose **GitHub Actions**.
6. Open the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow**.
   After 2–3 minutes it turns green.
7. Your site is at `https://<your-username>.github.io/takda/`
   (also shown under Settings → Pages).

## Updating

Unzip the new source over the same folder (replace the files). In GitHub
Desktop, type a short summary, click **Commit to main**, then **Push origin**.
The site rebuilds by itself in a few minutes. The workflow is in
`.github/workflows/deploy-pages.yml`.
