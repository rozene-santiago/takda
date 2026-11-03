import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, asc, desc, and, lt, lte } from "drizzle-orm";
import { db, ready, enforceReferences } from "./database";
import * as schema from "./database/schema";
import { detectConflicts, autoFill, autoAssignLoads, rankSubstitutes, slotApplies, toMinutes, type SchedCtx } from "./lib/scheduler";
import { takeSnapshot, restoreSnapshot, setupOnly, pack, unpack, type Snapshot } from "./lib/snapshot";
import { hashPassword, verifyPassword, isHashed, randomToken } from "./lib/crypto";
import { describe } from "./lib/activity";

// Strip non-updatable / server-managed fields (and undefined values) from a
// request body before passing it to drizzle's .set().
function patch<T extends Record<string, any>>(body: T): Partial<T> {
  const { id, createdAt, updatedAt, ...rest } = body as any;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

const bad = (message: string) => ({ error: message });
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

async function loadCtx(): Promise<SchedCtx> {
  const [sections, subjects, teachers, rooms, timeSlots, blockedTimes, allocations, entries, settingsRows, unav, loads] =
    await Promise.all([
      db.select().from(schema.sections),
      db.select().from(schema.subjects),
      db.select().from(schema.teachers),
      db.select().from(schema.rooms),
      db.select().from(schema.timeSlots),
      db.select().from(schema.blockedTimes),
      db.select().from(schema.subjectAllocations),
      db.select().from(schema.scheduleEntries),
      db.select().from(schema.settings),
      db.select().from(schema.teacherUnavailability),
      db.select().from(schema.teachingLoads),
    ]);
  const activeDays = settingsRows[0]?.activeDays ?? [1, 2, 3, 4, 5];
  return {
    sections: sections.map((s) => ({ id: s.id, name: s.name, gradeLevelId: s.gradeLevelId, homeroomId: s.homeroomId, studentCount: s.studentCount })),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name, color: s.color, roomIds: s.roomIds ?? [], timePreference: s.timePreference })),
    teachers: teachers.map((t) => ({ id: t.id, name: t.name, subjectIds: t.subjectIds ?? [], gradeLevelIds: t.gradeLevelIds ?? [], maxLoad: t.maxLoad, maxPerDay: t.maxPerDay })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
    timeSlots: timeSlots.map((t) => ({ id: t.id, label: t.label, sortOrder: t.sortOrder, isBreak: t.isBreak, startTime: t.startTime, endTime: t.endTime, gradeLevelIds: t.gradeLevelIds ?? [], days: t.days ?? [] })),
    blockedTimes: blockedTimes.flatMap((b) => {
      let ids: (number | null)[];
      if (b.sectionIds && b.sectionIds.length) ids = b.sectionIds;
      else if (b.gradeLevelId != null) ids = sections.filter((s) => s.gradeLevelId === b.gradeLevelId).map((s) => s.id);
      else ids = [b.sectionId ?? null];
      return ids.map((sectionId) => ({ dayOfWeek: b.dayOfWeek, timeSlotId: b.timeSlotId, sectionId }));
    }),
    teacherUnavailable: unav.map((u) => ({ teacherId: u.teacherId, dayOfWeek: u.dayOfWeek, timeSlotId: u.timeSlotId })),
    allocations: allocations.map((a) => ({ gradeLevelId: a.gradeLevelId, subjectId: a.subjectId, periodsPerWeek: a.periodsPerWeek, blockSize: a.blockSize, maxPerDay: a.maxPerDay })),
    loads: loads.map((l) => ({ sectionId: l.sectionId, subjectId: l.subjectId, teacherId: l.teacherId })),
    entries: entries.map((e) => ({ id: e.id, sectionId: e.sectionId, dayOfWeek: e.dayOfWeek, timeSlotId: e.timeSlotId, subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId })),
    activeDays,
  };
}

async function getSettingsRow() {
  let rows = await db.select().from(schema.settings);
  if (rows.length === 0) rows = await db.insert(schema.settings).values({ activeDays: [1, 2, 3, 4, 5], schoolName: "My School" }).returning();
  return rows[0];
}
function publicSettings(row: typeof schema.settings.$inferSelect) {
  const { lockPassword, ...rest } = row;
  return { ...rest, hasLockPassword: !!lockPassword };
}

// ---------- time slot checks ----------
function normTime(raw: unknown): string | null {
  const t = String(raw ?? "").trim().replace(/\./g, ":");
  const m = /^(\d{1,2}):?(\d{2})?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]), min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
const intersects = (a?: number[] | null, b?: number[] | null) => !a?.length || !b?.length || a.some((x) => b.includes(x));
async function checkSlot(next: { label?: string; startTime?: string; endTime?: string; gradeLevelIds?: number[] | null; days?: number[] | null }, selfId: number | null): Promise<string | null> {
  if (next.label != null && !String(next.label).trim()) return "Give the period a name.";
  const s = toMinutes(next.startTime), e = toMinutes(next.endTime);
  if (Number.isNaN(s) || Number.isNaN(e)) return "Enter start and end times like 7:30 or 13:00.";
  if (e <= s) return `The period ends (${next.endTime}) before it starts (${next.startTime}).`;
  const others = (await db.select().from(schema.timeSlots)).filter((o) => o.id !== selfId);
  for (const o of others) {
    if (!intersects(o.gradeLevelIds, next.gradeLevelIds) || !intersects(o.days, next.days)) continue;
    const os = toMinutes(o.startTime), oe = toMinutes(o.endTime);
    if (Number.isNaN(os) || Number.isNaN(oe)) continue;
    if (s < oe && os < e) return `This overlaps "${o.label}" (${o.startTime}–${o.endTime}) for the same grades and days. Change the times, or limit one of them to other grades or days.`;
  }
  return null;
}

async function duplicateName(table: any, field: string, name: unknown, selfId: number | null, extra?: (row: any) => boolean): Promise<boolean> {
  const n = norm(name);
  if (!n) return false;
  const rows: any[] = await db.select().from(table);
  return rows.some((r) => r.id !== selfId && norm(r[field]) === n && (!extra || extra(r)));
}

// ---------- undo / activity ----------
const MAX_UNDO = 40;
const MAX_LOG = 3000;
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
async function pushHistory(stack: "undo" | "redo", label: string, snap: Snapshot) {
  await db.insert(schema.undoLog).values({ stack, label, payload: pack(snap), createdAt: Date.now() });
  const rows = await db.select({ id: schema.undoLog.id }).from(schema.undoLog).where(eq(schema.undoLog.stack, stack)).orderBy(desc(schema.undoLog.id));
  if (rows.length > MAX_UNDO) await db.delete(schema.undoLog).where(and(eq(schema.undoLog.stack, stack), lte(schema.undoLog.id, rows[MAX_UNDO].id)));
}
let logCount = 0;
async function writeLog(user: string | null, action: string, details: string) {
  const [row] = await db.insert(schema.auditLog).values({ at: Date.now(), user, action, details }).returning({ id: schema.auditLog.id });
  if (++logCount % 50 === 0 && row) await db.delete(schema.auditLog).where(lte(schema.auditLog.id, row.id - MAX_LOG));
}

const LOCK_EXEMPT = new Set(["/settings/unlock", "/settings/lock", "/settings/lock-password", "/auth"]);

