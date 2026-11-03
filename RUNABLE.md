# DLSU-D TAKDÁ Class Scheduler: notes for Runable

This project began as a Runable app (Bun + Vite + Hono + Drizzle/libSQL template)
and was extended outside Runable. Read this before running or changing it.

## Run it

```sh
bun install                 # at the project root
bun run dev                 # preview: Vite dev server for packages/web
```

In dev, `packages/web/vite/plugins/hono-dev-plugin.ts` sends `/api/*` and `/s/*`
to `packages/web/src/handler.ts`, the same code the production server uses, so
sign-in, roles and teacher share links behave the same in the preview.

Production:

```sh
cd packages/web
bunx vite build
PORT=4200 bun src/server.ts   # or `bun run start` at the root (pm2, port 4200) after building
```

Type checks (both must pass):

```sh
cd packages/web
bunx tsc --noEmit -p tsconfig.app.json
bunx tsc --noEmit -p tsconfig.node.json
```

## Database

- Set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` (Turso/libSQL) in the root `.env`.
  Without them, the app uses a local file, `packages/web/data/scheduler.db`.
- In production, Bun reads `.env` from the folder it starts in (`packages/web`),
  so put the variables in the environment or in `packages/web/.env`.
- Tables are created and updated automatically at startup
  (`src/api/database/init-sql.ts`: `INIT_SQL` plus `ADDED_COLUMNS`). No Drizzle
  migrations are needed. To add a column, add it to `schema.ts`, `INIT_SQL` and
  `ADDED_COLUMNS`.

## First sign-in on a public address

Accounts have three roles: admin, editor and viewer. For safety, the first admin
account can only be created from the local network, so on a public Runable URL
it is refused. To create it:

1. Add `ALLOW_REMOTE_SETUP=1` to `.env` and restart.
2. Open the app and create the admin account straight away.
3. Remove the line and restart.

## Bringing in existing schedules

1. Get the data file:
   - **Windows / self-hosted version:** `packages\web\data\scheduler.db`
   - **claude.ai version:** open **Backup & restore** in the menu → **Download backup (.zip)**, then unzip it to get the `.db` file
2. Copy it into the Runable database. This replaces what is there.

   ```sh
   cd packages/web
   SOURCE_URL="file:/path/to/scheduler.db" DATABASE_URL="libsql://…" DATABASE_AUTH_TOKEN="…" bun scripts/import-from-turso.ts
   ```

Accounts and passwords are copied, and everyone signs in again. The claude.ai
version has no accounts, so after importing from it, create the admin as shown above.

## Optional settings

| Variable | Use |
|---|---|
| `PUBLIC_URL` | Address used in teacher schedule links and emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Emailing teachers their schedules |
| `PORT` | Server port |

## Where things are (packages/web)

| Path | What |
|---|---|
| `src/handler.ts` | Sign-in, roles, accounts, teacher share links (`/s/<token>`), email |
| `src/server.ts` | Production web server (Bun): handler plus the built app in `dist/` |
| `src/api/index.ts` | Hono API (`basePath("api")`): data, undo/redo, school years, imports |
| `src/api/lib/scheduler.ts` | Auto-fill and conflict checks |
| `src/web/` | React app: `pages/`, `components/`, `lib/print.ts` (printing), `lib/print-pdf.ts` (PDF) |
| `vite.hosted.config.ts`, `bun run build:artifact` | Browser-only build used on claude.ai (database in the browser via sql.js) |
| `../../windows/`, `../../SELF-HOSTING.md` | Windows start scripts and other hosting options |

## Please keep

- Sign-in in `src/handler.ts`, and the dev plugin's routing to it. Without them,
  anyone with the link can read and change the schedules.
- `src/api/database/index.ts`. Don't replace it with the template's version,
  because this one creates the tables at startup.
- The "Made with Runable" badge and analytics script were removed. Adding them back is fine.
