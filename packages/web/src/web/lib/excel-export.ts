import * as XLSX from "xlsx";
import { DAY_FULL, DAY_SHORT } from "./types";
import { saveFile } from "./save-file";
import type { ScheduleEntry, Subject, Teacher, Room, TimeSlot, Section } from "./types";
import { gradeSlots, slotApplies, slotRunsOn, sortSlots } from "./sched";
import { teacherSlots } from "./print";

interface Maps {
  subjMap: Map<number, Subject>;
  teacherMap: Map<number, Teacher>;
  roomMap: Map<number, Room>;
  sectionMap: Map<number, Section>;
}

// Excel sheet names: max 31 chars, no : \ / ? * [ ]
function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "Sheet";
  let n = base;
  let i = 2;
  while (used.has(n.toLowerCase())) {
    n = `${base.slice(0, 28 - String(i).length - 1)} ${i}`;
    i++;
  }
  used.add(n.toLowerCase());
  return n;
}

function cellText(parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join("\n");
}

/** Build a sheet (AoA) for one timetable. cellFor returns the multi-line text for a day/slot. */
function buildSheet(
  title: string,
  days: number[],
  slots: TimeSlot[],
  cellFor: (day: number, slot: TimeSlot) => string,
): XLSX.WorkSheet {
  const rows: (string)[][] = [];
  rows.push([title]);
  rows.push([]);
  rows.push(["Time", ...days.map((d) => DAY_FULL[d] ?? DAY_SHORT[d])]);
  for (const slot of slots) {
    const timeLabel = slot.startTime && slot.endTime ? `${slot.label}\n${slot.startTime}–${slot.endTime}` : slot.label;
    if (slot.isBreak) {
      rows.push([timeLabel, ...days.map(() => slot.label || "Break")]);
    } else {
      rows.push([timeLabel, ...days.map((d) => cellFor(d, slot))]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // column widths
  ws["!cols"] = [{ wch: 16 }, ...days.map(() => ({ wch: 22 }))];
  // row heights (taller for content rows)
  ws["!rows"] = rows.map((_, i) => ({ hpt: i < 3 ? 18 : 42 }));
  // merge the title across all columns
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: days.length } }];
  return ws;
}

