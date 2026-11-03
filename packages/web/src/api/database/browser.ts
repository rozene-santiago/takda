// Browser-only database for the hosted build (vite.hosted.config.ts swaps this
// in for ./index.ts). The real API (src/api/index.ts) runs inside the page on
// top of an in-memory SQLite engine (sql.js). The whole database file is saved
// after every change:
//   1. to the hosted page's shared storage (claude "db" capability), so the
//      data persists and syncs across devices / people the page is shared with;
//   2. to this browser's IndexedDB as an offline fallback.
import initSqlJs, { type Database } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "./schema";
import { INIT_SQL, ADDED_COLUMNS } from "./init-sql";

let sqlite: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let currentGen = "";
let dirty = false;
let saving: Promise<void> | null = null;

// --- status reporting (rendered by <SaveStatus/>) ---
export type SaveState = "loading" | "saved" | "saving" | "local-only" | "error";
let state: SaveState = "loading";
let stateDetail = "";
const listeners = new Set<() => void>();
// useSyncExternalStore needs the same object back until something changes,
// otherwise React re-renders forever (error #185).
let snapshot: { state: SaveState; detail: string } = { state, detail: stateDetail };
function setState(s: SaveState, detail = "") {
  if (s === state && detail === stateDetail) return;
  state = s; stateDetail = detail; snapshot = { state, detail };
  listeners.forEach((l) => l());
}
export function getSaveState() { return snapshot; }
export function onSaveState(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

// --- remote change notifications (another device saved) ---
const remoteListeners = new Set<() => void>();
export function onRemoteChange(fn: () => void) { remoteListeners.add(fn); return () => { remoteListeners.delete(fn); }; }

// ---------- base64 helpers ----------
function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- IndexedDB fallback ----------
const IDB_NAME = "class-scheduler", IDB_STORE = "kv";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key: string): Promise<any> {
  try {
    const d = await idb();
    return await new Promise((res) => {
      const q = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      q.onsuccess = () => res(q.result); q.onerror = () => res(undefined);
    });
  } catch { return undefined; }
}
async function idbSet(key: string, val: any): Promise<void> {
  try {
    const d = await idb();
    await new Promise<void>((res) => {
      const t = d.transaction(IDB_STORE, "readwrite");
      t.objectStore(IDB_STORE).put(val, key);
      t.oncomplete = () => res(); t.onerror = () => res();
    });
  } catch { /* storage unavailable: ignore */ }
}

// ---------- shared storage (claude db capability) ----------
// The SQLite file is cut into fixed-size parts, each stored under the hash
// of its contents. SQLite changes only the pages it touches, so a typical
// edit re-uploads one or two parts instead of the whole file (which can be
// several MB once a print template is stored).
// Layout: store/manifest = { v: 2, gen, parts: [hash...], bytes, savedAt }
//         part/<hash>    = { d: base64 }          (each < 256 KiB)
// Older layout still readable: manifest { gen, chunks } + snap/<gen>-<i>.
const PART_BYTES = 140_000; // -> ~187k base64 chars per document
let remote: any = null;

async function getRemote() {
  const c = (window as any).claude;
  if (!c?.use) return null;
  try { return await c.use("db"); } catch { return null; }
}

async function partId(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  let s = "";
  for (let i = 0; i < 12; i++) s += d[i].toString(16).padStart(2, "0");
  return s;
}

/** Run async jobs with limited concurrency, preserving result order. */
async function pool<T>(n: number, jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

async function readRemote(): Promise<{ gen: string; bytes: Uint8Array } | null> {
  const m = await remote.doc("store/manifest").get();
  if (!m.exists) return null;
  const man = m.data() as any;
  if (Array.isArray(man.parts)) {
    const chunks = await pool(4, (man.parts as string[]).map((id) => async () => {
      const s = await remote.doc(`part/${id}`).get();
      if (!s.exists) throw new Error("snapshot incomplete");
      return fromB64((s.data() as any).d);
    }));
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return { gen: man.gen, bytes };
  }
  // Older single-snapshot layout.
  const { gen, chunks } = man as { gen: string; chunks: number };
  const parts: string[] = [];
  for (let i = 0; i < chunks; i++) {
    const s = await remote.doc(`snap/${gen}-${i}`).get();
    if (!s.exists) throw new Error("snapshot incomplete");
    parts.push((s.data() as any).d);
  }
  return { gen, bytes: fromB64(parts.join("")) };
}

async function writeRemote(bytes: Uint8Array) {
  const slices: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += PART_BYTES) slices.push(bytes.subarray(i, i + PART_BYTES));
  const ids = await Promise.all(slices.map(partId));

  // Parts the current manifest points at are known to exist; reuse them.
  const prev = await remote.doc("store/manifest").get();
  const prevMan = prev.exists ? (prev.data() as any) : null;
  const existing = new Set<string>(Array.isArray(prevMan?.parts) ? prevMan.parts : []);

  const uploaded = new Set<string>();
  for (let i = 0; i < slices.length; i++) {
    const id = ids[i];
    if (existing.has(id) || uploaded.has(id)) continue;
    await remote.doc(`part/${id}`).set({ d: toB64(slices[i]) });
    uploaded.add(id);
  }

  const gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  currentGen = gen;
  await remote.doc("store/manifest").set({ v: 2, gen, parts: ids, bytes: bytes.length, savedAt: new Date().toISOString() });

  // Remove parts the replaced manifest used that this one no longer needs.
  const keep = new Set(ids);
  if (prevMan) {
    if (Array.isArray(prevMan.parts)) {
      for (const id of new Set<string>(prevMan.parts)) {
        if (!keep.has(id)) { try { await remote.doc(`part/${id}`).delete(); } catch { /* ignore */ } }
      }
    } else if (prevMan.gen && prevMan.chunks) {
      for (let i = 0; i < prevMan.chunks; i++) { try { await remote.doc(`snap/${prevMan.gen}-${i}`).delete(); } catch { /* ignore */ } }
    }
  }
}

