// Printable timetables (sections, teachers, rooms) and substitution sheets.
// The same HTML goes to the browser's print dialog or, inside the Claude
// viewer, through print-pdf.ts to a PDF file.
import { DAY_FULL, DAY_SHORT } from "./types";
import type { BlockedTime, ScheduleEntry, Subject, Teacher, Room, TimeSlot, Section } from "./types";
import { inClaudeViewer, notify } from "./save-file";
import { blockLabel, globalBlockAt, gradeSlots, isBlockedFor, slotApplies, slotRunsOn, slotsForGrades, sortSlots } from "./sched";

/** Optional uploaded print template: a single PDF page rendered to a PNG/JPEG data URI.
 *  When present it's laid down as a full-page (8.5x11) background and the schedule
 *  table is overlaid centered on top. When absent, the page prints plain. */
export type PrintTemplate = string | null | undefined;

/** Time-column display style for printing.
 *  - "default": period label (bold) + small time range underneath (original format)
 *  - "emphasizeTime": no period name, time range shown big & bold */
export type TimeStyle = "default" | "emphasizeTime";

export interface PrintOpts {
  timeStyle?: TimeStyle;
  template?: PrintTemplate;
  heading?: string | null;
  offset?: number | null;
  rowHeight?: number | null;
}

export interface Lookups {
  subjMap: Map<number, Subject>;
  teacherMap: Map<number, Teacher>;
  sectionMap: Map<number, Section>;
  roomMap: Map<number, Room>;
}