export function exportScheduleWorkbook(args: {
  sections: Section[];
  teachers: Teacher[];
  days: number[];
  slots: TimeSlot[];
  entries: ScheduleEntry[];
  gradeNameFor?: (s: Section) => string | undefined;
  maps: Maps;
  fileName?: string;
}) {
  const { sections, teachers, days, slots, entries, gradeNameFor, maps } = args;
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  // --- Section sheets ---
  for (const section of sections) {
    const gn = gradeNameFor?.(section);
    const title = `Section: ${section.name}${gn ? ` — ${gn}` : ""}${section.adviser ? `  (Adviser: ${section.adviser})` : ""}`;
    const cellFor = (day: number, slot: TimeSlot) => {
      if (!slotApplies(slot, section.gradeLevelId, day)) return "—";
      const e = entries.find((x) => x.sectionId === section.id && x.dayOfWeek === day && x.timeSlotId === slot.id);
      if (!e) return "";
      const subj = maps.subjMap.get(e.subjectId);
      const t = e.teacherId != null ? maps.teacherMap.get(e.teacherId) : undefined;
      const r = e.roomId != null ? maps.roomMap.get(e.roomId) : undefined;
      return cellText([subj?.name ?? "?", t?.name, r?.name ? `Room: ${r.name}` : undefined]);
    };
    const ws = buildSheet(title, days, gradeSlots(slots, section.gradeLevelId), cellFor);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(section.name, used));
  }

  // separator marker between sections and teachers is implicit by sheet grouping;
  // teacher sheets get a "T - " prefix to disambiguate from same-named sections.
  // --- Teacher sheets ---
  for (const teacher of teachers) {
    const title = `Teacher: ${teacher.name}${teacher.email ? `  (${teacher.email})` : ""}`;
    const tGrades = (teacher.gradeLevelIds?.length ?? 0) ? teacher.gradeLevelIds : null;
    const cellFor = (day: number, slot: TimeSlot) => {
      const e = entries.find((x) => x.teacherId === teacher.id && x.dayOfWeek === day && x.timeSlotId === slot.id);
      if (!e) return slotRunsOn(slot, day, tGrades) ? "" : "—";
      const subj = maps.subjMap.get(e.subjectId);
      const sec = maps.sectionMap.get(e.sectionId);
      const r = e.roomId != null ? maps.roomMap.get(e.roomId) : undefined;
      return cellText([subj?.name ?? "?", sec?.name ? `Sec: ${sec.name}` : undefined, r?.name ? `Room: ${r.name}` : undefined]);
    };
    const ws = buildSheet(title, days, teacherSlots(teacher, slots, entries, maps.sectionMap), cellFor);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`T - ${teacher.name}`, used));
  }

  const fname = args.fileName ?? `Class-Schedule-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return saveFile(fname, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

// ---------------- more workbooks ----------------

type Row = (string | number | null)[];

function sheet(rows: Row[], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}

function save(wb: XLSX.WorkBook, name: string) {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return saveFile(name, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

const today = () => new Date().toISOString().slice(0, 10);

/** Every teacher in one sheet: a row per teacher, a column per day and period. */
export function exportMasterMatrix(args: { teachers: Teacher[]; days: number[]; slots: TimeSlot[]; entries: ScheduleEntry[]; maps: Maps }) {
  const slots = sortSlots(args.slots).filter((s) => !s.isBreak);
  const cols = args.days.flatMap((d) => slots.filter((s) => !s.days?.length || s.days.includes(d)).map((s) => ({ d, s })));
  const head: Row = ["Teacher", ...cols.map(({ d, s }) => `${DAY_SHORT[d]} ${s.label}\n${s.startTime}–${s.endTime}`), "Periods / week", "Max load"];
  const rows: Row[] = [head];
  for (const t of args.teachers) {
    const mine = args.entries.filter((e) => e.teacherId === t.id);
    rows.push([
      t.name,
      ...cols.map(({ d, s }) => {
        const e = mine.find((x) => x.dayOfWeek === d && x.timeSlotId === s.id);
        if (!e) return "";
        const subj = args.maps.subjMap.get(e.subjectId);
        const sec = args.maps.sectionMap.get(e.sectionId)?.name;
        const room = e.roomId != null ? args.maps.roomMap.get(e.roomId)?.name : undefined;
        return [subj?.code || subj?.name, sec, room].filter(Boolean).join(" · ");
      }),
      mine.length,
      t.maxLoad ?? "",
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = sheet(rows, [24, ...cols.map(() => 16), 14, 10]);
  ws["!freeze"] = { xSplit: 1, ySplit: 1 } as any;
  XLSX.utils.book_append_sheet(wb, ws, "Master matrix");
  return save(wb, `Teacher master matrix ${today()}.xlsx`);
}

export interface ReportData {
  teacherLoads: { name: string; periods: number; maxLoad: number | null; perDay: number[]; maxPerDay: number | null; subjects: string; sections: string; subs: number }[];
  days: number[];
  allocation: { section: string; grade: string; required: number; scheduled: number; issues: string }[];
  rooms: { name: string; capacity: number | null; used: number; available: number }[];
  conflicts: { severity: string; message: string }[];
}

export function exportReportsWorkbook(r: ReportData) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Teacher", "Periods / week", "Max load", ...r.days.map((d) => DAY_SHORT[d]), "Max / day", "Subjects", "Sections", "Subs covered (30 days)"],
    ...r.teacherLoads.map((t) => [t.name, t.periods, t.maxLoad ?? "", ...t.perDay, t.maxPerDay ?? "", t.subjects, t.sections, t.subs]),
  ], [24, 13, 10, ...r.days.map(() => 6), 10, 30, 30, 12]), "Teacher loads");
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Section", "Grade", "Periods required", "Periods scheduled", "Issues"],
    ...r.allocation.map((a) => [a.section, a.grade, a.required, a.scheduled, a.issues]),
  ], [18, 12, 16, 16, 60]), "Allocation check");
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Room", "Capacity", "Periods used", "Periods available", "Use %"],
    ...r.rooms.map((x) => [x.name, x.capacity ?? "", x.used, x.available, x.available ? Math.round((x.used / x.available) * 100) : 0]),
  ], [20, 10, 13, 16, 8]), "Room usage");
  XLSX.utils.book_append_sheet(wb, sheet([
    ["Severity", "Issue"],
    ...r.conflicts.map((c) => [c.severity, c.message]),
  ], [10, 100]), "Conflicts");
  return save(wb, `Scheduler reports ${today()}.xlsx`);
}

/** The setup as sheets whose columns match the CSV imports (save a sheet as CSV to re-import it). */
export function exportSetupWorkbook(d: {
  grades: { id: number; name: string }[];
  sections: Section[];
  subjects: Subject[];
  teachers: Teacher[];
  rooms: Room[];
  slots: TimeSlot[];
  allocations: { gradeLevelId: number; subjectId: number; periodsPerWeek: number; blockSize: number; maxPerDay: number | null }[];
  loads: { sectionId: number; subjectId: number; teacherId: number }[];
}) {
  const g = (id: number | null | undefined) => d.grades.find((x) => x.id === id)?.name ?? "";
  const subj = (id: number) => d.subjects.find((x) => x.id === id);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([["Grade level"], ...d.grades.map((x) => [x.name])], [20]), "Grade levels");
  XLSX.utils.book_append_sheet(wb, sheet([["Section", "Grade level", "Students", "Homeroom", "Adviser"],
    ...d.sections.map((s) => [s.name, g(s.gradeLevelId), s.studentCount ?? "", d.rooms.find((r) => r.id === s.homeroomId)?.name ?? "", s.adviser ?? ""])], [18, 14, 10, 16, 24]), "Sections");
  XLSX.utils.book_append_sheet(wb, sheet([["Subject", "Code"], ...d.subjects.map((s) => [s.name, s.code ?? ""])], [26, 10]), "Subjects");
  XLSX.utils.book_append_sheet(wb, sheet([["Room", "Capacity"], ...d.rooms.map((r) => [r.name, r.capacity ?? ""])], [20, 10]), "Rooms");
  XLSX.utils.book_append_sheet(wb, sheet([["Label", "Start", "End", "Order", "Break", "Grade levels"],
    ...sortSlots(d.slots).map((s) => [s.label, s.startTime, s.endTime, s.sortOrder, s.isBreak ? "yes" : "", (s.gradeLevelIds ?? []).map(g).join("; ")])], [14, 8, 8, 7, 7, 30]), "Periods");
  XLSX.utils.book_append_sheet(wb, sheet([["Teacher", "Email", "Subjects", "Grade levels", "Max periods / week", "Max periods / day"],
    ...d.teachers.map((t) => [t.name, t.email ?? "", t.subjectIds.map((id) => subj(id)?.name ?? "").filter(Boolean).join("; "), (t.gradeLevelIds ?? []).map(g).join("; "), t.maxLoad ?? "", t.maxPerDay ?? ""])], [24, 26, 40, 24, 16, 16]), "Teachers");
  XLSX.utils.book_append_sheet(wb, sheet([["Grade level", "Subject", "Periods / week", "Block size", "Max / day"],
    ...d.allocations.filter((a) => a.periodsPerWeek > 0).map((a) => [g(a.gradeLevelId), subj(a.subjectId)?.name ?? "", a.periodsPerWeek, a.blockSize ?? 1, a.maxPerDay ?? ""])], [14, 26, 14, 10, 10]), "Allocations");
  XLSX.utils.book_append_sheet(wb, sheet([["Section", "Subject", "Teacher", "Grade level"],
    ...d.loads.map((l) => { const s = d.sections.find((x) => x.id === l.sectionId); return [s?.name ?? "", subj(l.subjectId)?.name ?? "", d.teachers.find((t) => t.id === l.teacherId)?.name ?? "", g(s?.gradeLevelId)]; })], [18, 26, 24, 14]), "Teaching loads");
  return save(wb, `Scheduler setup ${today()}.xlsx`);
}