function openDb(bytes?: Uint8Array) {
  const next = bytes ? new SQL.Database(bytes) : new SQL.Database();
  next.run("PRAGMA foreign_keys = ON");
  next.exec(INIT_SQL);
  // Bring older database files (and backups) up to date.
  for (const c of ADDED_COLUMNS) {
    const info = next.exec(`PRAGMA table_info(${c.table})`)[0];
    const nameIdx = info?.columns.indexOf("name") ?? -1;
    const has = !!info && info.values.some((row) => row[nameIdx] === c.column);
    if (!has) next.run(`ALTER TABLE ${c.table} ADD COLUMN ${c.ddl}`);
  }
  if (sqlite) sqlite.close();
  sqlite = next;
  db = drizzle(sqlite, { schema });
}

// eslint-disable-next-line import/no-mutable-exports
export let db: ReturnType<typeof drizzle<typeof schema>>;

export const ready: Promise<void> = (async () => {
  SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  remote = await getRemote();
  const localRaw = await idbGet("db");
  const local = localRaw instanceof Uint8Array ? localRaw : undefined;
  const meta = (await idbGet("meta")) as { baseGen?: string; pending?: boolean } | undefined;
  let loaded: Uint8Array | undefined;
  let pushLocal = false;
  if (remote) {
    try {
      const r = await readRemote();
      if (r) {
        currentGen = r.gen;
        // Edits made here that never reached shared storage win, as long as
        // nobody else has saved since they were made.
        if (local && meta?.pending && meta.baseGen === r.gen) { loaded = local; pushLocal = true; }
        else loaded = r.bytes;
      } else if (local) {
        pushLocal = true; // shared storage is empty: seed it from this browser
      }
    } catch (e) {
      console.warn("[scheduler] could not read shared storage", e);
    }
  }
  if (!loaded && local) loaded = local;
  openDb(loaded);
  setState(remote ? "saved" : "local-only");
  if (remote && pushLocal) markDirty();

  // Follow saves made from another device / viewer.
  if (remote) {
    remote.doc("store/manifest").onSnapshot(async (snap: any) => {
      if (!snap.exists || snap.metadata?.hasPendingWrites) return;
      const { gen } = snap.data();
      if (gen === currentGen || dirty || saving) return;
      try {
        const r = await readRemote();
        if (r && r.gen !== currentGen && !dirty && !saving) {
          currentGen = r.gen;
          openDb(r.bytes);
          await idbSet("db", r.bytes);
          await idbSet("meta", { baseGen: r.gen, pending: false });
          remoteListeners.forEach((l) => l());
        }
      } catch { /* try again on next change */ }
    }, () => { /* subscription ended; saves still work */ });
  }
})();

// Called after every successful mutating API request.
let timer: ReturnType<typeof setTimeout> | undefined;
export function markDirty() {
  dirty = true;
  setState(remote ? "saving" : "local-only");
  clearTimeout(timer);
  timer = setTimeout(flush, 600);
}

async function flush() {
  if (saving) { await saving; if (!dirty) return; }
  dirty = false;
  const bytes = sqlite.export();
  // sql.js export() resets pragmas on the live handle; re-enable FKs.
  sqlite.run("PRAGMA foreign_keys = ON");
  saving = (async () => {
    await idbSet("db", bytes);
    if (!remote) { setState("local-only"); return; }
    await idbSet("meta", { baseGen: currentGen, pending: true });
    try {
      await writeRemote(bytes);
      if (!dirty) await idbSet("meta", { baseGen: currentGen, pending: false });
      setState(dirty ? "saving" : "saved");
    } catch (e: any) {
      console.error("[scheduler] save failed", e);
      const msg =
        e?.code === "invalid_argument" ? "You have view-only access; changes are not saved." :
        e?.code === "resource_exhausted" ? "Saving too fast. Your next change will save again." :
        e?.code === "quota_exceeded" ? "Shared storage is full. Download a backup, then delete old save points." :
        e?.message ?? String(e);
      setState("error", msg + " A copy is kept in this browser.");
      // A later change retries the shared save; nothing is lost locally.
    }
  })();
  await saving;
  saving = null;
  if (dirty) flush();
}

// Raw database file, for "Download backup".
/** Foreign keys are enforced in the browser database, so nothing to tidy (see index.ts). */
export async function enforceReferences() {}

export function exportBytes(): Uint8Array { const b = sqlite.export(); sqlite.run("PRAGMA foreign_keys = ON"); return b; }
export function importBytes(bytes: Uint8Array) { openDb(bytes); markDirty(); }

window.addEventListener("beforeunload", (e) => { if (dirty || saving) { e.preventDefault(); } });