export function esc(s: string | undefined | null): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Light pastel shade of a subject color for the printed cell fill. */
function pastel(hex?: string | null, mix = 0.72): string {
  const base = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : "#9CA3AF";
  const h = base.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mr = Math.round(r + (255 - r) * mix);
  const mg = Math.round(g + (255 - g) * mix);
  const mb = Math.round(b + (255 - b) * mix);
  return `#${[mr, mg, mb].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function timeCell(slot: TimeSlot, style: TimeStyle): string {
  const range = `${esc(slot.startTime)}–${esc(slot.endTime)}`;
  if (style === "emphasizeTime") return `<td class="time emph"><div class="rng-big">${range}</div></td>`;
  return `<td class="time"><div class="lbl">${esc(slot.label)}</div><div class="rng">${range}</div></td>`;
}

export type PrintCell =
  | { kind: "class"; color: string | null | undefined; title: string; lines: (string | null | undefined)[] }
  | { kind: "empty" }
  | { kind: "na"; label?: string }
  | { kind: "break"; label: string }
  | { kind: "blocked"; label: string };

/** A weekly timetable table: one row per period, one column per day. */
export function timetableHtml(days: number[], slots: TimeSlot[], cell: (day: number, slot: TimeSlot) => PrintCell, timeStyle: TimeStyle = "default"): string {
  const head = `<tr><th class="time">Time</th>${days.map((d) => `<th>${DAY_FULL[d] ?? DAY_SHORT[d]}</th>`).join("")}</tr>`;
  const rows = slots.map((slot) => {
    const cells = days.map((day) => {
      const c = cell(day, slot);
      if (c.kind === "break") return `<td class="brk">${esc(c.label)}</td>`;
      if (c.kind === "blocked") return `<td class="blk"><div class="blk-lbl">${esc(c.label)}</div></td>`;
      if (c.kind === "na") return `<td class="na">${c.label ? esc(c.label) : ""}</td>`;
      if (c.kind === "empty") return `<td class="empty"></td>`;
      const lines = c.lines.filter(Boolean).map((l) => `<div class="meta">${esc(l)}</div>`).join("");
      return `<td class="cell" style="background:${pastel(c.color)};color:#1A1A1A"><div class="subj">${esc(c.title)}</div>${lines}</td>`;
    }).join("");
    return `<tr>${timeCell(slot, timeStyle)}${cells}</tr>`;
  }).join("");
  return `<table class="grid">${head}${rows}</table>`;
}

/** A plain list table (first column narrow, like the time column). */
export function listTableHtml(headers: string[], rows: { first: string; firstSub?: string; cells: (string | { bold: string; sub?: string })[] }[]): string {
  const head = `<tr><th class="time">${esc(headers[0])}</th>${headers.slice(1).map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr><td class="time"><div class="lbl">${esc(r.first)}</div>${r.firstSub ? `<div class="rng">${esc(r.firstSub)}</div>` : ""}</td>${r.cells.map((c) =>
    typeof c === "string"
      ? `<td class="cell" style="background:#ffffff;color:#1A1A1A"><div class="meta">${esc(c)}</div></td>`
      : `<td class="cell" style="background:#ffffff;color:#1A1A1A"><div class="subj">${esc(c.bold)}</div>${c.sub ? `<div class="meta">${esc(c.sub)}</div>` : ""}</td>`).join("")}</tr>`).join("");
  return `<table class="grid">${head}${body}</table>`;
}

const PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #1A1A1A; }
  .page {
    position: relative; box-sizing: border-box; width: 8.5in; height: 11in; padding: 0 1in;
    display: flex; flex-direction: column; justify-content: flex-start; align-items: center;
    background-size: 8.5in 11in; background-position: center; background-repeat: no-repeat; overflow: hidden;
  }
  .page + .page { page-break-before: always; }
  .page .sched-wrap { width: 100%; }
  .ptitle { text-align: center; margin: 0 0 10px; }
  .ptitle .phead { font-family: "Archivo", -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 15px; font-weight: 800; color: #1e3d32; letter-spacing: .02em; line-height: 1.25; white-space: pre-line; }
  .ptitle .psub { font-family: "Archivo", -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 12px; font-weight: 700; color: #007041; margin-top: 2px; letter-spacing: .03em; text-transform: uppercase; }
  .grid { width:100%; border-collapse: collapse; table-layout: fixed; }
  .grid th { background:#007041; color:#fff; font-size: 10px; text-transform:uppercase; letter-spacing:.03em; padding:6px 4px; border:1px solid #000; }
  .grid th.time, .grid td.time { width: 74px; }
  .grid td { border:1px solid #000; padding:0; vertical-align: top; height: 34px; }
  .grid td.time { background:#f3f6f4; padding:8px 4px; vertical-align: middle; }
  .grid td.time .lbl { font-weight:700; font-size:10px; }
  .grid td.time .rng { font-size:8px; color:#666; }
  .grid td.time.emph { text-align:center; padding:8px 2px; }
  .grid td.time.emph .rng-big { font-weight:800; font-size:11px; color:#1A1A1A; letter-spacing:.01em; white-space:nowrap; }
  .grid td.cell { padding:7px 5px; }
  .grid td.cell .subj { font-weight:700; font-size:10px; line-height:1.15; }
  .grid td.cell .meta { font-size:8px; opacity:.9; }
  .grid td.brk { background:#eef0ee; color:#888; font-style:italic; text-align:center; font-size:9px; vertical-align: middle; }
  .grid td.blk { background:#f1ede3; color:#4a4536; text-align:center; vertical-align: middle; padding:6px 4px; }
  .grid td.blk .blk-lbl { font-weight:700; font-size:9px; line-height:1.2; }
  .grid td.na { background:#e4e6e3; color:#888; font-style:italic; text-align:center; font-size:8px; vertical-align: middle; }
  .grid td.empty { background:rgba(255,255,255,0.92); }
  @page { size: 8.5in 11in portrait; margin: 0; }
`;

function titleBlock(heading?: string | null, subLine?: string | null): string {
  if (!heading && !subLine) return "";
  return `<div class="ptitle">${heading ? `<div class="phead">${esc(heading)}</div>` : ""}${subLine ? `<div class="psub">${esc(subLine)}</div>` : ""}</div>`;
}

/** One 8.5x11 sheet: optional template background, title block and the table. */
export function pageHtml(inner: string, opts: PrintOpts, subLine?: string | null): string {
  const heading = opts.heading;
  const styles: string[] = [];
  if (opts.template) styles.push(`background-image:url('${opts.template}')`);
  const off = typeof opts.offset === "number" && !Number.isNaN(opts.offset) ? opts.offset : 0;
  const wrapStyle = off !== 0 ? ` style="margin-top:${off}in"` : "";
  const just = off !== 0 ? ` style="${styles.join(";")};justify-content:flex-start"` : (styles.length ? ` style="${styles.join(";")}"` : "");
  return `<div class="page"${just}><div class="sched-wrap"${wrapStyle}>${titleBlock(heading, subLine)}${inner}</div></div>`;
}

function rowHeightCss(rowHeight?: number | null): string {
  if (typeof rowHeight !== "number" || Number.isNaN(rowHeight) || rowHeight <= 0) return "";
  return `.grid td { height: ${Math.round(rowHeight)}px; }`;
}

/** Send sheets to the printer (or, in the Claude viewer, to a PDF file). */
export function openAndPrint(title: string, bodyHtml: string, rowHeight?: number | null) {
  if (inClaudeViewer()) {
    notify("Preparing PDF…", "info", true);
    import("./print-pdf")
      .then((m) => m.printHtmlToPdf(title, bodyHtml, rowHeight))
      .catch((e) => notify(`Could not build the PDF: ${e?.message ?? e}`, "error"));
    return;
  }
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) { notify("Please allow pop-ups to print the schedule.", "error"); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}${rowHeightCss(rowHeight)}</style></head>
    <body><div class="content">${bodyHtml}</div></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 350);
}

