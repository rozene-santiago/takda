// Copy all scheduler data from one database into another: from a cloud
// (Turso/libSQL) database into a local file, from a local file into a cloud
// database (for example when moving to Runable), or file to file.
// Run from packages/web with the server stopped:
//
//   SOURCE_URL="libsql://....turso.io" SOURCE_TOKEN="..." bun scripts/import-from-turso.ts
//   SOURCE_URL="file:C:/path/to/scheduler.db" DATABASE_URL="libsql://....turso.io" DATABASE_AUTH_TOKEN="..." bun scripts/import-from-turso.ts
//
// DATABASE_URL / DATABASE_AUTH_TOKEN choose the destination (default file:./data/scheduler.db).
// The destination's existing rows are REPLACED. Sign-in sessions are not copied,
// so everyone signs in again; accounts and passwords are copied.
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { INIT_SQL, ADDED_COLUMNS } from "../src/api/database/init-sql";

// Every table, in creation order (parents before the tables that point to them).
const TABLES = [...INIT_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).filter((t) => t !== "sessions");

const srcUrl = process.env.SOURCE_URL;
if (!srcUrl) { console.error("Set SOURCE_URL (and SOURCE_TOKEN for a cloud database) to the database to copy from."); process.exit(1); }
const destUrl = process.env.DATABASE_URL || `file:${resolve(process.cwd(), "data/scheduler.db")}`;
if (srcUrl === destUrl) { console.error("SOURCE_URL and DATABASE_URL are the same database."); process.exit(1); }
if (destUrl.startsWith("file:")) mkdirSync(dirname(destUrl.slice(5)), { recursive: true });

const src = createClient({ url: srcUrl, authToken: process.env.SOURCE_TOKEN || undefined });
const dest = createClient({ url: destUrl, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

// Bring the destination up to the current layout.
await dest.executeMultiple(INIT_SQL);
for (const c of ADDED_COLUMNS) {
  const info = await dest.execute(`PRAGMA table_info(${c.table})`);
  if (!info.rows.some((r) => r.name === c.column)) await dest.execute(`ALTER TABLE ${c.table} ADD COLUMN ${c.ddl}`);
}

await dest.execute("DELETE FROM sessions");
for (const t of [...TABLES].reverse()) await dest.execute(`DELETE FROM ${t}`);

for (const t of TABLES) {
  let rows;
  try { rows = (await src.execute(`SELECT * FROM ${t}`)).rows; }
  catch { console.log(`- ${t}: not in source, skipped`); continue; }
  const destCols = new Set((await dest.execute(`PRAGMA table_info(${t})`)).rows.map((r) => String(r.name)));
  const stmts = rows.map((row) => {
    const cols = Object.keys(row).filter((c) => destCols.has(c));
    return { sql: `INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args: cols.map((c) => row[c] as any) };
  });
  for (let i = 0; i < stmts.length; i += 100) await dest.batch(stmts.slice(i, i + 100), "write");
  console.log(`- ${t}: ${rows.length} rows`);
}
console.log(`Done. Data copied into ${destUrl.replace(/\?.*$/, "")}`);
