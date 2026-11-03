// Turns an API request into a readable activity-log line, and decides which
// requests are recorded for undo.
import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ENTITY: Record<string, { table: any; noun: string; nameField: string }> = {
  "grade-levels": { table: schema.gradeLevels, noun: "grade level", nameField: "name" },
  sections: { table: schema.sections, noun: "section", nameField: "name" },
  subjects: { table: schema.subjects, noun: "subject", nameField: "name" },
  teachers: { table: schema.teachers, noun: "teacher", nameField: "name" },
  rooms: { table: schema.rooms, noun: "room", nameField: "name" },
  "time-slots": { table: schema.timeSlots, noun: "period", nameField: "label" },
  "blocked-times": { table: schema.blockedTimes, noun: "blocked time", nameField: "reason" },
  "save-points": { table: schema.savePoints, noun: "save point", nameField: "name" },
  substitutions: { table: schema.substitutions, noun: "substitution", nameField: "date" },
  terms: { table: schema.terms, noun: "term", nameField: "name" },
};

async function nameOf(kind: string, id: number): Promise<string | null> {
  const ent = ENTITY[kind];
  if (!ent || !Number.isFinite(id)) return null;
  const rows = await db.select().from(ent.table).where(eq(ent.table.id, id));
  const r: any = rows[0];
  return r ? String(r[ent.nameField] ?? "") || null : null;
}

async function classDesc(e: { sectionId?: number; dayOfWeek?: number; timeSlotId?: number; subjectId?: number } | undefined): Promise<string> {
  if (!e) return "";
  const [sec, slot, subj] = await Promise.all([
    e.sectionId != null ? nameOf("sections", e.sectionId) : null,
    e.timeSlotId != null ? nameOf("time-slots", e.timeSlotId) : null,
    e.subjectId != null ? nameOf("subjects", e.subjectId) : null,
  ]);
  return [sec, e.dayOfWeek != null ? `${DAY[e.dayOfWeek] ?? ""} ${slot ?? ""}`.trim() : slot, subj].filter(Boolean).join(" · ");
}

export interface RequestInfo {
  label: string;      // short, shown in undo button and log
  details: string;    // extra context for the log
  undoable: boolean;  // take a snapshot first
  audit: boolean;     // write to the activity log
}