// ---------------- sheets ----------------

interface Common extends PrintOpts {
  days: number[];
  slots: TimeSlot[];
  entries: ScheduleEntry[];
  maps: Lookups;
  /** Blocked times; their labels are printed in the cells they block. */
  blocked?: BlockedTime[];
}

export function sectionLine(section: Section, gradeName?: string): string {
  return gradeName ? `${gradeName} - ${section.name}` : section.name;
}

/** Table for one section: only its grade's periods; periods that don't run that day are greyed. */
export function sectionTable(section: Section, a: Common): string {
  const slots = gradeSlots(a.slots, section.gradeLevelId);
  return timetableHtml(a.days, slots, (day, slot) => {
    if (slot.isBreak) return { kind: "break", label: slot.label };
    if (!slotApplies(slot, section.gradeLevelId, day)) return { kind: "na" };
    const e = a.entries.find((x) => x.sectionId === section.id && x.dayOfWeek === day && x.timeSlotId === slot.id);
    if (!e) {
      const b = isBlockedFor(a.blocked, section.id, section.gradeLevelId, day, slot.id);
      return b ? { kind: "blocked", label: blockLabel(b) } : { kind: "empty" };
    }
    const subj = a.maps.subjMap.get(e.subjectId);
    return { kind: "class", color: subj?.color, title: subj?.name ?? "?", lines: [e.teacherId != null ? a.maps.teacherMap.get(e.teacherId)?.name : null, e.roomId != null ? a.maps.roomMap.get(e.roomId)?.name : null] };
  }, a.timeStyle);
}

/** Periods relevant to a teacher: the grades they teach plus any period they have a class in. */
export function teacherSlots(teacher: Teacher, slots: TimeSlot[], entries: ScheduleEntry[], sectionMap: Map<number, Section>): TimeSlot[] {
  const mine = entries.filter((e) => e.teacherId === teacher.id);
  const grades = new Set<number>(teacher.gradeLevelIds ?? []);
  mine.forEach((e) => { const g = sectionMap.get(e.sectionId)?.gradeLevelId; if (g != null) grades.add(g); });
  return slotsForGrades(slots, (teacher.gradeLevelIds?.length ?? 0) === 0 ? null : grades, mine.map((e) => e.timeSlotId));
}

export function teacherTable(teacher: Teacher, a: Common): string {
  const slots = teacherSlots(teacher, a.slots, a.entries, a.maps.sectionMap);
  const gradeIds = (teacher.gradeLevelIds?.length ?? 0) ? teacher.gradeLevelIds : null;
  return timetableHtml(a.days, slots, (day, slot) => {
    const e = a.entries.find((x) => x.teacherId === teacher.id && x.dayOfWeek === day && x.timeSlotId === slot.id);
    if (!e) {
      if (slot.isBreak) return { kind: "break", label: slot.label };
      if (!slotRunsOn(slot, day, gradeIds)) return { kind: "na" };
      const b = globalBlockAt(a.blocked, day, slot.id);
      return b ? { kind: "blocked", label: blockLabel(b) } : { kind: "empty" };
    }
    const subj = a.maps.subjMap.get(e.subjectId);
    return { kind: "class", color: subj?.color, title: subj?.name ?? "?", lines: [a.maps.sectionMap.get(e.sectionId)?.name, e.roomId != null ? a.maps.roomMap.get(e.roomId)?.name : null] };
  }, a.timeStyle);
}

/** Periods relevant to a room: those used by the classes in it and by its homeroom sections' grades. */
export function roomSlots(room: Room, slots: TimeSlot[], entries: ScheduleEntry[], sectionMap: Map<number, Section>): TimeSlot[] {
  const mine = entries.filter((e) => e.roomId === room.id);
  const grades = new Set<number>();
  mine.forEach((e) => { const g = sectionMap.get(e.sectionId)?.gradeLevelId; if (g != null) grades.add(g); });
  sectionMap.forEach((s) => { if (s.homeroomId === room.id) grades.add(s.gradeLevelId); });
  if (!grades.size) return sortSlots(slots);
  return slotsForGrades(slots, grades, mine.map((e) => e.timeSlotId));
}

