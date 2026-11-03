import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { ScheduleEntry, Subject, Teacher, Room, TimeSlot, Section } from "./hooks";

const DAY_FULL = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Optional uploaded print template: a single PDF page rendered to a PNG/JPEG data URI.
 *  When present it's laid down as a full-page (8.5x11) background and the schedule
 *  table is overlaid centered on top. When absent, the page prints plain. */
export type PrintTemplate = string | null | undefined;

function esc(s: string | undefined | null): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function readableText(hex?: string): string {
  if (!hex) return "#1A1A1A";
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1A1A1A" : "#ffffff";
}

/** Light pastel shade of a subject color for the printed cell fill. */
function pastel(hex?: string | null, mix = 0.72): string {
  const base = hex || "#9CA3AF";
  const h = base.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mr = Math.round(r + (255 - r) * mix);
  const mg = Math.round(g + (255 - g) * mix);
  const mb = Math.round(b + (255 - b) * mix);
  return `#${[mr, mg, mb].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin:0; padding:0; }
  body { font-family: -apple-system, system-ui, sans-serif; color:#1A1A1A; }
  .content { padding:0; }
  /* Each .page is a full 8.5x11 portrait sheet. With a template it carries the
     PDF page as a full-bleed background; the table is centered on top via flex. */
  .page {
    position: relative;
    box-sizing: border-box;
    width: 8.5in; height: 11in;
    padding: 0 1in;
    display: flex; flex-direction: column; justify-content: flex-start; align-items: center;
    background-size: 8.5in 11in; background-position: center; background-repeat: no-repeat;
    overflow: hidden;
  }
  .page + .page { page-break-before: always; }
  .page .sched-wrap { width:100%; }
  .ptitle { text-align:center; margin:0 0 10px; }
  .ptitle .phead { font-family:"Archivo", -apple-system, system-ui, sans-serif; font-size:15px; font-weight:800; color:#1e3d32; letter-spacing:.02em; line-height:1.25; white-space:pre-line; }
  .ptitle .psub { font-family:"Archivo", -apple-system, system-ui, sans-serif; font-size:12px; font-weight:700; color:#007041; margin-top:2px; letter-spacing:.03em; text-transform:uppercase; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  th { background:#007041; color:#fff; font-size:10px; text-transform:uppercase; padding:6px 4px; border:1px solid #000; }
  th.time, td.time { width:74px; }
  td { border:1px solid #000; padding:0; vertical-align:top; height:34px; }
  td.time { background:#f3f6f4; padding:8px 5px; vertical-align:middle; }
  td.time .lbl { font-weight:700; font-size:10px; }
  td.time .rng { font-size:8px; color:#666; }
  td.time.emph { text-align:center; padding:8px 2px; }
  td.time.emph .rng-big { font-weight:800; font-size:11px; color:#1A1A1A; white-space:nowrap; }
  td.cell { padding:7px 5px; }
  td.cell .subj { font-weight:700; font-size:10px; line-height:1.2; }
  td.cell .meta { font-size:8px; opacity:.9; }
  td.brk { background:#eef0ee; color:#888; font-style:italic; text-align:center; font-size:9px; vertical-align:middle; }
  td.empty { background:rgba(255,255,255,0.92); }
  /* Zero page margin so the template background fills the sheet edge-to-edge;
     the inner .page padding (0.5in) keeps the table off the edges. */
  @page { size: 8.5in 11in portrait; margin: 0; }
`;

/** CSS override that bumps printed row height. `rowHeight` is in pixels;
 *  null/undefined keeps the default (34px). */
function rowHeightCss(rowHeight?: number | null): string {
  if (typeof rowHeight !== "number" || Number.isNaN(rowHeight) || rowHeight <= 0) return "";
  return `td { height: ${Math.round(rowHeight)}px; }`;
}

function wrap(title: string, body: string, rowHeight?: number | null): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}${rowHeightCss(rowHeight)}</style></head><body>
    <div class="content">
      ${body}
    </div>
  </body></html>`;
}

/** Centered title block printed above the timetable:
 *  optional custom heading (large) + a sub-line (e.g. "Grade 7 - 7A" or a teacher name). */
function titleBlock(heading?: string | null, subLine?: string | null): string {
  if (!heading && !subLine) return "";
  return `<div class="ptitle">${heading ? `<div class="phead">${esc(heading)}</div>` : ""}${subLine ? `<div class="psub">${esc(subLine)}</div>` : ""}</div>`;
}

/** Wrap schedule HTML into a full-page sheet, optionally with the template background
 *  and a centered title block (heading + sub-line) above the timetable. */
function pageHtml(inner: string, template: PrintTemplate, heading?: string | null, subLine?: string | null, offset?: number | null): string {
  const styles: string[] = [];
  if (template) styles.push(`background-image:url('${template}')`);
  const off = typeof offset === "number" && !Number.isNaN(offset) ? offset : 0;
  const wrapStyle = off !== 0 ? ` style="margin-top:${off}in"` : "";
  const just = off !== 0 ? ` style="${styles.join(";")};justify-content:flex-start"` : (styles.length ? ` style="${styles.join(";")}"` : "");
  return `<div class="page"${just}><div class="sched-wrap"${wrapStyle}>${titleBlock(heading, subLine)}${inner}</div></div>`;
}

export type TimeStyle = "default" | "emphasizeTime";

function timeCell(slot: TimeSlot, style: TimeStyle): string {
  const range = `${esc(slot.startTime)}–${esc(slot.endTime)}`;
  if (style === "emphasizeTime") {
    return `<td class="time emph"><div class="rng-big">${range}</div></td>`;
  }
  return `<td class="time"><div class="lbl">${esc(slot.label)}</div><div class="rng">${range}</div></td>`;
}

interface GridArgs {
  days: number[];
  slots: TimeSlot[];
  entryAt: (day: number, slotId: number) => ScheduleEntry | undefined;
  subjMap: Map<number, Subject>;
  metaLines: (e: ScheduleEntry) => string[];
  timeStyle?: TimeStyle;
}

function grid({ days, slots, entryAt, subjMap, metaLines, timeStyle = "default" }: GridArgs): string {
  const head = `<tr><th class="time">Time</th>${days.map((d) => `<th>${DAY_FULL[d] ?? ""}</th>`).join("")}</tr>`;
  const rows = slots.map((slot) => {
    const cells = days.map((day) => {
      if (slot.isBreak) return `<td class="brk">${esc(slot.label)}</td>`;
      const e = entryAt(day, slot.id);
      if (!e) return `<td class="empty"></td>`;
      const subj = subjMap.get(e.subjectId);
      const bg = pastel(subj?.color);
      const fg = "#1A1A1A";
      const metas = metaLines(e).filter(Boolean).map((m) => `<div class="meta">${esc(m)}</div>`).join("");
      return `<td class="cell" style="background:${bg};color:${fg}"><div class="subj">${esc(subj?.name ?? "?")}</div>${metas}</td>`;
    }).join("");
    return `<tr>${timeCell(slot, timeStyle)}${cells}</tr>`;
  }).join("");
  return `<table>${head}${rows}</table>`;
}

async function output(html: string) {
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share / Print schedule", UTI: "com.adobe.pdf" });
  } else {
    await Print.printAsync({ uri });
  }
}

/** Build the centered sub-line for a section: "Grade 7 - 7A" (or just the section name). */
function sectionLine(section: Section, gradeName?: string): string {
  return gradeName ? `${gradeName} - ${section.name}` : section.name;
}

export async function printSectionSchedule(args: {
  section: Section; gradeName?: string; days: number[]; slots: TimeSlot[]; entries: ScheduleEntry[];
  subjMap: Map<number, Subject>; teacherMap: Map<number, Teacher>; roomMap: Map<number, Room>; timeStyle?: TimeStyle;
  template?: PrintTemplate; heading?: string | null; offset?: number | null; rowHeight?: number | null;
}) {
  const entryAt = (day: number, slotId: number) =>
    args.entries.find((e) => e.sectionId === args.section.id && e.dayOfWeek === day && e.timeSlotId === slotId);
  const table = grid({ days: args.days, slots: args.slots, entryAt, subjMap: args.subjMap, timeStyle: args.timeStyle,
    metaLines: (e) => [e.teacherId != null ? args.teacherMap.get(e.teacherId)?.name ?? "" : "", e.roomId != null ? args.roomMap.get(e.roomId)?.name ?? "" : ""] });
  await output(wrap(args.section.name, pageHtml(table, args.template, args.heading, sectionLine(args.section, args.gradeName), args.offset), args.rowHeight));
}

export async function printAllSections(args: {
  sections: Section[]; gradeNameFor?: (s: Section) => string | undefined; days: number[]; slots: TimeSlot[];
  entries: ScheduleEntry[]; subjMap: Map<number, Subject>; teacherMap: Map<number, Teacher>; roomMap: Map<number, Room>; timeStyle?: TimeStyle;
  template?: PrintTemplate; heading?: string | null; offset?: number | null; rowHeight?: number | null;
}) {
  const body = args.sections.map((section) => {
    const entryAt = (day: number, slotId: number) =>
      args.entries.find((e) => e.sectionId === section.id && e.dayOfWeek === day && e.timeSlotId === slotId);
    const table = grid({ days: args.days, slots: args.slots, entryAt, subjMap: args.subjMap, timeStyle: args.timeStyle,
      metaLines: (e) => [e.teacherId != null ? args.teacherMap.get(e.teacherId)?.name ?? "" : "", e.roomId != null ? args.roomMap.get(e.roomId)?.name ?? "" : ""] });
    return pageHtml(table, args.template, args.heading, sectionLine(section, args.gradeNameFor?.(section)), args.offset);
  }).join("");
  await output(wrap("All sections", body, args.rowHeight));
}

export async function printTeacherSchedule(args: {
  teacher: Teacher; days: number[]; slots: TimeSlot[]; entries: ScheduleEntry[];
  subjMap: Map<number, Subject>; sectionMap: Map<number, Section>; roomMap: Map<number, Room>; timeStyle?: TimeStyle;
  template?: PrintTemplate; heading?: string | null; offset?: number | null; rowHeight?: number | null;
}) {
  const entryAt = (day: number, slotId: number) =>
    args.entries.find((e) => e.teacherId === args.teacher.id && e.dayOfWeek === day && e.timeSlotId === slotId);
  const table = grid({ days: args.days, slots: args.slots, entryAt, subjMap: args.subjMap, timeStyle: args.timeStyle,
    metaLines: (e) => [args.sectionMap.get(e.sectionId)?.name ?? "", e.roomId != null ? args.roomMap.get(e.roomId)?.name ?? "" : ""] });
  await output(wrap(`${args.teacher.name} (Teacher)`, pageHtml(table, args.template, args.heading, args.teacher.name, args.offset), args.rowHeight));
}

export async function printAllTeachers(args: {
  teachers: Teacher[]; days: number[]; slots: TimeSlot[]; entries: ScheduleEntry[];
  subjMap: Map<number, Subject>; sectionMap: Map<number, Section>; roomMap: Map<number, Room>; timeStyle?: TimeStyle;
  template?: PrintTemplate; heading?: string | null; offset?: number | null; rowHeight?: number | null;
}) {
  const body = args.teachers.map((teacher) => {
    const entryAt = (day: number, slotId: number) =>
      args.entries.find((e) => e.teacherId === teacher.id && e.dayOfWeek === day && e.timeSlotId === slotId);
    const table = grid({ days: args.days, slots: args.slots, entryAt, subjMap: args.subjMap, timeStyle: args.timeStyle,
      metaLines: (e) => [args.sectionMap.get(e.sectionId)?.name ?? "", e.roomId != null ? args.roomMap.get(e.roomId)?.name ?? "" : ""] });
    return pageHtml(table, args.template, args.heading, teacher.name, args.offset);
  }).join("");
  await output(wrap("All teachers", body, args.rowHeight));
}
