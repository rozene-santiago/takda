// Many files at once: a .zip of PDFs (one per teacher, section or room) and
// calendar files for teachers.
import { zipSync } from "fflate";
import { buildIcs, type IcsClass } from "../../api/lib/ics";
import { saveFile, notify, hideNotice } from "./save-file";
import type { ScheduleEntry, Section, Subject, Room, Teacher, TimeSlot, Term } from "./types";

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "file";

function uniqueName(name: string, used: Set<string>): string {
  let n = name, i = 2;
  const dot = name.lastIndexOf(".");
  while (used.has(n.toLowerCase())) n = `${name.slice(0, dot)} (${i++})${name.slice(dot)}`;
  used.add(n.toLowerCase());
  return n;
}

/** Render each item to its own PDF and save them together as one .zip. */
export async function savePdfZip(zipName: string, items: { title: string; html: string }[], rowHeight?: number | null) {
  if (!items.length) { notify("There is nothing to save yet.", "error"); return; }
  const { htmlToPdfBlob, pdfName } = await import("./print-pdf");
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    notify(`Making PDFs… ${i + 1} of ${items.length}`, "info", true);
    const blob = await htmlToPdfBlob(items[i].title, items[i].html, rowHeight);
    if (blob) files[uniqueName(pdfName(items[i].title), used)] = new Uint8Array(await blob.arrayBuffer());
  }
  hideNotice();
  const zipped = zipSync(files, { level: 0 }); // PDFs are already compressed
  await saveFile(zipName, new Blob([zipped as BlobPart], { type: "application/zip" }));
}

export interface IcsData {
  entries: ScheduleEntry[];
  slotById: Map<number, TimeSlot>;
  subjMap: Map<number, Subject>;
  sectionMap: Map<number, Section>;
  roomMap: Map<number, Room>;
  term?: Term | null;
}

/** A teacher's weekly classes as a calendar file (repeats weekly through the term). */
export function teacherIcs(t: Teacher, d: IcsData): string {
  const classes: IcsClass[] = d.entries.filter((e) => e.teacherId === t.id).flatMap((e) => {
    const slot = d.slotById.get(e.timeSlotId);
    if (!slot) return [];
    const subj = d.subjMap.get(e.subjectId)?.name ?? "Class";
    const sec = d.sectionMap.get(e.sectionId)?.name ?? "";
    return [{ uid: `t${t.id}-e${e.id}`, day: e.dayOfWeek, start: slot.startTime, end: slot.endTime, title: sec ? `${subj} – ${sec}` : subj, location: e.roomId != null ? d.roomMap.get(e.roomId)?.name ?? null : null, description: slot.label }];
  });
  return buildIcs({ calendarName: `${t.name} – classes`, classes, startDate: d.term?.startDate, endDate: d.term?.endDate });
}

export function saveTeacherIcs(t: Teacher, d: IcsData) {
  return saveFile(`${safe(t.name)} - classes.ics`, new Blob([teacherIcs(t, d)], { type: "text/calendar" }));
}

export function saveAllIcs(teachers: Teacher[], d: IcsData) {
  const used = new Set<string>();
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const t of teachers) files[uniqueName(`${safe(t.name)}.ics`, used)] = enc.encode(teacherIcs(t, d));
  const zipped = zipSync(files, { level: 6 });
  return saveFile(`Teacher calendars ${new Date().toISOString().slice(0, 10)}.zip`, new Blob([zipped as BlobPart], { type: "application/zip" }));
}