const app = new Hono()
  .basePath("api")
  .use(async (_c, next) => { await ready; await next(); })
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }))
  // Every change: lockdown check, one at a time, snapshot for undo, activity log.
  .use(async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    const path = c.req.path.replace(/^\/api/, "");
    if (path === "/autofill") return next(); // a preview only
    return serial(async () => {
      const settings = await getSettingsRow();
      if (settings.locked && ![...LOCK_EXEMPT].some((p) => path === p || path.startsWith(p + "/"))) {
        return c.json(bad("Changes are locked. Unlock first (menu → Locked)."), 423) as any;
      }
      let body: any = null;
      if ((c.req.header("content-type") ?? "").includes("json")) body = await c.req.json().catch(() => null);
      const info = await describe(method, c.req.path, body);
      const before = info.undoable ? await takeSnapshot() : null;
      await next();
      if (c.res.status >= 200 && c.res.status < 300) {
        await enforceReferences();
        if (before) {
          await pushHistory("undo", info.label, before);
          await db.delete(schema.undoLog).where(eq(schema.undoLog.stack, "redo"));
        }
        if (info.audit) {
          const extra = (c.get as any)("auditDetails") as string | undefined;
          await writeLog(c.req.header("x-takda-user") ?? null, info.label, extra ?? info.details);
        }
      }
    });
  })
  .get("/health", (c) => c.json({ status: "ok" }, 200))
  .get("/auth/status", (c) => c.json({ mode: "local" as const }, 200))

  // ---------- SETTINGS ----------
  .get("/settings", async (c) => c.json(publicSettings(await getSettingsRow()), 200))
  .put("/settings", async (c) => {
    const body = await c.req.json<{ activeDays?: number[]; schoolName?: string; tabConfig?: { key: string; visible: boolean }[]; printTemplate?: string | null; printHeading?: string | null; printOffset?: number | null; printRowHeight?: number | null }>();
    const cur = await getSettingsRow();
    const [updated] = await db.update(schema.settings).set({
      activeDays: body.activeDays ?? cur.activeDays,
      schoolName: body.schoolName ?? cur.schoolName,
      tabConfig: body.tabConfig ?? cur.tabConfig,
      printTemplate: body.printTemplate === undefined ? cur.printTemplate : body.printTemplate,
      printHeading: body.printHeading === undefined ? cur.printHeading : body.printHeading,
      printOffset: body.printOffset === undefined ? cur.printOffset : body.printOffset,
      printRowHeight: body.printRowHeight === undefined ? cur.printRowHeight : body.printRowHeight,
    }).where(eq(schema.settings.id, cur.id)).returning();
    return c.json(publicSettings(updated), 200);
  })
  // ---------- LOCKDOWN (password stored hashed) ----------
  .post("/settings/lock", async (c) => {
    const { password } = await c.req.json<{ password?: string }>();
    const cur = await getSettingsRow();
    if (!password) return c.json(bad("Password required"), 400);
    if (cur.lockPassword && !(await verifyPassword(password, cur.lockPassword))) return c.json(bad("Incorrect password"), 403);
    const lockPassword = cur.lockPassword && isHashed(cur.lockPassword) ? cur.lockPassword : await hashPassword(password);
    const [updated] = await db.update(schema.settings).set({ locked: true, lockPassword }).where(eq(schema.settings.id, cur.id)).returning();
    return c.json(publicSettings(updated), 200);
  })
  .post("/settings/unlock", async (c) => {
    const { password } = await c.req.json<{ password?: string }>();
    const cur = await getSettingsRow();
    if (cur.lockPassword && !(await verifyPassword(password ?? "", cur.lockPassword))) return c.json(bad("Incorrect password"), 403);
    const lockPassword = cur.lockPassword && !isHashed(cur.lockPassword) ? await hashPassword(password ?? "") : cur.lockPassword;
    const [updated] = await db.update(schema.settings).set({ locked: false, lockPassword }).where(eq(schema.settings.id, cur.id)).returning();
    return c.json(publicSettings(updated), 200);
  })
  .post("/settings/lock-password", async (c) => {
    const { current, next } = await c.req.json<{ current?: string; next?: string }>();
    const cur = await getSettingsRow();
    if (!next) return c.json(bad("New password required"), 400);
    if (cur.lockPassword && !(await verifyPassword(current ?? "", cur.lockPassword))) return c.json(bad("Incorrect current password"), 403);
    const [updated] = await db.update(schema.settings).set({ lockPassword: await hashPassword(next) }).where(eq(schema.settings.id, cur.id)).returning();
    return c.json(publicSettings(updated), 200);
  })

  // ---------- GRADE LEVELS ----------
  .get("/grade-levels", async (c) => c.json(await db.select().from(schema.gradeLevels).orderBy(asc(schema.gradeLevels.sortOrder)), 200))
  .post("/grade-levels", async (c) => {
    const b = await c.req.json<{ name: string; sortOrder?: number }>();
    if (!String(b.name ?? "").trim()) return c.json(bad("Enter a name."), 400);
    if (await duplicateName(schema.gradeLevels, "name", b.name, null)) return c.json(bad(`A grade level called "${b.name}" already exists.`), 400);
    const [row] = await db.insert(schema.gradeLevels).values({ name: b.name.trim(), sortOrder: b.sortOrder ?? 0 }).returning();
    return c.json(row, 201);
  })
  .put("/grade-levels/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ name?: string; sortOrder?: number }>();
    if (b.name != null && await duplicateName(schema.gradeLevels, "name", b.name, id)) return c.json(bad(`A grade level called "${b.name}" already exists.`), 400);
    const [row] = await db.update(schema.gradeLevels).set(patch(b)).where(eq(schema.gradeLevels.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/grade-levels/:id", async (c) => {
    await db.delete(schema.gradeLevels).where(eq(schema.gradeLevels.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- SECTIONS ----------
  .get("/sections", async (c) => c.json(await db.select().from(schema.sections).orderBy(asc(schema.sections.sortOrder), asc(schema.sections.id)), 200))
  .post("/sections", async (c) => {
    const b = await c.req.json<{ name: string; gradeLevelId: number; adviser?: string; homeroomId?: number | null; studentCount?: number | null; sortOrder?: number }>();
    if (!String(b.name ?? "").trim()) return c.json(bad("Enter a section name."), 400);
    if (await duplicateName(schema.sections, "name", b.name, null, (r) => r.gradeLevelId === b.gradeLevelId)) return c.json(bad(`Section "${b.name}" already exists in this grade level.`), 400);
    const max = await db.select().from(schema.sections);
    const [row] = await db.insert(schema.sections).values({
      name: b.name.trim(), gradeLevelId: b.gradeLevelId, adviser: b.adviser ?? null, homeroomId: b.homeroomId ?? null, studentCount: b.studentCount ?? null,
      sortOrder: b.sortOrder ?? max.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0) + 1,
    }).returning();
    return c.json(row, 201);
  })
  .post("/sections/reorder", async (c) => {
    const { ids } = await c.req.json<{ ids: number[] }>();
    for (let i = 0; i < ids.length; i++) await db.update(schema.sections).set({ sortOrder: i + 1 }).where(eq(schema.sections.id, ids[i]));
    return c.json({ ok: true }, 200);
  })
  .put("/sections/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ name?: string; gradeLevelId?: number; adviser?: string; homeroomId?: number | null; studentCount?: number | null }>();
    if (b.name != null) {
      const cur = (await db.select().from(schema.sections).where(eq(schema.sections.id, id)))[0];
      const g = b.gradeLevelId ?? cur?.gradeLevelId;
      if (await duplicateName(schema.sections, "name", b.name, id, (r) => r.gradeLevelId === g)) return c.json(bad(`Section "${b.name}" already exists in this grade level.`), 400);
    }
    const [row] = await db.update(schema.sections).set(patch(b)).where(eq(schema.sections.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/sections/:id", async (c) => {
    await db.delete(schema.sections).where(eq(schema.sections.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- SUBJECTS ----------
  .get("/subjects", async (c) => c.json(await db.select().from(schema.subjects).orderBy(asc(schema.subjects.sortOrder), asc(schema.subjects.id)), 200))
  .post("/subjects", async (c) => {
    const b = await c.req.json<{ name: string; code?: string; color?: string | null; sortOrder?: number; roomIds?: number[] | null; timePreference?: string | null }>();
    if (!String(b.name ?? "").trim()) return c.json(bad("Enter a subject name."), 400);
    if (await duplicateName(schema.subjects, "name", b.name, null)) return c.json(bad(`A subject called "${b.name}" already exists.`), 400);
    const max = await db.select().from(schema.subjects);
    const nextOrder = b.sortOrder ?? (max.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0) + 1);
    const [row] = await db.insert(schema.subjects).values({ name: b.name.trim(), code: b.code, color: b.color === undefined ? "#338D67" : b.color, sortOrder: nextOrder, roomIds: b.roomIds ?? [], timePreference: b.timePreference ?? null }).returning();
    return c.json(row, 201);
  })
  .post("/subjects/reorder", async (c) => {
    const { ids } = await c.req.json<{ ids: number[] }>();
    for (let i = 0; i < ids.length; i++) await db.update(schema.subjects).set({ sortOrder: i + 1 }).where(eq(schema.subjects.id, ids[i]));
    return c.json({ ok: true }, 200);
  })
  .put("/subjects/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ name?: string; code?: string; color?: string | null; sortOrder?: number; roomIds?: number[] | null; timePreference?: string | null }>();
    if (b.name != null && await duplicateName(schema.subjects, "name", b.name, id)) return c.json(bad(`A subject called "${b.name}" already exists.`), 400);
    const [row] = await db.update(schema.subjects).set(patch(b)).where(eq(schema.subjects.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/subjects/:id", async (c) => {
    await db.delete(schema.subjects).where(eq(schema.subjects.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- TEACHERS ----------
  .get("/teachers", async (c) => {
    const rows = await db.select().from(schema.teachers);
    return c.json(rows.map(({ shareToken, ...t }) => ({ ...t, hasShareLink: !!shareToken })), 200);
  })
  .post("/teachers", async (c) => {
    const b = await c.req.json<{ name: string; email?: string; subjectIds?: number[]; gradeLevelIds?: number[]; maxLoad?: number | null; maxPerDay?: number | null; color?: string }>();
    if (!String(b.name ?? "").trim()) return c.json(bad("Enter the teacher's name."), 400);
    if (await duplicateName(schema.teachers, "name", b.name, null)) return c.json(bad(`A teacher called "${b.name}" already exists.`), 400);
    const [row] = await db.insert(schema.teachers).values({
      name: b.name.trim(), email: b.email, subjectIds: b.subjectIds ?? [], gradeLevelIds: b.gradeLevelIds ?? [], maxLoad: b.maxLoad ?? null, maxPerDay: b.maxPerDay ?? null, color: b.color ?? "#007041",
    }).returning();
    return c.json(row, 201);
  })
  .put("/teachers/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ name?: string; email?: string; subjectIds?: number[]; gradeLevelIds?: number[]; maxLoad?: number | null; maxPerDay?: number | null; color?: string; hasShareLink?: boolean }>();
    if (b.name != null && await duplicateName(schema.teachers, "name", b.name, id)) return c.json(bad(`A teacher called "${b.name}" already exists.`), 400);
    const { hasShareLink, ...rest } = b;
    const [row] = await db.update(schema.teachers).set(patch(rest)).where(eq(schema.teachers.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/teachers/:id", async (c) => {
    await db.delete(schema.teachers).where(eq(schema.teachers.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })
  .put("/teachers/:id/unavailability", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ slots: { dayOfWeek: number; timeSlotId: number }[]; reason?: string | null }>();
    await db.delete(schema.teacherUnavailability).where(eq(schema.teacherUnavailability.teacherId, id));
    const rows = (b.slots ?? []).map((s) => ({ teacherId: id, dayOfWeek: s.dayOfWeek, timeSlotId: s.timeSlotId, reason: b.reason ?? null }));
    for (let i = 0; i < rows.length; i += 200) await db.insert(schema.teacherUnavailability).values(rows.slice(i, i + 200));
    return c.json({ ok: true, count: rows.length }, 200);
  })
  .post("/teachers/:id/share-link", async (c) => {
    const id = Number(c.req.param("id"));
    const { reset } = await c.req.json<{ reset?: boolean }>().catch(() => ({ reset: false }));
    const cur = (await db.select().from(schema.teachers).where(eq(schema.teachers.id, id)))[0];
    if (!cur) return c.json(bad("Teacher not found"), 404);
    const token = !reset && cur.shareToken ? cur.shareToken : randomToken(18);
    await db.update(schema.teachers).set({ shareToken: token }).where(eq(schema.teachers.id, id));
    return c.json({ token }, 200);
  })
  .get("/teacher-unavailability", async (c) => c.json(await db.select().from(schema.teacherUnavailability), 200))

  // ---------- ROOMS ----------
  .get("/rooms", async (c) => c.json(await db.select().from(schema.rooms), 200))
  .post("/rooms", async (c) => {
    const b = await c.req.json<{ name: string; capacity?: number | null }>();
    if (!String(b.name ?? "").trim()) return c.json(bad("Enter a room name."), 400);
    if (await duplicateName(schema.rooms, "name", b.name, null)) return c.json(bad(`A room called "${b.name}" already exists.`), 400);
    const [row] = await db.insert(schema.rooms).values({ name: b.name.trim(), capacity: b.capacity ?? null }).returning();
    return c.json(row, 201);
  })
  .put("/rooms/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ name?: string; capacity?: number | null }>();
    if (b.name != null && await duplicateName(schema.rooms, "name", b.name, id)) return c.json(bad(`A room called "${b.name}" already exists.`), 400);
    const [row] = await db.update(schema.rooms).set(patch(b)).where(eq(schema.rooms.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/rooms/:id", async (c) => {
    await db.delete(schema.rooms).where(eq(schema.rooms.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- TIME SLOTS (checked for valid times and overlaps) ----------
  .get("/time-slots", async (c) => c.json(await db.select().from(schema.timeSlots).orderBy(asc(schema.timeSlots.sortOrder)), 200))
  .post("/time-slots", async (c) => {
    const b = await c.req.json<{ label: string; startTime: string; endTime: string; sortOrder?: number; isBreak?: boolean; gradeLevelIds?: number[] | null; days?: number[] | null }>();
    const startTime = normTime(b.startTime), endTime = normTime(b.endTime);
    const err = await checkSlot({ label: b.label, startTime: startTime ?? "", endTime: endTime ?? "", gradeLevelIds: b.gradeLevelIds, days: b.days }, null);
    if (err) return c.json(bad(err), 400);
    const [row] = await db.insert(schema.timeSlots).values({
      label: b.label.trim(), startTime: startTime!, endTime: endTime!, sortOrder: b.sortOrder ?? 0, isBreak: b.isBreak ?? false, gradeLevelIds: b.gradeLevelIds ?? [], days: b.days ?? [],
    }).returning();
    return c.json(row, 201);
  })
  .post("/time-slots/reorder", async (c) => {
    const { ids } = await c.req.json<{ ids: number[] }>();
    for (let i = 0; i < ids.length; i++) await db.update(schema.timeSlots).set({ sortOrder: i + 1 }).where(eq(schema.timeSlots.id, ids[i]));
    return c.json({ ok: true }, 200);
  })
  .put("/time-slots/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ label?: string; startTime?: string; endTime?: string; sortOrder?: number; isBreak?: boolean; gradeLevelIds?: number[] | null; days?: number[] | null }>();
    const cur = (await db.select().from(schema.timeSlots).where(eq(schema.timeSlots.id, id)))[0];
    if (!cur) return c.json(bad("Period not found"), 404);
    const next = { ...cur, ...patch(b) };
    if (b.startTime != null) next.startTime = normTime(b.startTime) ?? "";
    if (b.endTime != null) next.endTime = normTime(b.endTime) ?? "";
    if (["label", "startTime", "endTime", "gradeLevelIds", "days"].some((k) => k in b)) {
      const err = await checkSlot(next, id);
      if (err) return c.json(bad(err), 400);
    }
    const { id: _i, createdAt: _c, ...set } = next as any;
    const [row] = await db.update(schema.timeSlots).set(set).where(eq(schema.timeSlots.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/time-slots/:id", async (c) => {
    await db.delete(schema.timeSlots).where(eq(schema.timeSlots.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- BLOCKED TIMES ----------
  .get("/blocked-times", async (c) => c.json(await db.select().from(schema.blockedTimes), 200))
  .post("/blocked-times", async (c) => {
    const b = await c.req.json<{ dayOfWeek: number; timeSlotId: number; sectionId?: number | null; gradeLevelId?: number | null; sectionIds?: number[] | null; reason?: string }>();
    const [row] = await db.insert(schema.blockedTimes).values({
      dayOfWeek: b.dayOfWeek, timeSlotId: b.timeSlotId, sectionId: b.sectionId ?? null, gradeLevelId: b.gradeLevelId ?? null,
      sectionIds: b.sectionIds && b.sectionIds.length ? b.sectionIds : null, reason: b.reason,
    }).returning();
    return c.json(row, 201);
  })
  .put("/blocked-times/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ dayOfWeek?: number; timeSlotId?: number; sectionId?: number | null; gradeLevelId?: number | null; sectionIds?: number[] | null; reason?: string }>();
    const next: any = {};
    if (b.dayOfWeek !== undefined) next.dayOfWeek = b.dayOfWeek;
    if (b.timeSlotId !== undefined) next.timeSlotId = b.timeSlotId;
    if (b.reason !== undefined) next.reason = b.reason;
    if (b.sectionId !== undefined || b.gradeLevelId !== undefined || b.sectionIds !== undefined) {
      next.sectionId = b.sectionId ?? null;
      next.gradeLevelId = b.gradeLevelId ?? null;
      next.sectionIds = b.sectionIds && b.sectionIds.length ? b.sectionIds : null;
    }
    const [row] = await db.update(schema.blockedTimes).set(next).where(eq(schema.blockedTimes.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/blocked-times/:id", async (c) => {
    await db.delete(schema.blockedTimes).where(eq(schema.blockedTimes.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- ALLOCATIONS ----------
  .get("/allocations", async (c) => c.json(await db.select().from(schema.subjectAllocations), 200))
  .post("/allocations", async (c) => {
    // upsert by (gradeLevelId, subjectId)
    const b = await c.req.json<{ gradeLevelId: number; subjectId: number; periodsPerWeek?: number; blockSize?: number; maxPerDay?: number | null }>();
    const existing = await db.select().from(schema.subjectAllocations).where(eq(schema.subjectAllocations.gradeLevelId, b.gradeLevelId));
    const match = existing.find((a) => a.subjectId === b.subjectId);
    const vals: any = {};
    if (b.periodsPerWeek !== undefined) vals.periodsPerWeek = Math.max(0, Math.min(60, Math.round(b.periodsPerWeek)));
    if (b.blockSize !== undefined) vals.blockSize = Math.max(1, Math.min(4, Math.round(b.blockSize || 1)));
    if (b.maxPerDay !== undefined) vals.maxPerDay = b.maxPerDay ? Math.max(1, Math.round(b.maxPerDay)) : null;
    if (match) {
      const [row] = await db.update(schema.subjectAllocations).set(vals).where(eq(schema.subjectAllocations.id, match.id)).returning();
      return c.json(row, 200);
    }
    const [row] = await db.insert(schema.subjectAllocations).values({ gradeLevelId: b.gradeLevelId, subjectId: b.subjectId, periodsPerWeek: 0, ...vals }).returning();
    return c.json(row, 201);
  })
  .post("/allocations/import", async (c) => {
    const { rows } = await c.req.json<{ rows: string[][] }>();
    const grades = await db.select().from(schema.gradeLevels);
    const subjects = await db.select().from(schema.subjects);
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const [gName, sName, per, block, maxDay] = r.map((x) => String(x ?? "").trim());
      if (!gName && !sName) continue;
      const g = grades.find((x) => norm(x.name) === norm(gName));
      const s = subjects.find((x) => norm(x.name) === norm(sName) || (x.code && norm(x.code) === norm(sName)));
      if (!g) { errors.push(`"${gName}": grade level not found`); continue; }
      if (!s) { errors.push(`"${sName}": subject not found`); continue; }
      const p = Number(per);
      if (!Number.isFinite(p) || p < 0) { errors.push(`${gName} / ${sName}: periods must be a number`); continue; }
      const existing = (await db.select().from(schema.subjectAllocations).where(eq(schema.subjectAllocations.gradeLevelId, g.id))).find((a) => a.subjectId === s.id);
      const vals: any = { periodsPerWeek: Math.round(p), blockSize: Math.max(1, Math.min(4, Number(block) || 1)), maxPerDay: Number(maxDay) > 0 ? Math.round(Number(maxDay)) : null };
      if (existing) await db.update(schema.subjectAllocations).set(vals).where(eq(schema.subjectAllocations.id, existing.id));
      else await db.insert(schema.subjectAllocations).values({ gradeLevelId: g.id, subjectId: s.id, ...vals });
      added++;
    }
    return c.json({ added, errors }, 200);
  })
  .delete("/allocations/:id", async (c) => {
    await db.delete(schema.subjectAllocations).where(eq(schema.subjectAllocations.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- IMPORTS (one undo step per file) ----------
  .post("/sections/import", async (c) => {
    const { rows } = await c.req.json<{ rows: string[][] }>();
    const grades = await db.select().from(schema.gradeLevels);
    const rooms = await db.select().from(schema.rooms);
    const teachers = await db.select().from(schema.teachers);
    const existing = await db.select().from(schema.sections);
    let order = existing.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0);
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const [name, gradeName, students, homeroom, adviser] = r.map((x) => String(x ?? "").trim());
      if (!name) continue;
      const g = grades.find((x) => norm(x.name) === norm(gradeName));
      if (!g) { errors.push(`"${name}": grade "${gradeName}" not found`); continue; }
      if (existing.some((s) => s.gradeLevelId === g.id && norm(s.name) === norm(name))) { errors.push(`"${name}": already exists in ${g.name}`); continue; }
      const room = homeroom ? rooms.find((x) => norm(x.name) === norm(homeroom)) : undefined;
      if (homeroom && !room) errors.push(`"${name}": room "${homeroom}" not found (added without a homeroom)`);
      const adv = adviser ? teachers.find((t) => norm(t.name) === norm(adviser))?.name ?? adviser : null;
      const [row] = await db.insert(schema.sections).values({ name, gradeLevelId: g.id, studentCount: Number(students) > 0 ? Math.round(Number(students)) : null, homeroomId: room?.id ?? null, adviser: adv, sortOrder: ++order }).returning();
      existing.push(row);
      added++;
    }
    return c.json({ added, errors }, 200);
  })
  .post("/subjects/import", async (c) => {
    const { rows } = await c.req.json<{ rows: string[][] }>();
    const palette = ["#007041", "#338D67", "#00AD6D", "#1E3D32", "#2C4D46", "#7F5237", "#C0392B", "#D99A00", "#2E5AAC", "#7A4FB5"];
    const existing = await db.select().from(schema.subjects);
    let order = existing.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0);
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const [name, code] = r.map((x) => String(x ?? "").trim());
      if (!name) continue;
      if (existing.some((s) => norm(s.name) === norm(name))) { errors.push(`"${name}": already exists`); continue; }
      const [row] = await db.insert(schema.subjects).values({ name, code: code || null, color: palette[(existing.length + added) % palette.length], sortOrder: ++order, roomIds: [] }).returning();
      existing.push(row);
      added++;
    }
    return c.json({ added, errors }, 200);
  })
  .post("/rooms/import", async (c) => {
    const { rows } = await c.req.json<{ rows: string[][] }>();
    const existing = await db.select().from(schema.rooms);
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const [name, cap] = r.map((x) => String(x ?? "").trim());
      if (!name) continue;
      if (existing.some((s) => norm(s.name) === norm(name))) { errors.push(`"${name}": already exists`); continue; }
      const [row] = await db.insert(schema.rooms).values({ name, capacity: Number(cap) > 0 ? Math.round(Number(cap)) : null }).returning();
      existing.push(row);
      added++;
    }
    return c.json({ added, errors }, 200);
  })
  .post("/time-slots/import", async (c) => {
    const { rows } = await c.req.json<{ rows: string[][] }>();
    const grades = await db.select().from(schema.gradeLevels);
    let order = (await db.select().from(schema.timeSlots)).length;
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const [label, start, end, sort, breakFlag, gradeNames] = r.map((x) => String(x ?? "").trim());
      if (!label) continue;
      const startTime = normTime(start), endTime = normTime(end);
      const gradeLevelIds = gradeNames ? gradeNames.split(/[;|]/).map((g) => grades.find((x) => norm(x.name) === norm(g))?.id).filter((x): x is number => x != null) : [];
      const err = await checkSlot({ label, startTime: startTime ?? "", endTime: endTime ?? "", gradeLevelIds, days: [] }, null);
      if (err) { errors.push(`"${label}": ${err}`); continue; }
      await db.insert(schema.timeSlots).values({ label, startTime: startTime!, endTime: endTime!, sortOrder: Number(sort) || ++order, isBreak: /^(y|yes|true|1|break)$/i.test(breakFlag), gradeLevelIds, days: [] });
      added++;
    }
    return c.json({ added, errors }, 200);
  })
  .post("/teachers/import", async (c) => {
    const { rows } = await c.req.json<{ rows: string[][] }>();
    const subjects = await db.select().from(schema.subjects);
    const grades = await db.select().from(schema.gradeLevels);
    const existing = await db.select().from(schema.teachers);
    let added = 0; const errors: string[] = [];
    const list = (s: string) => s.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
    for (const r of rows) {
      const [name, email, subjNames, gradeNames, maxLoad, maxPerDay] = r.map((x) => String(x ?? "").trim());
      if (!name) continue;
      if (existing.some((t) => norm(t.name) === norm(name))) { errors.push(`"${name}": already exists`); continue; }
      const subjectIds: number[] = [];
      for (const s of list(subjNames ?? "")) {
        const m = subjects.find((x) => norm(x.name) === norm(s) || (x.code && norm(x.code) === norm(s)));
        if (m) subjectIds.push(m.id); else errors.push(`"${name}": subject "${s}" not found (skipped)`);
      }
      const gradeLevelIds: number[] = [];
      for (const g of list(gradeNames ?? "")) {
        const m = grades.find((x) => norm(x.name) === norm(g));
        if (m) gradeLevelIds.push(m.id); else errors.push(`"${name}": grade "${g}" not found (skipped)`);
      }
      const [row] = await db.insert(schema.teachers).values({ name, email: email || null, subjectIds, gradeLevelIds, maxLoad: Number(maxLoad) > 0 ? Math.round(Number(maxLoad)) : null, maxPerDay: Number(maxPerDay) > 0 ? Math.round(Number(maxPerDay)) : null }).returning();
      existing.push(row);
      added++;
    }
    return c.json({ added, errors }, 200);
  })

  // ---------- BULK CLEAR ----------
  .post("/grade-levels/clear", async (c) => {
    await db.delete(schema.scheduleEntries);
    await db.delete(schema.subjectAllocations);
    await db.delete(schema.blockedTimes);
    await db.delete(schema.sections);
    await db.delete(schema.gradeLevels);
    return c.json({ ok: true }, 200);
  })
  .post("/sections/clear", async (c) => {
    await db.delete(schema.scheduleEntries);
    await db.delete(schema.blockedTimes);
    await db.delete(schema.sections);
    return c.json({ ok: true }, 200);
  })
  .post("/subjects/clear", async (c) => {
    await db.delete(schema.scheduleEntries);
    await db.delete(schema.subjectAllocations);
    await db.delete(schema.subjects);
    return c.json({ ok: true }, 200);
  })
  .post("/teachers/clear", async (c) => {
    await db.update(schema.scheduleEntries).set({ teacherId: null });
    await db.delete(schema.teachers);
    return c.json({ ok: true }, 200);
  })
  .post("/rooms/clear", async (c) => {
    await db.update(schema.scheduleEntries).set({ roomId: null });
    await db.update(schema.sections).set({ homeroomId: null });
    await db.delete(schema.rooms);
    return c.json({ ok: true }, 200);
  })
  .post("/time-slots/clear", async (c) => {
    await db.delete(schema.scheduleEntries);
    await db.delete(schema.blockedTimes);
    await db.delete(schema.timeSlots);
    return c.json({ ok: true }, 200);
  })
  .post("/blocked-times/clear", async (c) => {
    await db.delete(schema.blockedTimes);
    return c.json({ ok: true }, 200);
  })
  .post("/allocations/clear", async (c) => {
    await db.delete(schema.subjectAllocations);
    return c.json({ ok: true }, 200);
  })

  // ---------- SCHEDULE ENTRIES ----------
  .get("/entries", async (c) => c.json(await db.select().from(schema.scheduleEntries), 200))
  .post("/entries", async (c) => {
    const b = await c.req.json<{ sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId?: number | null; roomId?: number | null }>();
    const [row] = await db.insert(schema.scheduleEntries).values({
      sectionId: b.sectionId, dayOfWeek: b.dayOfWeek, timeSlotId: b.timeSlotId, subjectId: b.subjectId,
      teacherId: b.teacherId ?? null, roomId: b.roomId ?? null,
    }).returning();
    return c.json(row, 201);
  })
  .put("/entries/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ dayOfWeek?: number; timeSlotId?: number; subjectId?: number; teacherId?: number | null; roomId?: number | null; sectionId?: number }>();
    const [row] = await db.update(schema.scheduleEntries).set(patch(b)).where(eq(schema.scheduleEntries.id, id)).returning();
    return c.json(row, 200);
  })
  .delete("/entries/:id", async (c) => {
    await db.delete(schema.scheduleEntries).where(eq(schema.scheduleEntries.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })
  .post("/entries/bulk", async (c) => {
    const b = await c.req.json<{ entries: { sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId?: number | null; roomId?: number | null }[]; source?: string }>();
    if (!b.entries.length) return c.json({ inserted: 0 }, 200);
    const values = b.entries.map((e) => ({ sectionId: e.sectionId, dayOfWeek: e.dayOfWeek, timeSlotId: e.timeSlotId, subjectId: e.subjectId, teacherId: e.teacherId ?? null, roomId: e.roomId ?? null }));
    for (let i = 0; i < values.length; i += 200) await db.insert(schema.scheduleEntries).values(values.slice(i, i + 200));
    return c.json({ inserted: values.length }, 201);
  })
  .post("/entries/replace", async (c) => {
    // Replaces every class, or only the classes of the given sections.
    const b = await c.req.json<{ entries: { sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId?: number | null; roomId?: number | null }[]; sectionIds?: number[]; source?: string }>();
    if (b.sectionIds?.length) for (const id of b.sectionIds) await db.delete(schema.scheduleEntries).where(eq(schema.scheduleEntries.sectionId, id));
    else await db.delete(schema.scheduleEntries);
    const values = (b.entries ?? []).map((e) => ({ sectionId: e.sectionId, dayOfWeek: e.dayOfWeek, timeSlotId: e.timeSlotId, subjectId: e.subjectId, teacherId: e.teacherId ?? null, roomId: e.roomId ?? null }));
    for (let i = 0; i < values.length; i += 200) await db.insert(schema.scheduleEntries).values(values.slice(i, i + 200));
    return c.json({ ok: true, count: values.length }, 200);
  })
  .post("/entries/clear", async (c) => {
    const b = await c.req.json<{ sectionId?: number }>();
    if (b.sectionId != null) await db.delete(schema.scheduleEntries).where(eq(schema.scheduleEntries.sectionId, b.sectionId));
    else await db.delete(schema.scheduleEntries);
    return c.json({ ok: true }, 200);
  })

  // ---------- CONFLICTS & AUTO-FILL ----------
  .get("/conflicts", async (c) => c.json({ conflicts: detectConflicts(await loadCtx()) }, 200))
  .post("/autofill", async (c) => {
    // fresh: plan the sections from scratch, as if their current classes were cleared.
    const b = await c.req.json<{ sectionIds: number[]; fresh?: boolean }>();
    const loaded = await loadCtx();
    const targets = b.sectionIds?.length ? b.sectionIds : loaded.sections.map((s) => s.id);
    const ctx = b.fresh ? { ...loaded, entries: loaded.entries.filter((e) => !targets.includes(e.sectionId)) } : loaded;
    const result = autoFill(ctx, targets);
    const projected = detectConflicts({ ...ctx, entries: [...ctx.entries, ...result.suggestions.map((s, i) => ({ ...s, id: -1 - i }))] });
    return c.json({ suggestions: result.suggestions, unplaced: result.unplaced, teacherless: result.teacherless, projectedConflicts: projected }, 200);
  })

  // ---------- TEACHING LOADS ----------
  .get("/teaching-loads", async (c) => c.json(await db.select().from(schema.teachingLoads), 200))
  .put("/teaching-loads", async (c) => {
    const b = await c.req.json<{ sectionId: number; subjectId: number; teacherId: number | null }>();
    const existing = (await db.select().from(schema.teachingLoads).where(eq(schema.teachingLoads.sectionId, b.sectionId))).find((l) => l.subjectId === b.subjectId);
    if (b.teacherId == null) {
      if (existing) await db.delete(schema.teachingLoads).where(eq(schema.teachingLoads.id, existing.id));
      return c.json({ ok: true }, 200);
    }
    if (existing) await db.update(schema.teachingLoads).set({ teacherId: b.teacherId }).where(eq(schema.teachingLoads.id, existing.id));
    else await db.insert(schema.teachingLoads).values({ sectionId: b.sectionId, subjectId: b.subjectId, teacherId: b.teacherId });
    return c.json({ ok: true }, 200);
  })
  .post("/teaching-loads/auto", async (c) => {
    const b = await c.req.json<{ sectionIds?: number[] }>().catch(() => ({} as { sectionIds?: number[] }));
    const ctx = await loadCtx();
    const scoped = b.sectionIds?.length ? { ...ctx, sections: ctx.sections.filter((s) => b.sectionIds!.includes(s.id)) } : ctx;
    const r = autoAssignLoads(scoped);
    for (let i = 0; i < r.assigned.length; i += 200) await db.insert(schema.teachingLoads).values(r.assigned.slice(i, i + 200));
    return c.json(r, 200);
  })
  .post("/teaching-loads/clear", async (c) => {
    const b = await c.req.json<{ sectionIds?: number[] }>().catch(() => ({} as { sectionIds?: number[] }));
    if (b.sectionIds?.length) for (const id of b.sectionIds) await db.delete(schema.teachingLoads).where(eq(schema.teachingLoads.sectionId, id));
    else await db.delete(schema.teachingLoads);
    return c.json({ ok: true }, 200);
  })
  .post("/teaching-loads/apply", async (c) => {
    // Set each class's teacher to the one in its teaching load.
    const loads = await db.select().from(schema.teachingLoads);
    const byKey = new Map(loads.map((l) => [`${l.sectionId}:${l.subjectId}`, l.teacherId]));
    const entries = await db.select().from(schema.scheduleEntries);
    let changed = 0;
    for (const e of entries) {
      const t = byKey.get(`${e.sectionId}:${e.subjectId}`);
      if (t != null && t !== e.teacherId) { await db.update(schema.scheduleEntries).set({ teacherId: t }).where(eq(schema.scheduleEntries.id, e.id)); changed++; }
    }
    return c.json({ changed }, 200);
  })
  .post("/teaching-loads/import", async (c) => {
    const { rows } = await c.req.json<{ rows: string[][] }>();
    const [sections, subjects, teachers, grades] = await Promise.all([db.select().from(schema.sections), db.select().from(schema.subjects), db.select().from(schema.teachers), db.select().from(schema.gradeLevels)]);
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const [secName, subjName, teacherName, gradeName] = r.map((x) => String(x ?? "").trim());
      if (!secName) continue;
      const matches = sections.filter((s) => norm(s.name) === norm(secName) && (!gradeName || grades.find((g) => g.id === s.gradeLevelId && norm(g.name) === norm(gradeName))));
      const sec = matches[0];
      const subj = subjects.find((s) => norm(s.name) === norm(subjName) || (s.code && norm(s.code) === norm(subjName)));
      const t = teachers.find((x) => norm(x.name) === norm(teacherName));
      if (!sec) { errors.push(`"${secName}": section not found`); continue; }
      if (matches.length > 1) errors.push(`"${secName}": more than one section has this name; used ${grades.find((g) => g.id === sec.gradeLevelId)?.name} (add the grade level as a 4th column)`);
      if (!subj) { errors.push(`"${subjName}": subject not found`); continue; }
      if (!t) { errors.push(`"${teacherName}": teacher not found`); continue; }
      const existing = (await db.select().from(schema.teachingLoads).where(eq(schema.teachingLoads.sectionId, sec.id))).find((l) => l.subjectId === subj.id);
      if (existing) await db.update(schema.teachingLoads).set({ teacherId: t.id }).where(eq(schema.teachingLoads.id, existing.id));
      else await db.insert(schema.teachingLoads).values({ sectionId: sec.id, subjectId: subj.id, teacherId: t.id });
      added++;
    }
    return c.json({ added, errors }, 200);
  })

  // ---------- SUBSTITUTIONS ----------
  .get("/substitutions", async (c) => {
    const from = c.req.query("from"), to = c.req.query("to"), date = c.req.query("date");
    let rows = await db.select().from(schema.substitutions).orderBy(asc(schema.substitutions.date), asc(schema.substitutions.id));
    if (date) rows = rows.filter((r) => r.date === date);
    if (from) rows = rows.filter((r) => r.date >= from);
    if (to) rows = rows.filter((r) => r.date <= to);
    return c.json(rows, 200);
  })
  .get("/substitutions/plan", async (c) => {
    // The absent teacher's classes on that date, each with ranked substitutes.
    const date = c.req.query("date") ?? "";
    const teacherId = Number(c.req.query("teacherId"));
    const d = new Date(date + "T00:00:00");
    if (Number.isNaN(d.getTime())) return c.json(bad("Pick a valid date."), 400);
    const day = ((d.getDay() + 6) % 7) + 1;
    const ctx = await loadCtx();
    const subs = await db.select().from(schema.substitutions);
    const thatDay = subs.filter((s) => s.date === date);
    const since = new Date(d.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const recent = new Map<number, number>();
    for (const s of subs) if (s.substituteTeacherId != null && s.date >= since && s.date <= date) recent.set(s.substituteTeacherId, (recent.get(s.substituteTeacherId) ?? 0) + 1);
    const slotOrder = new Map(ctx.timeSlots.map((s) => [s.id, toMinutes(s.startTime)]));
    const classes = ctx.entries
      .filter((e) => e.teacherId === teacherId && e.dayOfWeek === day)
      .sort((a, b) => (slotOrder.get(a.timeSlotId) ?? 0) - (slotOrder.get(b.timeSlotId) ?? 0))
      .map((e) => {
        const existing = thatDay.find((s) => s.sectionId === e.sectionId && s.timeSlotId === e.timeSlotId) ?? null;
        const grade = ctx.sections.find((s) => s.id === e.sectionId)?.gradeLevelId ?? null;
        const others = thatDay.filter((s) => s.id !== existing?.id).map((s) => ({ substituteTeacherId: s.substituteTeacherId, timeSlotId: s.timeSlotId }));
        const candidates = rankSubstitutes(ctx, { day, slotId: e.timeSlotId, subjectId: e.subjectId, gradeLevelId: grade, absentTeacherId: teacherId, subsThatDay: others, recentSubCounts: recent }).slice(0, 12);
        return { sectionId: e.sectionId, subjectId: e.subjectId, timeSlotId: e.timeSlotId, roomId: e.roomId, existing, candidates };
      });
    return c.json({ date, day, classes }, 200);
  })
  .post("/substitutions", async (c) => {
    const b = await c.req.json<{ date: string; sectionId: number; subjectId?: number | null; timeSlotId: number; absentTeacherId?: number | null; substituteTeacherId?: number | null; note?: string | null }>();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "")) return c.json(bad("Pick a valid date."), 400);
    const existing = (await db.select().from(schema.substitutions).where(eq(schema.substitutions.date, b.date))).find((s) => s.sectionId === b.sectionId && s.timeSlotId === b.timeSlotId);
    const vals = { date: b.date, sectionId: b.sectionId, subjectId: b.subjectId ?? null, timeSlotId: b.timeSlotId, absentTeacherId: b.absentTeacherId ?? null, substituteTeacherId: b.substituteTeacherId ?? null, note: b.note ?? null };
    if (existing) {
      const [row] = await db.update(schema.substitutions).set(vals).where(eq(schema.substitutions.id, existing.id)).returning();
      return c.json(row, 200);
    }
    const [row] = await db.insert(schema.substitutions).values(vals).returning();
    return c.json(row, 201);
  })
  .delete("/substitutions/:id", async (c) => {
    await db.delete(schema.substitutions).where(eq(schema.substitutions.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- BULK TOOLS ----------
  .post("/tools/copy-schedule", async (c) => {
    const b = await c.req.json<{ fromSectionId: number; toSectionIds: number[]; teachers: "loads" | "same" | "none"; replace?: boolean }>();
    const ctx = await loadCtx();
    const src = ctx.entries.filter((e) => e.sectionId === b.fromSectionId);
    const slotById = new Map(ctx.timeSlots.map((s) => [s.id, s]));
    const loads = new Map((ctx.loads ?? []).map((l) => [`${l.sectionId}:${l.subjectId}`, l.teacherId]));
    let created = 0, skipped = 0;
    for (const toId of b.toSectionIds.filter((id) => id !== b.fromSectionId)) {
      const sec = ctx.sections.find((s) => s.id === toId);
      if (!sec) continue;
      if (b.replace) await db.delete(schema.scheduleEntries).where(eq(schema.scheduleEntries.sectionId, toId));
      const taken = new Set(b.replace ? [] : ctx.entries.filter((e) => e.sectionId === toId).map((e) => `${e.dayOfWeek}:${e.timeSlotId}`));
      const values: any[] = [];
      for (const e of src) {
        const slot = slotById.get(e.timeSlotId);
        if (!slot || !slotApplies(slot, sec.gradeLevelId, e.dayOfWeek) || taken.has(`${e.dayOfWeek}:${e.timeSlotId}`)) { skipped++; continue; }
        const subj = ctx.subjects.find((s) => s.id === e.subjectId);
        const teacherId = b.teachers === "same" ? e.teacherId : b.teachers === "loads" ? loads.get(`${toId}:${e.subjectId}`) ?? null : null;
        const roomId = subj?.roomIds?.length ? e.roomId : sec.homeroomId ?? null;
        values.push({ sectionId: toId, dayOfWeek: e.dayOfWeek, timeSlotId: e.timeSlotId, subjectId: e.subjectId, teacherId, roomId });
      }
      for (let i = 0; i < values.length; i += 200) await db.insert(schema.scheduleEntries).values(values.slice(i, i + 200));
      created += values.length;
    }
    return c.json({ created, skipped }, 200);
  })
  .post("/tools/copy-day", async (c) => {
    const b = await c.req.json<{ sectionIds: number[]; fromDay: number; toDay: number; replace?: boolean }>();
    if (b.fromDay === b.toDay) return c.json(bad("Pick two different days."), 400);
    const ctx = await loadCtx();
    const slotById = new Map(ctx.timeSlots.map((s) => [s.id, s]));
    let created = 0, skipped = 0;
    for (const sid of b.sectionIds) {
      const sec = ctx.sections.find((s) => s.id === sid);
      if (!sec) continue;
      if (b.replace) {
        for (const e of ctx.entries.filter((x) => x.sectionId === sid && x.dayOfWeek === b.toDay)) await db.delete(schema.scheduleEntries).where(eq(schema.scheduleEntries.id, e.id));
      }
      const taken = new Set(b.replace ? [] : ctx.entries.filter((x) => x.sectionId === sid && x.dayOfWeek === b.toDay).map((x) => x.timeSlotId));
      for (const e of ctx.entries.filter((x) => x.sectionId === sid && x.dayOfWeek === b.fromDay)) {
        const slot = slotById.get(e.timeSlotId);
        if (!slot || !slotApplies(slot, sec.gradeLevelId, b.toDay) || taken.has(e.timeSlotId)) { skipped++; continue; }
        await db.insert(schema.scheduleEntries).values({ sectionId: sid, dayOfWeek: b.toDay, timeSlotId: e.timeSlotId, subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId });
        created++;
      }
    }
    return c.json({ created, skipped }, 200);
  })
  .post("/tools/replace-teacher", async (c) => {
    const b = await c.req.json<{ fromTeacherId: number; toTeacherId: number | null; sectionIds?: number[]; includeLoads?: boolean }>();
    const entries = await db.select().from(schema.scheduleEntries).where(eq(schema.scheduleEntries.teacherId, b.fromTeacherId));
    let classes = 0, loadsChanged = 0;
    for (const e of entries) {
      if (b.sectionIds?.length && !b.sectionIds.includes(e.sectionId)) continue;
      await db.update(schema.scheduleEntries).set({ teacherId: b.toTeacherId }).where(eq(schema.scheduleEntries.id, e.id));
      classes++;
    }
    if (b.includeLoads !== false) {
      const loads = await db.select().from(schema.teachingLoads).where(eq(schema.teachingLoads.teacherId, b.fromTeacherId));
      for (const l of loads) {
        if (b.sectionIds?.length && !b.sectionIds.includes(l.sectionId)) continue;
        if (b.toTeacherId == null) await db.delete(schema.teachingLoads).where(eq(schema.teachingLoads.id, l.id));
        else await db.update(schema.teachingLoads).set({ teacherId: b.toTeacherId }).where(eq(schema.teachingLoads.id, l.id));
        loadsChanged++;
      }
    }
    return c.json({ classes, loads: loadsChanged }, 200);
  })

  // ---------- UNDO / REDO (kept in the database, so it survives a refresh) ----------
  .get("/history", async (c) => {
    const rows = await db.select({ id: schema.undoLog.id, stack: schema.undoLog.stack, label: schema.undoLog.label, createdAt: schema.undoLog.createdAt }).from(schema.undoLog).orderBy(desc(schema.undoLog.id));
    const undo = rows.filter((r) => r.stack === "undo");
    const redo = rows.filter((r) => r.stack === "redo");
    return c.json({ undo: undo[0] ?? null, redo: redo[0] ?? null, undoCount: undo.length, redoCount: redo.length }, 200);
  })
  .post("/history/undo", async (c) => {
    const [top] = await db.select().from(schema.undoLog).where(eq(schema.undoLog.stack, "undo")).orderBy(desc(schema.undoLog.id)).limit(1);
    if (!top) return c.json(bad("Nothing to undo."), 400);
    const now = await takeSnapshot();
    await restoreSnapshot(unpack(top.payload));
    await db.delete(schema.undoLog).where(eq(schema.undoLog.id, top.id));
    await pushHistory("redo", top.label, now);
    (c.set as any)("auditDetails", top.label);
    return c.json({ ok: true, label: top.label }, 200);
  })
  .post("/history/redo", async (c) => {
    const [top] = await db.select().from(schema.undoLog).where(eq(schema.undoLog.stack, "redo")).orderBy(desc(schema.undoLog.id)).limit(1);
    if (!top) return c.json(bad("Nothing to redo."), 400);
    const now = await takeSnapshot();
    await restoreSnapshot(unpack(top.payload));
    await db.delete(schema.undoLog).where(eq(schema.undoLog.id, top.id));
    await pushHistory("undo", top.label, now);
    (c.set as any)("auditDetails", top.label);
    return c.json({ ok: true, label: top.label }, 200);
  })

  // ---------- ACTIVITY LOG ----------
  .get("/audit", async (c) => {
    const limit = Math.min(500, Number(c.req.query("limit")) || 200);
    const before = Number(c.req.query("before"));
    const q = db.select().from(schema.auditLog);
    const rows = await (Number.isFinite(before) && before > 0 ? q.where(lt(schema.auditLog.id, before)) : q).orderBy(desc(schema.auditLog.id)).limit(limit);
    return c.json(rows, 200);
  })

  // ---------- TERMS (school years / semesters) ----------
  .get("/terms", async (c) => {
    let rows = await db.select().from(schema.terms).orderBy(asc(schema.terms.id));
    if (!rows.length) {
      await db.insert(schema.terms).values({ name: "Current school year", isActive: true });
      rows = await db.select().from(schema.terms).orderBy(asc(schema.terms.id));
    }
    return c.json(rows.map(({ payload, ...t }) => ({ ...t, stored: !!payload })), 200);
  })
  .post("/terms", async (c) => {
    const b = await c.req.json<{ name: string; startDate?: string | null; endDate?: string | null; copy: "all" | "setup" | "empty" }>();
    if (!String(b.name ?? "").trim()) return c.json(bad("Give the term a name."), 400);
    const snap = await takeSnapshot();
    const payload: Snapshot = b.copy === "all" ? snap : b.copy === "setup" ? setupOnly(snap) : { settings: snap.settings, gradeLevels: [], sections: [], subjects: [], teachers: [], rooms: [], timeSlots: [], blockedTimes: [], allocations: [], entries: [], teachingLoads: [], teacherUnavailability: [], substitutions: [] };
    const [row] = await db.insert(schema.terms).values({ name: b.name.trim(), startDate: b.startDate || null, endDate: b.endDate || null, isActive: false, payload: pack(payload) }).returning();
    const { payload: _p, ...t } = row;
    return c.json(t, 201);
  })
  .put("/terms/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json<{ name?: string; startDate?: string | null; endDate?: string | null }>();
    const set: any = {};
    if (b.name !== undefined) set.name = String(b.name).trim();
    if (b.startDate !== undefined) set.startDate = b.startDate || null;
    if (b.endDate !== undefined) set.endDate = b.endDate || null;
    if (set.startDate && set.endDate && set.endDate < set.startDate) return c.json(bad("The term ends before it starts."), 400);
    const [row] = await db.update(schema.terms).set(set).where(eq(schema.terms.id, id)).returning();
    const { payload: _p, ...t } = row;
    return c.json(t, 200);
  })
  .post("/terms/:id/activate", async (c) => {
    const id = Number(c.req.param("id"));
    const all = await db.select().from(schema.terms);
    const target = all.find((t) => t.id === id);
    if (!target) return c.json(bad("Term not found"), 404);
    if (target.isActive) return c.json({ ok: true }, 200);
    if (!target.payload) return c.json(bad("This term has no saved data."), 400);
    const current = all.find((t) => t.isActive);
    const live = await takeSnapshot();
    if (current) await db.update(schema.terms).set({ isActive: false, payload: pack(live) }).where(eq(schema.terms.id, current.id));
    await restoreSnapshot(unpack(target.payload));
    await db.update(schema.terms).set({ isActive: true, payload: null }).where(eq(schema.terms.id, id));
    await db.delete(schema.undoLog); // history belongs to the previous term
    return c.json({ ok: true }, 200);
  })
  .delete("/terms/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const t = (await db.select().from(schema.terms).where(eq(schema.terms.id, id)))[0];
    if (t?.isActive) return c.json(bad("Switch to another term before deleting this one."), 400);
    await db.delete(schema.terms).where(eq(schema.terms.id, id));
    return c.json({ ok: true }, 200);
  })

  // ---------- SAVE POINTS ----------
  .get("/save-points", async (c) => {
    const rows = await db.select({
      id: schema.savePoints.id, name: schema.savePoints.name, note: schema.savePoints.note,
      entryCount: schema.savePoints.entryCount, sectionCount: schema.savePoints.sectionCount, createdAt: schema.savePoints.createdAt,
    }).from(schema.savePoints).orderBy(desc(schema.savePoints.createdAt));
    return c.json(rows, 200);
  })
  .post("/save-points", async (c) => {
    const b = await c.req.json<{ name?: string; note?: string | null }>();
    const payload = await takeSnapshot();
    const name = (b.name?.trim() || `Save ${new Date().toLocaleString()}`).slice(0, 120);
    const [row] = await db.insert(schema.savePoints).values({
      name, note: b.note ?? null, entryCount: payload.entries?.length ?? 0, sectionCount: payload.sections?.length ?? 0, payload: payload as any,
    }).returning({
      id: schema.savePoints.id, name: schema.savePoints.name, note: schema.savePoints.note,
      entryCount: schema.savePoints.entryCount, sectionCount: schema.savePoints.sectionCount, createdAt: schema.savePoints.createdAt,
    });
    return c.json(row, 201);
  })
  .post("/save-points/:id/restore", async (c) => {
    const id = Number(c.req.param("id"));
    const [sp] = await db.select().from(schema.savePoints).where(eq(schema.savePoints.id, id));
    if (!sp) return c.json(bad("Save point not found"), 404);
    await restoreSnapshot(sp.payload as Snapshot);
    return c.json({ ok: true, restored: id }, 200);
  })
  .delete("/save-points/:id", async (c) => {
    await db.delete(schema.savePoints).where(eq(schema.savePoints.id, Number(c.req.param("id"))));
    return c.json({ ok: true }, 200);
  })

  // ---------- SEED DEMO DATA ----------
  .post("/seed", async (c) => {
    await db.delete(schema.substitutions);
    await db.delete(schema.teacherUnavailability);
    await db.delete(schema.teachingLoads);
    await db.delete(schema.scheduleEntries);
    await db.delete(schema.blockedTimes);
    await db.delete(schema.subjectAllocations);
    await db.delete(schema.sections);
    await db.delete(schema.teachers);
    await db.delete(schema.rooms);
    await db.delete(schema.subjects);
    await db.delete(schema.timeSlots);
    await db.delete(schema.gradeLevels);

    const [g7, g8] = await db.insert(schema.gradeLevels).values([{ name: "Grade 7", sortOrder: 1 }, { name: "Grade 8", sortOrder: 2 }]).returning();
    const rooms = await db.insert(schema.rooms).values([
      { name: "Room 101", capacity: 40 }, { name: "Room 102", capacity: 40 }, { name: "Room 103", capacity: 40 },
      { name: "Science Lab", capacity: 40 }, { name: "Gym", capacity: 100 },
    ]).returning();
    const rid = (n: string) => rooms.find((r) => r.name === n)!.id;
    const subs = await db.insert(schema.subjects).values([
      { name: "Mathematics", code: "MATH", color: "#007041", sortOrder: 1, roomIds: [], timePreference: "morning" },
      { name: "English", code: "ENG", color: "#338D67", sortOrder: 2, roomIds: [] },
      { name: "Science", code: "SCI", color: "#00AD6D", sortOrder: 3, roomIds: [rid("Science Lab")] },
      { name: "Filipino", code: "FIL", color: "#7F5237", sortOrder: 4, roomIds: [] },
      { name: "Araling Panlipunan", code: "AP", color: "#2C4D46", sortOrder: 5, roomIds: [] },
      { name: "MAPEH", code: "MAPEH", color: "#D99A00", sortOrder: 6, roomIds: [rid("Gym")], timePreference: "afternoon" },
    ]).returning();
    const sid = (code: string) => subs.find((s) => s.code === code)!.id;
    const teachers = await db.insert(schema.teachers).values([
      { name: "Ms. Reyes", subjectIds: [sid("MATH")], color: "#007041", maxLoad: 25, maxPerDay: 6 },
      { name: "Mr. Santos", subjectIds: [sid("ENG")], color: "#338D67", maxLoad: 25, maxPerDay: 6 },
      { name: "Ms. Cruz", subjectIds: [sid("SCI")], color: "#00AD6D", maxLoad: 25, maxPerDay: 6 },
      { name: "Mr. Bautista", subjectIds: [sid("FIL"), sid("AP")], color: "#7F5237", maxLoad: 25, maxPerDay: 6 },
      { name: "Ms. Dela Rosa", subjectIds: [sid("MAPEH")], color: "#D99A00", maxLoad: 25, maxPerDay: 6 },
      { name: "Mr. Garcia", subjectIds: [sid("MATH"), sid("SCI")], color: "#2E5AAC", maxLoad: 20, maxPerDay: 5 },
      { name: "Ms. Aquino", subjectIds: [sid("AP"), sid("FIL")], color: "#7A4FB5", maxLoad: 20, maxPerDay: 5 },
    ]).returning();
    await db.insert(schema.sections).values([
      { name: "7-Einstein", gradeLevelId: g7.id, adviser: "Ms. Reyes", sortOrder: 1, homeroomId: rid("Room 101"), studentCount: 38 },
      { name: "7-Newton", gradeLevelId: g7.id, adviser: "Mr. Santos", sortOrder: 2, homeroomId: rid("Room 102"), studentCount: 36 },
      { name: "8-Darwin", gradeLevelId: g8.id, adviser: "Ms. Cruz", sortOrder: 3, homeroomId: rid("Room 103"), studentCount: 40 },
    ]);
    const slots = await db.insert(schema.timeSlots).values([
      { label: "P1", startTime: "07:30", endTime: "08:20", sortOrder: 1, gradeLevelIds: [], days: [] },
      { label: "P2", startTime: "08:20", endTime: "09:10", sortOrder: 2, gradeLevelIds: [], days: [] },
      { label: "Recess", startTime: "09:10", endTime: "09:30", sortOrder: 3, isBreak: true, gradeLevelIds: [], days: [] },
      { label: "P3", startTime: "09:30", endTime: "10:20", sortOrder: 4, gradeLevelIds: [], days: [] },
      { label: "P4", startTime: "10:20", endTime: "11:10", sortOrder: 5, gradeLevelIds: [], days: [] },
      { label: "Lunch", startTime: "11:10", endTime: "12:00", sortOrder: 6, isBreak: true, gradeLevelIds: [], days: [] },
      { label: "P5", startTime: "12:00", endTime: "12:50", sortOrder: 7, gradeLevelIds: [], days: [] },
      { label: "P6", startTime: "12:50", endTime: "13:40", sortOrder: 8, gradeLevelIds: [], days: [] },
    ]).returning();
    const alloc = (g: number) => [
      { gradeLevelId: g, subjectId: sid("MATH"), periodsPerWeek: 5, blockSize: 1, maxPerDay: 1 },
      { gradeLevelId: g, subjectId: sid("ENG"), periodsPerWeek: 5, blockSize: 1, maxPerDay: 1 },
      { gradeLevelId: g, subjectId: sid("SCI"), periodsPerWeek: 4, blockSize: 2, maxPerDay: 2 },
      { gradeLevelId: g, subjectId: sid("FIL"), periodsPerWeek: 4, blockSize: 1, maxPerDay: 1 },
      { gradeLevelId: g, subjectId: sid("AP"), periodsPerWeek: 4, blockSize: 1, maxPerDay: 1 },
      { gradeLevelId: g, subjectId: sid("MAPEH"), periodsPerWeek: 4, blockSize: 1, maxPerDay: 1 },
    ];
    await db.insert(schema.subjectAllocations).values([...alloc(g7.id), ...alloc(g8.id)]);
    await db.insert(schema.blockedTimes).values([{ dayOfWeek: 1, timeSlotId: slots[0].id, sectionId: null, reason: "Flag Ceremony" }]);
    const garcia = teachers.find((t) => t.name === "Mr. Garcia")!;
    await db.insert(schema.teacherUnavailability).values([
      { teacherId: garcia.id, dayOfWeek: 5, timeSlotId: slots[6].id, reason: "Department meeting" },
      { teacherId: garcia.id, dayOfWeek: 5, timeSlotId: slots[7].id, reason: "Department meeting" },
    ]);
    return c.json({ ok: true, teachers: teachers.length, rooms: rooms.length }, 200);
  });

export type AppType = typeof app;
export default app;
