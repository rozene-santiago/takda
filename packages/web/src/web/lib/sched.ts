// Timetable helpers for the pages: which periods a grade uses (bell
// schedules), blocked cells, and sensible defaults for a new class.
import { slotApplies, slotUsedByGrade, sortSlots, toMinutes, slotsOverlap } from "../../api/lib/scheduler";
import type { BlockedTime, Room, ScheduleEntry, Section, Subject, Teacher, TeachingLoad, TimeSlot, Unavailability } from "./types";

export { slotApplies, slotUsedByGrade, sortSlots, toMinutes, slotsOverlap };

/** Periods a grade level uses on at least one day, in time order. */
export function gradeSlots(slots: TimeSlot[], gradeLevelId: number | null | undefined): TimeSlot[] {
  return sortSlots(slots.filter((s) => slotUsedByGrade(s, gradeLevelId)));
}

/** Periods used by any of the given grades (null = every period), in time order. */
export function slotsForGrades(slots: TimeSlot[], gradeIds: Iterable<number> | null, alsoIds: Iterable<number> = []): TimeSlot[] {
  if (gradeIds == null) return sortSlots(slots);
  const g = [...gradeIds];
  const extra = new Set(alsoIds);
  return sortSlots(slots.filter((s) => extra.has(s.id) || !s.gradeLevelIds?.length || g.some((id) => s.gradeLevelIds!.includes(id))));
}

/** Does the period run on this day for any of these grades (null = any grade)? */
export function slotRunsOn(slot: TimeSlot, day: number, gradeIds: number[] | null): boolean {
  if (slot.days?.length && !slot.days.includes(day)) return false;
  if (!gradeIds || !slot.gradeLevelIds?.length) return true;
  return gradeIds.some((g) => slot.gradeLevelIds!.includes(g));
}

/** Are there several bell schedules (periods limited to some grades)? */
export function hasBellSchedules(slots: TimeSlot[]): boolean {
  return slots.some((s) => (s.gradeLevelIds?.length ?? 0) > 0 || (s.days?.length ?? 0) > 0);
}

type Block = BlockedTime & { gradeLevelId?: number | null; sectionIds?: number[] | null };

/** Is this cell blocked for the section (all sections / its grade / it specifically)? */
export function isBlockedFor(blocked: BlockedTime[] | undefined, sectionId: number | null, gradeLevelId: number | null, day: number, slotId: number): Block | undefined {
  return (blocked as Block[] | undefined ?? []).find((b) => {
    if (b.dayOfWeek !== day || b.timeSlotId !== slotId) return false;
    if (b.sectionIds && b.sectionIds.length) return sectionId != null && b.sectionIds.includes(sectionId);
    if (b.gradeLevelId != null) return gradeLevelId === b.gradeLevelId;
    if (b.sectionId != null) return b.sectionId === sectionId;
    return true;
  });
}

/** A block for every section at this day and period. Teacher and room grids show only these,
 *  since a grade or section block doesn't stop the whole school. */
export function globalBlockAt(blocked: BlockedTime[] | undefined, day: number, slotId: number): Block | undefined {
  return (blocked as Block[] | undefined ?? []).find((b) => b.dayOfWeek === day && b.timeSlotId === slotId
    && !(b.sectionIds && b.sectionIds.length) && b.gradeLevelId == null && b.sectionId == null);
}

/** What a blocked cell says: its reason, or "Blocked" when none was given. */
export const blockLabel = (b: { reason?: string | null }) => b.reason?.trim() || "Blocked";

/** Is the teacher marked unavailable at a time overlapping this period? */
export function isUnavailable(unav: Unavailability[] | undefined, teacherId: number | null | undefined, day: number, slot: TimeSlot, slotById: Map<number, TimeSlot>): boolean {
  if (teacherId == null) return false;
  return (unav ?? []).some((u) => u.teacherId === teacherId && u.dayOfWeek === day && (u.timeSlotId === slot.id || (slotById.get(u.timeSlotId) && slotsOverlap(slotById.get(u.timeSlotId)!, slot))));
}

/** Teachers allowed to teach a subject in a grade (no subjects/grades set = anything). */
export function eligibleTeachers(teachers: Teacher[], subjectId: number | null, gradeLevelId: number | null): Teacher[] {
  return teachers.filter((t) =>
    (subjectId == null || t.subjectIds.length === 0 || t.subjectIds.includes(subjectId))
    && ((t.gradeLevelIds?.length ?? 0) === 0 || gradeLevelId == null || t.gradeLevelIds.includes(gradeLevelId)));
}

/** The teacher a new class should get: the teaching load, else whoever already teaches that subject to the section, else the first qualified teacher. */
export function defaultTeacher(args: { loads?: TeachingLoad[]; teachers: Teacher[]; entries?: ScheduleEntry[]; sectionId: number; subjectId: number; gradeLevelId: number | null }): number | null {
  const load = args.loads?.find((l) => l.sectionId === args.sectionId && l.subjectId === args.subjectId);
  if (load) return load.teacherId;
  const same = args.entries?.find((e) => e.sectionId === args.sectionId && e.subjectId === args.subjectId && e.teacherId != null);
  if (same) return same.teacherId;
  const qualified = eligibleTeachers(args.teachers, args.subjectId, args.gradeLevelId);
  return (qualified.find((t) => t.subjectIds.includes(args.subjectId)) ?? qualified[0])?.id ?? null;
}

/** The room a new class should get: the subject's own room (lab, gym…), else the section's homeroom. */
export function defaultRoom(args: { section?: Section; subject?: Subject; rooms: Room[] }): number | null {
  const own = args.subject?.roomIds?.find((id) => args.rooms.some((r) => r.id === id));
  if (own != null) return own;
  return args.section?.homeroomId ?? null;
}

export const fmtTime = (t: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return t ?? "";
  return `${Number(m[1])}:${m[2]}`;
};

/** Today's date as YYYY-MM-DD in local time. */
export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mon = 1 … Sun = 7 for a YYYY-MM-DD date. */
export function dayOfIso(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  return ((d.getDay() + 6) % 7) + 1;
}
