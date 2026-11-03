// What ON DELETE CASCADE / SET NULL would do, as plain statements.
// SQLite enforces foreign keys only on connections that switch them on. A
// local file keeps one connection (switched on at startup), but a remote
// libSQL/Turso database runs requests on separate connections, so after each
// change the server tidies up rows that point at deleted ones.
import { INIT_SQL } from "./init-sql";

export const REFERENCE_CLEANUP: string[] = (() => {
  const out: string[] = [];
  // Tables are created parents-first, so one pass also covers chains
  // (grade level -> sections -> classes).
  for (const [, table, body] of INIT_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const [, col, parent, pcol, action] of body.matchAll(/^\s*(\w+) [^,\n]*?REFERENCES (\w+)\((\w+)\) ON DELETE (CASCADE|SET NULL)/gm)) {
      const orphan = `${col} IS NOT NULL AND ${col} NOT IN (SELECT ${pcol} FROM ${parent})`;
      out.push(action === "CASCADE" ? `DELETE FROM ${table} WHERE ${orphan}` : `UPDATE ${table} SET ${col} = NULL WHERE ${orphan}`);
    }
  }
  return out;
})();
