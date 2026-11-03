// Full data snapshots: used by save points, undo/redo and terms.
// A snapshot holds every scheduling table (not users, logs, the print
// template or save points themselves) and can be restored with ids intact.
import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";
import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";

export interface Snapshot {
  gradeLevels?: any[];
  sections?: any[];
  subjects?: any[];
  teachers?: any[];
  rooms?: any[];
  timeSlots?: any[];
  blockedTimes?: any[];
  allocations?: any[];
  entries?: any[];
  teachingLoads?: any[];
  teacherUnavailability?: any[];
  substitutions?: any[];
  settings?: { activeDays?: number[] } | null;
}

export async function takeSnapshot(): Promise<Snapshot> {
  const [gradeLevels, sections, subjects, teachers, rooms, timeSlots, blockedTimes, allocations, entries, teachingLoads, teacherUnavailability, substitutions, settingsRows] =
    await Promise.all([
      db.select().from(schema.gradeLevels),
      db.select().from(schema.sections),
      db.select().from(schema.subjects),
      db.select().from(schema.teachers),
      db.select().from(schema.rooms),
      db.select().from(schema.timeSlots),
      db.select().from(schema.blockedTimes),
      db.select().from(schema.subjectAllocations),
      db.select().from(schema.scheduleEntries),
      db.select().from(schema.teachingLoads),
      db.select().from(schema.teacherUnavailability),
      db.select().from(schema.substitutions),
      db.select().from(schema.settings),
    ]);
  const s = settingsRows[0];
  return {
    gradeLevels, sections, subjects, teachers, rooms, timeSlots, blockedTimes, allocations, entries,
    teachingLoads, teacherUnavailability, substitutions,
    settings: s ? { activeDays: s.activeDays } : null,
  };
}

/** An empty-schedule copy of a snapshot: same setup, no classes or substitutions. */
export function setupOnly(s: Snapshot): Snapshot {
  return { ...s, entries: [], substitutions: [] };
}

const rehydrate = (rows: any[] | undefined) =>
  (rows ?? []).map((r) => ({ ...r, createdAt: r.createdAt != null ? new Date(r.createdAt) : new Date() }));

async function insertChunked(table: any, rows: any[]) {
  for (let i = 0; i < rows.length; i += 200) await db.insert(table).values(rows.slice(i, i + 200));
}

/**
 * Replace all scheduling data with a snapshot. Tables missing from an older
 * snapshot (saved before a feature existed) keep their current rows where the
 * rows they point to still exist.
 */
export async function restoreSnapshot(p: Snapshot) {
  const keep = {
    teachingLoads: p.teachingLoads === undefined ? await db.select().from(schema.teachingLoads) : null,
    teacherUnavailability: p.teacherUnavailability === undefined ? await db.select().from(schema.teacherUnavailability) : null,
    substitutions: p.substitutions === undefined ? await db.select().from(schema.substitutions) : null,
  };

  // Children first.
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

  // Parents first; ids are preserved.
  await insertChunked(schema.gradeLevels, rehydrate(p.gradeLevels));
  await insertChunked(schema.subjects, rehydrate(p.subjects));
  await insertChunked(schema.rooms, rehydrate(p.rooms));
  await insertChunked(schema.timeSlots, rehydrate(p.timeSlots));
  await insertChunked(schema.teachers, rehydrate(p.teachers));
  await insertChunked(schema.sections, rehydrate(p.sections));
  await insertChunked(schema.blockedTimes, rehydrate(p.blockedTimes));
  await insertChunked(schema.subjectAllocations, rehydrate(p.allocations));
  await insertChunked(schema.scheduleEntries, rehydrate(p.entries));

  const ids = (rows: any[] | undefined) => new Set((rows ?? []).map((r) => r.id));
  const sectionIds = ids(p.sections), subjectIds = ids(p.subjects), teacherIds = ids(p.teachers), slotIds = ids(p.timeSlots);
  const loads = p.teachingLoads ?? (keep.teachingLoads ?? []).filter((l) => sectionIds.has(l.sectionId) && subjectIds.has(l.subjectId) && teacherIds.has(l.teacherId));
  const unav = p.teacherUnavailability ?? (keep.teacherUnavailability ?? []).filter((u) => teacherIds.has(u.teacherId) && slotIds.has(u.timeSlotId));
  const subs = (p.substitutions ?? (keep.substitutions ?? []).filter((x) => sectionIds.has(x.sectionId) && slotIds.has(x.timeSlotId)))
    .map((x: any) => ({
      ...x,
      subjectId: x.subjectId != null && subjectIds.has(x.subjectId) ? x.subjectId : null,
      absentTeacherId: x.absentTeacherId != null && teacherIds.has(x.absentTeacherId) ? x.absentTeacherId : null,
      substituteTeacherId: x.substituteTeacherId != null && teacherIds.has(x.substituteTeacherId) ? x.substituteTeacherId : null,
    }));
  await insertChunked(schema.teachingLoads, rehydrate(loads));
  await insertChunked(schema.teacherUnavailability, rehydrate(unav));
  await insertChunked(schema.substitutions, rehydrate(subs));

  if (p.settings?.activeDays) {
    const rows = await db.select().from(schema.settings);
    if (rows.length) await db.update(schema.settings).set({ activeDays: p.settings.activeDays }).where(eq(schema.settings.id, rows[0].id));
  }
}

// ---- compact storage for undo history and terms ----
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
export function pack(s: Snapshot): string {
  return "z1:" + toB64(deflateSync(strToU8(JSON.stringify(s)), { level: 6 }));
}
export function unpack(text: string): Snapshot {
  if (text.startsWith("z1:")) return JSON.parse(strFromU8(inflateSync(fromB64(text.slice(3)))));
  return JSON.parse(text);
}
