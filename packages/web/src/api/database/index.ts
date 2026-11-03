import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";
import { INIT_SQL, ADDED_COLUMNS } from "./init-sql";
import { REFERENCE_CLEANUP } from "./references";

// Self-hosted default: a local SQLite file at ./data/scheduler.db (relative to
// the directory the server is started from, normally packages/web).
// Set DATABASE_URL to override (e.g. "file:/var/lib/scheduler/db.sqlite", or a
// libsql:// / Turso URL together with DATABASE_AUTH_TOKEN).
const defaultFile = resolve(process.cwd(), "data/scheduler.db");
const url = process.env.DATABASE_URL || `file:${defaultFile}`;

if (url.startsWith("file:")) {
  mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
}

const client = createClient({
  url,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

// Create any missing tables on startup so a fresh install works with no setup.
export const ready: Promise<void> = (async () => {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.executeMultiple(INIT_SQL);
  // Bring older database files up to date.
  for (const c of ADDED_COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${c.table})`);
    if (!info.rows.some((r: any) => r.name === c.column)) {
      await client.execute(`ALTER TABLE ${c.table} ADD COLUMN ${c.ddl}`);
    }
  }
})();

export const db = drizzle(client, { schema });

/** After a change: remove or clear rows that point at deleted rows. Only needed
 *  for a remote database, where foreign keys aren't enforced (see references.ts). */
const remote = !url.startsWith("file:") && url !== ":memory:";
export async function enforceReferences() {
  if (remote) await client.batch(REFERENCE_CLEANUP, "write");
}