/** Describe a mutating request (called before it runs, so deleted names can still be looked up). */
export async function describe(method: string, path: string, body: any): Promise<RequestInfo> {
  const seg = path.replace(/^\/api/, "").split("/").filter(Boolean);
  const [a, b, c] = seg;
  const id = Number(b);
  const info = (label: string, details = "", undoable = true, audit = true): RequestInfo => ({ label, details, undoable, audit });

  // Not part of undo history.
  if (a === "history") return info(b === "redo" ? "Redo" : "Undo", "", false, true);
  if (a === "auth") return info("Account change", "", false, false);
  if (a === "settings") {
    if (b === "lock") return info("Locked changes", "", false, true);
    if (b === "unlock") return info("Unlocked changes", "", false, true);
    if (b === "lock-password") return info("Changed lockdown password", "", false, true);
    const keys = Object.keys(body ?? {});
    const what = keys.includes("printTemplate") ? "print template" : keys.includes("tabConfig") ? "menu order" : keys.includes("activeDays") ? "school days" : "print settings";
    return info(`Changed ${what}`, "", keys.includes("activeDays"), true);
  }
  if (a === "terms") {
    if (c === "activate") return info("Switched term", (await nameOf("terms", id)) ?? "", false, true);
    if (method === "DELETE") return info("Deleted term", (await nameOf("terms", id)) ?? "", false, true);
    return info(method === "POST" ? "Added term" : "Edited term", body?.name ?? "", false, true);
  }
  if (a === "save-points") {
    if (c === "restore") return info("Restored save point", (await nameOf("save-points", id)) ?? "");
    if (method === "DELETE") return info("Deleted save point", (await nameOf("save-points", id)) ?? "", false, true);
    return info("Created save point", body?.name ?? "", false, true);
  }
  if (a === "teachers" && c === "share-link") return info("Created schedule link", (await nameOf("teachers", id)) ?? "", false, true);
  if (a === "seed") return info("Loaded demo data");
  if (a === "autofill") return info("Auto-fill preview", "", false, false);

  if (a === "entries") {
    if (b === "bulk") return info(`Added ${body?.entries?.length ?? 0} classes`, body?.source ?? "auto-fill");
    if (b === "replace") return info(body?.source === "rebuild" ? (body?.sectionIds?.length === 1 ? "Rebuilt a section's schedule" : "Rebuilt the schedule") : "Replaced the schedule", `${body?.entries?.length ?? 0} classes${body?.sectionIds?.length === 1 ? ` · ${(await nameOf("sections", body.sectionIds[0])) ?? ""}` : ""}`);
    if (b === "clear") return info(body?.sectionId != null ? "Cleared section schedule" : "Cleared all schedules", body?.sectionId != null ? (await nameOf("sections", body.sectionId)) ?? "" : "");
    if (method === "POST") return info("Added class", await classDesc(body));
    const rows = Number.isFinite(id) ? await db.select().from(schema.scheduleEntries).where(eq(schema.scheduleEntries.id, id)) : [];
    const before = rows[0];
    if (method === "DELETE") return info("Removed class", await classDesc(before));
    const moved = body?.dayOfWeek != null || body?.timeSlotId != null;
    return info(moved ? "Moved class" : "Changed class", await classDesc({ ...before, ...body }));
  }
  if (a === "teaching-loads") {
    if (b === "auto") return info("Auto-assigned teaching loads");
    if (b === "apply") return info("Applied teaching loads to the schedule");
    if (b === "clear") return info("Cleared teaching loads");
    if (b === "import") return info("Imported teaching loads", `${body?.rows?.length ?? 0} rows`);
    return info("Changed teaching load", await classDesc({ sectionId: body?.sectionId, subjectId: body?.subjectId }));
  }
  if (a === "substitutions") {
    if (method === "DELETE") return info("Removed substitution", (await nameOf("substitutions", id)) ?? "");
    return info("Assigned substitute", `${body?.date ?? ""} · ${await classDesc({ sectionId: body?.sectionId, timeSlotId: body?.timeSlotId, subjectId: body?.subjectId })}`);
  }
  if (a === "tools") {
    if (b === "copy-schedule") return info("Copied a schedule", `from ${(await nameOf("sections", body?.fromSectionId)) ?? "?"} to ${body?.toSectionIds?.length ?? 0} section(s)`);
    if (b === "copy-day") return info("Copied a day", `${DAY[body?.fromDay] ?? "?"} → ${DAY[body?.toDay] ?? "?"}`);
    if (b === "replace-teacher") return info("Replaced a teacher", `${(await nameOf("teachers", body?.fromTeacherId)) ?? "?"} → ${(await nameOf("teachers", body?.toTeacherId)) ?? "?"}`);
  }
  if (a === "allocations") {
    if (b === "clear") return info("Reset all allocations");
    if (b === "import") return info("Imported allocations", `${body?.rows?.length ?? 0} rows`);
    return info("Changed allocation", await classDesc({ subjectId: body?.subjectId }));
  }

  const ent = ENTITY[a];
  if (ent) {
    if (b === "clear") return info(`Deleted all ${ent.noun === "period" ? "time slots" : ent.noun + "s"}`);
    if (b === "import") return info(`Imported ${ent.noun}s`, `${body?.rows?.length ?? 0} rows`);
    if (b === "reorder") return info(`Reordered ${ent.noun}s`);
    if (c === "unavailability") return info("Changed teacher availability", (await nameOf("teachers", id)) ?? "");
    if (method === "POST") return info(`Added ${ent.noun}`, String(body?.[ent.nameField] ?? ""));
    if (method === "PUT") return info(`Edited ${ent.noun}`, String(body?.[ent.nameField] ?? (await nameOf(a, id)) ?? ""));
    if (method === "DELETE") return info(`Deleted ${ent.noun}`, (await nameOf(a, id)) ?? "");
  }
  return info(`${method} ${seg.join("/")}`);
}