export function roomTable(room: Room, a: Common): string {
  const slots = roomSlots(room, a.slots, a.entries, a.maps.sectionMap);
  return timetableHtml(a.days, slots, (day, slot) => {
    const list = a.entries.filter((x) => x.roomId === room.id && x.dayOfWeek === day && x.timeSlotId === slot.id);
    if (!list.length) {
      if (slot.isBreak) return { kind: "break", label: slot.label };
      if (slot.days?.length && !slot.days.includes(day)) return { kind: "na" };
      const b = globalBlockAt(a.blocked, day, slot.id);
      return b ? { kind: "blocked", label: blockLabel(b) } : { kind: "empty" };
    }
    const e = list[0];
    const subj = a.maps.subjMap.get(e.subjectId);
    const sections = list.map((x) => a.maps.sectionMap.get(x.sectionId)?.name).filter(Boolean).join(", ");
    return { kind: "class", color: subj?.color, title: subj?.name ?? "?", lines: [sections, e.teacherId != null ? a.maps.teacherMap.get(e.teacherId)?.name : null] };
  }, a.timeStyle);
}

export function printSections(sections: Section[], a: Common & { gradeName: (gid: number) => string | undefined }, title = sections.length === 1 ? sections[0].name : "All sections") {
  const pages = sections.map((s) => pageHtml(sectionTable(s, a), a, sectionLine(s, a.gradeName(s.gradeLevelId)))).join("");
  openAndPrint(title, pages, a.rowHeight);
}

export function printTeachers(teachers: Teacher[], a: Common, title = teachers.length === 1 ? `${teachers[0].name} (Teacher)` : "All teachers") {
  const pages = teachers.map((t) => pageHtml(teacherTable(t, a), a, t.name)).join("");
  openAndPrint(title, pages, a.rowHeight);
}

export function printRooms(rooms: Room[], a: Common, title = rooms.length === 1 ? `${rooms[0].name} (Room)` : "All rooms") {
  const pages = rooms.map((r) => pageHtml(roomTable(r, a), a, `Room: ${r.name}${r.capacity ? ` (seats ${r.capacity})` : ""}`)).join("");
  openAndPrint(title, pages, a.rowHeight);
}

// ---------------- substitutions ----------------

export interface SubRow { date: string; slot?: TimeSlot; section?: string; subject?: string; absent?: string; substitute?: string; room?: string; note?: string | null }

const longDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

function subRowsTable(rows: SubRow[], withSubstitute: boolean): string {
  return listTableHtml(
    ["Period", "Class", "Absent teacher", ...(withSubstitute ? ["Substitute"] : []), "Room / note"],
    rows.map((r) => ({
      first: r.slot?.label ?? "",
      firstSub: r.slot ? `${r.slot.startTime}–${r.slot.endTime}` : undefined,
      cells: [
        { bold: r.subject ?? "", sub: r.section },
        r.absent ?? "",
        ...(withSubstitute ? [{ bold: r.substitute ?? "Not assigned" }] : []),
        [r.room, r.note].filter(Boolean).join(" · "),
      ],
    })),
  );
}

/** One sheet listing every substitution on a day, then one slip per substitute teacher. */
export function printSubstitutions(date: string, rows: SubRow[], opts: PrintOpts) {
  const sorted = rows.slice().sort((a, b) => (a.slot?.startTime ?? "").localeCompare(b.slot?.startTime ?? "") || (a.section ?? "").localeCompare(b.section ?? ""));
  const pages = [pageHtml(subRowsTable(sorted, true), opts, `Substitutions · ${longDate(date)}`)];
  const bySub = new Map<string, SubRow[]>();
  for (const r of sorted) if (r.substitute) { if (!bySub.has(r.substitute)) bySub.set(r.substitute, []); bySub.get(r.substitute)!.push(r); }
  for (const [name, list] of [...bySub.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    pages.push(pageHtml(subRowsTable(list, false), opts, `Substitution slip · ${name} · ${longDate(date)}`));
  }
  openAndPrint(`Substitutions ${date}`, pages.join(""), opts.rowHeight);
}
