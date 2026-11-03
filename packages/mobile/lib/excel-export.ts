import * as XLSX from "xlsx";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import type { ScheduleEntry, Subject, Teacher, Room, TimeSlot, Section } from "./hooks";

const DAY_FULL = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface Maps {
  subjMap: Map<number, Subject>;
  teacherMap: Map<number, Teacher>;
  roomMap: Map<number, Room>;
  sectionMap: Map<number, Section>;
}

function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "Sheet";
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

function buildSheet(
  title: string,
  days: number[],
  slots: TimeSlot[],
  cellFor: (day: number, slot: TimeSlot) => string,
): XLSX.WorkSheet {
  const rows: string[][] = [];
  rows.push([title]);
  rows.push([]);
  rows.push(["Time", ...days.map((d) => DAY_FULL[d] ?? "")]);
  for (const slot of slots) {
    const timeLabel = slot.startTime && slot.endTime ? `${slot.label}\n${slot.startTime}–${slot.endTime}` : slot.label;
    if (slot.isBreak) {
      rows.push([timeLabel, ...days.map(() => slot.label || "Break")]);
    } else {
      rows.push([timeLabel, ...days.map((d) => cellFor(d, slot))]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 16 }, ...days.map(() => ({ wch: 22 }))];
  ws["!rows"] = rows.map((_, i) => ({ hpt: i < 3 ? 18 : 42 }));
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: days.length } }];
  return ws;
}

export async function exportScheduleWorkbook(args: {
  sections: Section[];
  teachers: Teacher[];
  days: number[];
  slots: TimeSlot[];
  entries: ScheduleEntry[];
  gradeNameFor?: (s: Section) => string | undefined;
  maps: Maps;
}) {
  const { sections, teachers, days, slots, entries, gradeNameFor, maps } = args;
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  // --- Section sheets ---
  for (const section of sections) {
    const gn = gradeNameFor?.(section);
    const title = `Section: ${section.name}${gn ? ` — ${gn}` : ""}${section.adviser ? `  (Adviser: ${section.adviser})` : ""}`;
    const cellFor = (day: number, slot: TimeSlot) => {
      const e = entries.find((x) => x.sectionId === section.id && x.dayOfWeek === day && x.timeSlotId === slot.id);
      if (!e) return "";
      const subj = maps.subjMap.get(e.subjectId);
      const t = e.teacherId != null ? maps.teacherMap.get(e.teacherId) : undefined;
      const r = e.roomId != null ? maps.roomMap.get(e.roomId) : undefined;
      return cellText([subj?.name ?? "?", t?.name, r?.name ? `Room: ${r.name}` : undefined]);
    };
    XLSX.utils.book_append_sheet(wb, buildSheet(title, days, slots, cellFor), safeSheetName(section.name, used));
  }

  // --- Teacher sheets ---
  for (const teacher of teachers) {
    const title = `Teacher: ${teacher.name}${teacher.email ? `  (${teacher.email})` : ""}`;
    const cellFor = (day: number, slot: TimeSlot) => {
      const e = entries.find((x) => x.teacherId === teacher.id && x.dayOfWeek === day && x.timeSlotId === slot.id);
      if (!e) return "";
      const subj = maps.subjMap.get(e.subjectId);
      const sec = maps.sectionMap.get(e.sectionId);
      const r = e.roomId != null ? maps.roomMap.get(e.roomId) : undefined;
      return cellText([subj?.name ?? "?", sec?.name ? `Sec: ${sec.name}` : undefined, r?.name ? `Room: ${r.name}` : undefined]);
    };
    XLSX.utils.book_append_sheet(wb, buildSheet(title, days, slots, cellFor), safeSheetName(`T - ${teacher.name}`, used));
  }

  const fileName = `Class-Schedule-${new Date().toISOString().slice(0, 10)}.xlsx`;

  if (Platform.OS === "web") {
    XLSX.writeFile(wb, fileName);
    return;
  }

  // Native: write the workbook to the cache dir as a real binary file, then share it.
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const data = new Uint8Array(bytes);

  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true, intermediates: true });
  file.write(data);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: "Export schedule (Excel)",
    UTI: "org.openxmlformats.spreadsheetml.sheet",
  });
}
