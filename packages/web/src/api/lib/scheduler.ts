// Scheduling logic shared by the server and the browser build:
// conflict detection and the auto-fill suggestion engine.

export interface SlotInfo {
  id: number;
  label: string;
  sortOrder: number;
  isBreak: boolean;
  startTime?: string;
  endTime?: string;
  gradeLevelIds?: number[] | null; // bell schedule: grades using this period (empty = all)
  days?: number[] | null;          // days using this period (empty = all)
}

export interface SchedCtx {
  sections: { id: number; name: string; gradeLevelId: number; homeroomId?: number | null; studentCount?: number | null }[];
  subjects: { id: number; name: string; color: string | null; roomIds?: number[] | null; timePreference?: string | null }[];
  teachers: { id: number; name: string; subjectIds: number[]; gradeLevelIds?: number[]; maxLoad: number | null; maxPerDay?: number | null }[];
  rooms: { id: number; name: string; capacity?: number | null }[];
  timeSlots: SlotInfo[];
  blockedTimes: { dayOfWeek: number; timeSlotId: number; sectionId: number | null; gradeLevelId?: number | null; sectionIds?: number[] | null }[];
  teacherUnavailable?: { teacherId: number; dayOfWeek: number; timeSlotId: number }[];
  allocations: { gradeLevelId: number; subjectId: number; periodsPerWeek: number; blockSize?: number | null; maxPerDay?: number | null }[];
  loads?: { sectionId: number; subjectId: number; teacherId: number }[];
  entries: SchedEntry[];
  activeDays: number[];
}

export interface SchedEntry {
  id: number;
  sectionId: number;
  dayOfWeek: number;
  timeSlotId: number;
  subjectId: number;
  teacherId: number | null;
  roomId: number | null;
}

export type ConflictType =
  | "teacher_double"
  | "section_double"
  | "room_double"
  | "blocked"
  | "slot_not_used"
  | "teacher_unavailable"
  | "over_allocation"
  | "under_allocation"
  | "teacher_subject_mismatch"
  | "teacher_grade_mismatch"
  | "teacher_overload"
  | "teacher_daily_overload"
  | "load_mismatch"
  | "room_capacity"
  | "room_type"
  | "subject_daily_limit";

export interface Conflict {
  type: ConflictType;
  severity: "error" | "warning";
  message: string;
  entryIds: number[];
  sectionId?: number;
  subjectId?: number;
  teacherId?: number;
  roomId?: number;
  dayOfWeek?: number;
  timeSlotId?: number;
}

// ---------------- time helpers ----------------

/** "7:30" / "07:30" -> minutes after midnight (NaN if unreadable). */
export function toMinutes(t: string | null | undefined): number {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Does this period exist for a grade level on a given day? */
export function slotApplies(slot: SlotInfo, gradeLevelId: number | null | undefined, day: number): boolean {
  const g = slot.gradeLevelIds;
  const d = slot.days;
  if (g && g.length && (gradeLevelId == null || !g.includes(gradeLevelId))) return false;
  if (d && d.length && !d.includes(day)) return false;
  return true;
}

/** Does the period exist for a grade on at least one day? */
export function slotUsedByGrade(slot: SlotInfo, gradeLevelId: number | null | undefined): boolean {
  const g = slot.gradeLevelIds;
  return !(g && g.length && (gradeLevelId == null || !g.includes(gradeLevelId)));
}

/** Two periods overlap in time (the same period always overlaps itself). */
export function slotsOverlap(a: SlotInfo, b: SlotInfo): boolean {
  if (a.id === b.id) return true;
  const a0 = toMinutes(a.startTime), a1 = toMinutes(a.endTime), b0 = toMinutes(b.startTime), b1 = toMinutes(b.endTime);
  if ([a0, a1, b0, b1].some(Number.isNaN)) return false;
  return a0 < b1 && b0 < a1;
}

/** Periods ordered by start time, then their sort order. */
export function sortSlots<T extends SlotInfo>(slots: T[]): T[] {
  return slots.slice().sort((a, b) => {
    const ta = toMinutes(a.startTime), tb = toMinutes(b.startTime);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return a.sortOrder - b.sortOrder || a.id - b.id;
  });
}

// Does a blocked-time row apply to a given section?
// Scope priority: sectionIds (specific) > gradeLevelId (whole grade) > sectionId (legacy single) > null (all sections).
function blockAppliesToSection(
  b: { sectionId: number | null; gradeLevelId?: number | null; sectionIds?: number[] | null },
  sectionId: number,
  sectionGradeLevelId: number | null,
): boolean {
  if (b.sectionIds && b.sectionIds.length) return b.sectionIds.includes(sectionId);
  if (b.gradeLevelId != null) return sectionGradeLevelId === b.gradeLevelId;
  if (b.sectionId != null) return b.sectionId === sectionId;
  return true;
}

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Group items whose time ranges overlap (union-find), returning groups of 2+. */
function overlapGroups<T>(items: T[], slotOf: (x: T) => SlotInfo | undefined): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = slotOf(items[i]), b = slotOf(items[j]);
      if (a && b && slotsOverlap(a, b)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(x); });
  return [...groups.values()].filter((g) => g.length > 1);
}

// ---------------- conflict detection ----------------

export function detectConflicts(ctx: SchedCtx): Conflict[] {
  const conflicts: Conflict[] = [];
  const entries = ctx.entries;
  const slotById = new Map(ctx.timeSlots.map((s) => [s.id, s]));
  const sectionById = new Map(ctx.sections.map((s) => [s.id, s]));
  const subjectById = new Map(ctx.subjects.map((s) => [s.id, s]));
  const teacherById = new Map(ctx.teachers.map((t) => [t.id, t]));
  const roomById = new Map(ctx.rooms.map((r) => [r.id, r]));
  const slotLabel = (id: number) => slotById.get(id)?.label ?? `slot ${id}`;
  const dayName = (d: number) => DAY[d] ?? `day ${d}`;
  const teacherName = (id: number) => teacherById.get(id)?.name ?? `Teacher ${id}`;
  const roomName = (id: number) => roomById.get(id)?.name ?? `Room ${id}`;
  const sectionName = (id: number) => sectionById.get(id)?.name ?? `Section ${id}`;
  const subjectName = (id: number) => subjectById.get(id)?.name ?? `Subject ${id}`;
  const slotOf = (e: SchedEntry) => slotById.get(e.timeSlotId);

  // --- double bookings (by overlapping time, so different bell schedules are compared correctly) ---
  const groupBy = (key: (e: SchedEntry) => string | null) => {
    const m = new Map<string, SchedEntry[]>();
    for (const e of entries) { const k = key(e); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return m;
  };
  const when = (list: SchedEntry[]) => `${dayName(list[0].dayOfWeek)} ${[...new Set(list.map((x) => slotLabel(x.timeSlotId)))].join("/")}`;

  for (const list of groupBy((e) => (e.teacherId != null ? `${e.teacherId}:${e.dayOfWeek}` : null)).values()) {
    for (const g of overlapGroups(list, slotOf)) {
      conflicts.push({
        type: "teacher_double", severity: "error",
        message: `${teacherName(g[0].teacherId!)} is double-booked ${when(g)} (${g.map((x) => sectionName(x.sectionId)).join(", ")})`,
        entryIds: g.map((x) => x.id), teacherId: g[0].teacherId!, dayOfWeek: g[0].dayOfWeek, timeSlotId: g[0].timeSlotId,
      });
    }
  }
  for (const list of groupBy((e) => (e.roomId != null ? `${e.roomId}:${e.dayOfWeek}` : null)).values()) {
    for (const g of overlapGroups(list, slotOf)) {
      conflicts.push({
        type: "room_double", severity: "error",
        message: `${roomName(g[0].roomId!)} is double-booked ${when(g)} (${g.map((x) => sectionName(x.sectionId)).join(", ")})`,
        entryIds: g.map((x) => x.id), roomId: g[0].roomId!, dayOfWeek: g[0].dayOfWeek, timeSlotId: g[0].timeSlotId,
      });
    }
  }
  for (const list of groupBy((e) => `${e.sectionId}:${e.dayOfWeek}`).values()) {
    for (const g of overlapGroups(list, slotOf)) {
      conflicts.push({
        type: "section_double", severity: "error",
        message: `${sectionName(g[0].sectionId)} has ${g.length} classes at the same time — ${when(g)}`,
        entryIds: g.map((x) => x.id), sectionId: g[0].sectionId, dayOfWeek: g[0].dayOfWeek, timeSlotId: g[0].timeSlotId,
      });
    }
  }

  // --- per-entry checks ---
  const unav = ctx.teacherUnavailable ?? [];
  const loadByKey = new Map((ctx.loads ?? []).map((l) => [`${l.sectionId}:${l.subjectId}`, l.teacherId]));
  for (const e of entries) {
    const sec = sectionById.get(e.sectionId);
    const eGrade = sec?.gradeLevelId ?? null;
    const slot = slotById.get(e.timeSlotId);

    if (ctx.blockedTimes.some((b) => b.dayOfWeek === e.dayOfWeek && b.timeSlotId === e.timeSlotId && blockAppliesToSection(b, e.sectionId, eGrade))) {
      conflicts.push({
        type: "blocked", severity: "error",
        message: `${sectionName(e.sectionId)} has ${subjectName(e.subjectId)} on a blocked time — ${dayName(e.dayOfWeek)} ${slotLabel(e.timeSlotId)}`,
        entryIds: [e.id], sectionId: e.sectionId, dayOfWeek: e.dayOfWeek, timeSlotId: e.timeSlotId,
      });
    }
    if (slot && (slot.isBreak || !slotApplies(slot, eGrade, e.dayOfWeek) || !ctx.activeDays.includes(e.dayOfWeek))) {
      conflicts.push({
        type: "slot_not_used", severity: "error",
        message: `${sectionName(e.sectionId)} has ${subjectName(e.subjectId)} in ${slotLabel(e.timeSlotId)} on ${dayName(e.dayOfWeek)}, which isn't a class period for this section that day`,
        entryIds: [e.id], sectionId: e.sectionId, dayOfWeek: e.dayOfWeek, timeSlotId: e.timeSlotId,
      });
    }
    if (e.teacherId != null && slot) {
      const hit = unav.find((u) => u.teacherId === e.teacherId && u.dayOfWeek === e.dayOfWeek && slotById.get(u.timeSlotId) && slotsOverlap(slotById.get(u.timeSlotId)!, slot));
      if (hit) {
        conflicts.push({
          type: "teacher_unavailable", severity: "error",
          message: `${teacherName(e.teacherId)} is marked unavailable ${dayName(e.dayOfWeek)} ${slotLabel(e.timeSlotId)} but teaches ${sectionName(e.sectionId)}`,
          entryIds: [e.id], teacherId: e.teacherId, dayOfWeek: e.dayOfWeek, timeSlotId: e.timeSlotId,
        });
      }
    }
    if (e.teacherId != null) {
      const t = teacherById.get(e.teacherId);
      if (t && t.subjectIds.length > 0 && !t.subjectIds.includes(e.subjectId)) {
        conflicts.push({
          type: "teacher_subject_mismatch", severity: "warning",
          message: `${t.name} is assigned ${subjectName(e.subjectId)} but isn't listed for it`,
          entryIds: [e.id], teacherId: t.id, subjectId: e.subjectId,
        });
      }
      if (t && (t.gradeLevelIds?.length ?? 0) > 0 && eGrade != null && !t.gradeLevelIds!.includes(eGrade)) {
        conflicts.push({
          type: "teacher_grade_mismatch", severity: "warning",
          message: `${t.name} is assigned to ${sectionName(e.sectionId)} but isn't allowed to teach that grade level`,
          entryIds: [e.id], teacherId: t.id,
        });
      }
    }
    const loadTeacher = loadByKey.get(`${e.sectionId}:${e.subjectId}`);
    if (loadTeacher != null && e.teacherId !== loadTeacher) {
      conflicts.push({
        type: "load_mismatch", severity: "warning",
        message: `${sectionName(e.sectionId)} ${subjectName(e.subjectId)} (${dayName(e.dayOfWeek)} ${slotLabel(e.timeSlotId)}) is ${e.teacherId != null ? `with ${teacherName(e.teacherId)}` : "without a teacher"}; the teaching load says ${teacherName(loadTeacher)}`,
        entryIds: [e.id], sectionId: e.sectionId, subjectId: e.subjectId, teacherId: loadTeacher,
      });
    }
    if (e.roomId != null) {
      const room = roomById.get(e.roomId);
      if (room?.capacity && sec?.studentCount && sec.studentCount > room.capacity) {
        conflicts.push({
          type: "room_capacity", severity: "warning",
          message: `${sectionName(e.sectionId)} (${sec.studentCount} students) is in ${room.name}, which holds ${room.capacity} — ${dayName(e.dayOfWeek)} ${slotLabel(e.timeSlotId)}`,
          entryIds: [e.id], sectionId: e.sectionId, roomId: e.roomId,
        });
      }
    }
    const req = subjectById.get(e.subjectId)?.roomIds?.filter((id) => roomById.has(id)) ?? [];
    if (req.length && (e.roomId == null || !req.includes(e.roomId))) {
      conflicts.push({
        type: "room_type", severity: "warning",
        message: `${subjectName(e.subjectId)} for ${sectionName(e.sectionId)} (${dayName(e.dayOfWeek)} ${slotLabel(e.timeSlotId)}) should be in ${req.map(roomName).join(" or ")}`,
        entryIds: [e.id], sectionId: e.sectionId, subjectId: e.subjectId,
      });
    }
  }

  // --- teacher loads ---
  const teacherLoad = new Map<number, number>();
  const teacherDay = new Map<string, number>();
  for (const e of entries) {
    if (e.teacherId == null) continue;
    teacherLoad.set(e.teacherId, (teacherLoad.get(e.teacherId) ?? 0) + 1);
    const k = `${e.teacherId}:${e.dayOfWeek}`;
    teacherDay.set(k, (teacherDay.get(k) ?? 0) + 1);
  }
  for (const t of ctx.teachers) {
    if (t.maxLoad != null && (teacherLoad.get(t.id) ?? 0) > t.maxLoad) {
      conflicts.push({ type: "teacher_overload", severity: "warning", message: `${t.name} has ${teacherLoad.get(t.id)} periods (max ${t.maxLoad})`, entryIds: [], teacherId: t.id });
    }
    if (t.maxPerDay != null) {
      for (const d of ctx.activeDays) {
        const n = teacherDay.get(`${t.id}:${d}`) ?? 0;
        if (n > t.maxPerDay) conflicts.push({ type: "teacher_daily_overload", severity: "warning", message: `${t.name} has ${n} periods on ${dayName(d)} (max ${t.maxPerDay} a day)`, entryIds: [], teacherId: t.id, dayOfWeek: d });
      }
    }
  }

  // --- allocations ---
  for (const section of ctx.sections) {
    const allocs = ctx.allocations.filter((a) => a.gradeLevelId === section.gradeLevelId && a.periodsPerWeek > 0);
    const mine = entries.filter((x) => x.sectionId === section.id);
    const counts = new Map<number, number>();
    for (const e of mine) counts.set(e.subjectId, (counts.get(e.subjectId) ?? 0) + 1);
    for (const a of allocs) {
      const got = counts.get(a.subjectId) ?? 0;
      if (got > a.periodsPerWeek) {
        conflicts.push({
          type: "over_allocation", severity: "warning",
          message: `${sectionName(section.id)}: ${subjectName(a.subjectId)} scheduled ${got}× (target ${a.periodsPerWeek})`,
          entryIds: mine.filter((x) => x.subjectId === a.subjectId).map((x) => x.id), sectionId: section.id, subjectId: a.subjectId,
        });
      } else if (got < a.periodsPerWeek) {
        conflicts.push({
          type: "under_allocation", severity: "warning",
          message: `${sectionName(section.id)}: ${subjectName(a.subjectId)} scheduled ${got}× (needs ${a.periodsPerWeek})`,
          entryIds: [], sectionId: section.id, subjectId: a.subjectId,
        });
      }
      if (a.maxPerDay != null && a.maxPerDay > 0) {
        for (const d of ctx.activeDays) {
          const sameDay = mine.filter((x) => x.subjectId === a.subjectId && x.dayOfWeek === d);
          if (sameDay.length > a.maxPerDay) {
            conflicts.push({
              type: "subject_daily_limit", severity: "warning",
              message: `${sectionName(section.id)} has ${subjectName(a.subjectId)} ${sameDay.length}× on ${dayName(d)} (max ${a.maxPerDay} a day)`,
              entryIds: sameDay.map((x) => x.id), sectionId: section.id, subjectId: a.subjectId, dayOfWeek: d,
            });
          }
        }
      }
    }
  }

  return conflicts;
}

// ---------------- auto-fill ----------------
// Builds NEW entries for empty periods of the requested sections. It never
// changes existing classes. It runs many attempts with different orderings
// and keeps the one that places the most periods with the fewest compromises.

export interface SuggestedEntry {
  sectionId: number;
  dayOfWeek: number;
  timeSlotId: number;
  subjectId: number;
  teacherId: number | null;
  roomId: number | null;
}

export interface Unplaced { sectionId: number; subjectId: number; periods: number; reason: string }

export interface AutoFillResult {
  suggestions: SuggestedEntry[];
  unplaced: Unplaced[];
  teacherless: number;
  attempts: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Task { sectionId: number; subjectId: number; size: number; key: number }

export function autoFill(ctx: SchedCtx, targetSectionIds: number[], opts: { attempts?: number; timeBudgetMs?: number } = {}): AutoFillResult {
  const maxAttempts = opts.attempts ?? 40;
  const budget = opts.timeBudgetMs ?? 2500;
  const started = Date.now();

  const days = [...ctx.activeDays].sort((a, b) => a - b);
  const slotById = new Map(ctx.timeSlots.map((s) => [s.id, s]));
  const sectionById = new Map(ctx.sections.map((s) => [s.id, s]));
  const subjectById = new Map(ctx.subjects.map((s) => [s.id, s]));
  const teacherById = new Map(ctx.teachers.map((t) => [t.id, t]));
  const roomById = new Map(ctx.rooms.map((r) => [r.id, r]));
  const ordered = sortSlots(ctx.timeSlots);
  const unav = ctx.teacherUnavailable ?? [];
  const loadByKey = new Map((ctx.loads ?? []).filter((l) => teacherById.has(l.teacherId)).map((l) => [`${l.sectionId}:${l.subjectId}`, l.teacherId]));

  // Ordered period list (breaks included, so blocks never span a break) per section/day.
  const dayRows = new Map<string, SlotInfo[]>();
  const rowsFor = (sectionId: number, day: number) => {
    const k = `${sectionId}:${day}`;
    let r = dayRows.get(k);
    if (!r) { const g = sectionById.get(sectionId)?.gradeLevelId; r = ordered.filter((s) => slotApplies(s, g, day)); dayRows.set(k, r); }
    return r;
  };
  const isBlocked = (sectionId: number, day: number, slotId: number) => {
    const g = sectionById.get(sectionId)?.gradeLevelId ?? null;
    return ctx.blockedTimes.some((b) => b.dayOfWeek === day && b.timeSlotId === slotId && blockAppliesToSection(b, sectionId, g));
  };
  const teacherUnavailableAt = (tid: number, day: number, slot: SlotInfo) =>
    unav.some((u) => u.teacherId === tid && u.dayOfWeek === day && slotById.get(u.timeSlotId) && slotsOverlap(slotById.get(u.timeSlotId)!, slot));
  const eligible = (subjectId: number, gradeLevelId: number) =>
    ctx.teachers.filter((t) => (t.subjectIds.length === 0 || t.subjectIds.includes(subjectId)) && ((t.gradeLevelIds?.length ?? 0) === 0 || t.gradeLevelIds!.includes(gradeLevelId)));
  const morning = (s: SlotInfo) => { const m = toMinutes(s.startTime); return Number.isNaN(m) ? null : m < 12 * 60; };

  // Teacher already teaching a section+subject (keeps one teacher per subject per section).
  const existingTeacher = new Map<string, number>();
  for (const e of ctx.entries) if (e.teacherId != null) existingTeacher.set(`${e.sectionId}:${e.subjectId}`, e.teacherId);

  // Work to do.
  const tasks: Task[] = [];
  let key = 0;
  const targets = targetSectionIds.filter((id) => sectionById.has(id));
  for (const sectionId of targets) {
    const sec = sectionById.get(sectionId)!;
    for (const a of ctx.allocations.filter((x) => x.gradeLevelId === sec.gradeLevelId && x.periodsPerWeek > 0)) {
      const already = ctx.entries.filter((e) => e.sectionId === sectionId && e.subjectId === a.subjectId).length;
      let remaining = Math.max(0, a.periodsPerWeek - already);
      const size = Math.max(1, Math.min(4, a.blockSize ?? 1));
      while (remaining > 0) {
        const s = remaining >= size ? size : remaining;
        tasks.push({ sectionId, subjectId: a.subjectId, size: s, key: key++ });
        remaining -= s;
      }
    }
  }
  const allocFor = (sectionId: number, subjectId: number) => {
    const g = sectionById.get(sectionId)!.gradeLevelId;
    return ctx.allocations.find((a) => a.gradeLevelId === g && a.subjectId === subjectId);
  };

  function attempt(seed: number) {
    const rand = mulberry32(seed);
    const jitter = seed === 0 ? 0 : 1;

    const occupied = new Set<string>(); // section:day:slot
    const subjDay = new Map<string, number>(); // section:subject:day
    const tBusy = new Map<string, SlotInfo[]>(); // teacher:day
    const rBusy = new Map<string, SlotInfo[]>(); // room:day
    const tDay = new Map<string, number>();
    const tWeek = new Map<number, number>();
    const chosen = new Map<string, number>(existingTeacher);
    const push = <K>(m: Map<K, SlotInfo[]>, k: K, s: SlotInfo) => { const l = m.get(k); if (l) l.push(s); else m.set(k, [s]); };
    const inc = <K>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
    const free = (m: Map<string, SlotInfo[]>, k: string, block: SlotInfo[]) => { const l = m.get(k); return !l || !block.some((s) => l.some((b) => slotsOverlap(b, s))); };

    for (const e of ctx.entries) {
      const s = slotById.get(e.timeSlotId); if (!s) continue;
      occupied.add(`${e.sectionId}:${e.dayOfWeek}:${e.timeSlotId}`);
      inc(subjDay, `${e.sectionId}:${e.subjectId}:${e.dayOfWeek}`);
      if (e.teacherId != null) { push(tBusy, `${e.teacherId}:${e.dayOfWeek}`, s); inc(tDay, `${e.teacherId}:${e.dayOfWeek}`); inc(tWeek, e.teacherId); }
      if (e.roomId != null) push(rBusy, `${e.roomId}:${e.dayOfWeek}`, s);
    }

    // Hardest first: long blocks, fixed rooms, few possible teachers; random tie-breaks.
    const difficulty = (t: Task) => {
      const sec = sectionById.get(t.sectionId)!;
      const subj = subjectById.get(t.subjectId);
      const fixed = loadByKey.has(`${t.sectionId}:${t.subjectId}`);
      const nTeachers = fixed ? 1 : Math.max(1, eligible(t.subjectId, sec.gradeLevelId).length);
      return t.size * 10 + (subj?.roomIds?.length ? 6 : 0) + 8 / nTeachers + (jitter ? rand() * 6 : 0);
    };
    const queue = tasks.slice().sort((a, b) => difficulty(b) - difficulty(a));

    const out: SuggestedEntry[] = [];
    const failed: { task: Task; reason: string }[] = [];
    let teacherless = 0;
    let penalty = 0;

    for (const task of queue) {
      const sec = sectionById.get(task.sectionId)!;
      const subj = subjectById.get(task.subjectId);
      const alloc = allocFor(task.sectionId, task.subjectId);
      const fixedTeacher = loadByKey.get(`${task.sectionId}:${task.subjectId}`);
      const pairKey = `${task.sectionId}:${task.subjectId}`;
      const pool = eligible(task.subjectId, sec.gradeLevelId);
      const reqRooms = (subj?.roomIds ?? []).filter((id) => roomById.has(id));
      const roomOrder = reqRooms.length
        ? reqRooms
        : [
            ...(sec.homeroomId != null && roomById.has(sec.homeroomId) ? [sec.homeroomId] : []),
            ...ctx.rooms
              .filter((r) => r.id !== sec.homeroomId && !(r.capacity && sec.studentCount && r.capacity < sec.studentCount))
              .sort((a, b) => (a.capacity ?? 9999) - (b.capacity ?? 9999))
              .map((r) => r.id),
          ];

      let best: { score: number; day: number; block: SlotInfo[]; teacherId: number | null; roomId: number | null } | null = null;
      let sawCell = false, sawDayOk = false, sawTeacher = false;

      for (const day of days) {
        const rows = rowsFor(task.sectionId, day);
        const dayCount = subjDay.get(`${task.sectionId}:${task.subjectId}:${day}`) ?? 0;
        for (let i = 0; i + task.size <= rows.length; i++) {
          const block = rows.slice(i, i + task.size);
          if (block.some((s) => s.isBreak || occupied.has(`${task.sectionId}:${day}:${s.id}`) || isBlocked(task.sectionId, day, s.id))) continue;
          sawCell = true;
          if (alloc?.maxPerDay && dayCount + task.size > alloc.maxPerDay) continue;
          sawDayOk = true;

          // Teacher
          const okTeacher = (tid: number) => {
            const t = teacherById.get(tid);
            if (!t) return false;
            if (!free(tBusy, `${tid}:${day}`, block)) return false;
            if (block.some((s) => teacherUnavailableAt(tid, day, s))) return false;
            if (t.maxPerDay != null && (tDay.get(`${tid}:${day}`) ?? 0) + task.size > t.maxPerDay) return false;
            if (t.maxLoad != null && (tWeek.get(tid) ?? 0) + task.size > t.maxLoad) return false;
            return true;
          };
          let teacherId: number | null = null;
          let tPenalty = 0;
          if (fixedTeacher != null) {
            if (!okTeacher(fixedTeacher)) continue;
            teacherId = fixedTeacher;
          } else {
            const prev = chosen.get(pairKey);
            if (prev != null && okTeacher(prev)) teacherId = prev;
            else {
              const cands = pool.filter((t) => okTeacher(t.id))
                .sort((a, b) => (tWeek.get(a.id) ?? 0) - (tWeek.get(b.id) ?? 0) + (jitter ? (rand() - 0.5) * 2 : 0));
              if (cands.length) { teacherId = cands[0].id; if (prev != null) tPenalty += 25; }
              else { teacherId = null; tPenalty += pool.length ? 70 : 40; }
            }
          }
          if (teacherId != null) sawTeacher = true;

          // Room
          let roomId: number | null = null;
          for (const rid of roomOrder) { if (free(rBusy, `${rid}:${day}`, block)) { roomId = rid; break; } }
          if (roomId == null && reqRooms.length) continue;

          let score = dayCount * 8 + tPenalty;
          if (roomId == null && ctx.rooms.length) score += 15;
          if (!reqRooms.length && sec.homeroomId != null && roomId !== sec.homeroomId) score += 3;
          if (subj?.timePreference === "morning" || subj?.timePreference === "afternoon") {
            for (const s of block) { const am = morning(s); if (am != null && am !== (subj.timePreference === "morning")) score += 3; }
          }
          if (teacherId != null) score += (tDay.get(`${teacherId}:${day}`) ?? 0) * 0.6;
          if (jitter) score += rand() * 2.5;
          if (!best || score < best.score) best = { score, day, block, teacherId, roomId };
        }
      }

      if (!best) {
        const teacherName = fixedTeacher != null ? teacherById.get(fixedTeacher)?.name : null;
        const reason = !sawCell
          ? "No empty periods left in this section's timetable."
          : !sawDayOk
            ? `The limit of ${alloc?.maxPerDay} a day leaves no room for the remaining periods.`
            : fixedTeacher != null && !sawTeacher
              ? `${teacherName} isn't free in any empty period of this section (check their classes, unavailable times and limits).`
              : reqRooms.length
                ? `${reqRooms.map((id) => roomById.get(id)?.name).join(" / ")} ${reqRooms.length > 1 ? "aren't" : "isn't"} free in any empty period.`
                : task.size > 1
                  ? `No ${task.size} back-to-back free periods on one day.`
                  : "No free teacher and period combination.";
        failed.push({ task, reason });
        continue;
      }

      penalty += best.score;
      if (best.teacherId == null) teacherless += task.size;
      else if (!chosen.has(pairKey)) chosen.set(pairKey, best.teacherId);
      for (const s of best.block) {
        out.push({ sectionId: task.sectionId, dayOfWeek: best.day, timeSlotId: s.id, subjectId: task.subjectId, teacherId: best.teacherId, roomId: best.roomId });
        occupied.add(`${task.sectionId}:${best.day}:${s.id}`);
        if (best.teacherId != null) push(tBusy, `${best.teacherId}:${best.day}`, s);
        if (best.roomId != null) push(rBusy, `${best.roomId}:${best.day}`, s);
      }
      inc(subjDay, `${task.sectionId}:${task.subjectId}:${best.day}`, task.size);
      if (best.teacherId != null) { inc(tDay, `${best.teacherId}:${best.day}`, task.size); inc(tWeek, best.teacherId, task.size); }
    }

    const unplacedPeriods = failed.reduce((n, f) => n + f.task.size, 0);
    return { out, failed, teacherless, penalty, unplacedPeriods };
  }

  let best: ReturnType<typeof attempt> | null = null;
  let runs = 0;
  for (let seed = 0; seed < maxAttempts; seed++) {
    const r = attempt(seed);
    runs++;
    if (!best
      || r.unplacedPeriods < best.unplacedPeriods
      || (r.unplacedPeriods === best.unplacedPeriods && (r.teacherless < best.teacherless
        || (r.teacherless === best.teacherless && r.penalty < best.penalty)))) best = r;
    if (best.unplacedPeriods === 0 && best.teacherless === 0 && seed >= 4) break;
    if (Date.now() - started > budget) break;
  }

  const agg = new Map<string, Unplaced>();
  for (const f of best?.failed ?? []) {
    const k = `${f.task.sectionId}:${f.task.subjectId}`;
    const u = agg.get(k);
    if (u) u.periods += f.task.size;
    else agg.set(k, { sectionId: f.task.sectionId, subjectId: f.task.subjectId, periods: f.task.size, reason: f.reason });
  }
  return { suggestions: best?.out ?? [], unplaced: [...agg.values()], teacherless: best?.teacherless ?? 0, attempts: runs };
}

// ---------------- teaching loads ----------------

/** Pick a teacher for each section+subject that has periods but no teacher yet, spreading work evenly. */
export function autoAssignLoads(ctx: SchedCtx): { assigned: { sectionId: number; subjectId: number; teacherId: number }[]; unassigned: { sectionId: number; subjectId: number; reason: string }[] } {
  const loads = ctx.loads ?? [];
  const has = new Set(loads.map((l) => `${l.sectionId}:${l.subjectId}`));
  const weekly = new Map<number, number>();
  const per = (sectionId: number, subjectId: number) => {
    const g = ctx.sections.find((s) => s.id === sectionId)?.gradeLevelId;
    return ctx.allocations.find((a) => a.gradeLevelId === g && a.subjectId === subjectId)?.periodsPerWeek ?? 0;
  };
  for (const l of loads) weekly.set(l.teacherId, (weekly.get(l.teacherId) ?? 0) + per(l.sectionId, l.subjectId));
  // Sections a teacher already has (prefer fewer different sections per teacher only as a tie-breaker).
  const assigned: { sectionId: number; subjectId: number; teacherId: number }[] = [];
  const unassigned: { sectionId: number; subjectId: number; reason: string }[] = [];
  const work: { sectionId: number; subjectId: number; periods: number; pool: SchedCtx["teachers"] }[] = [];
  for (const sec of ctx.sections) {
    for (const a of ctx.allocations.filter((x) => x.gradeLevelId === sec.gradeLevelId && x.periodsPerWeek > 0)) {
      if (has.has(`${sec.id}:${a.subjectId}`)) continue;
      const pool = ctx.teachers.filter((t) => (t.subjectIds.length === 0 || t.subjectIds.includes(a.subjectId)) && ((t.gradeLevelIds?.length ?? 0) === 0 || t.gradeLevelIds!.includes(sec.gradeLevelId)));
      work.push({ sectionId: sec.id, subjectId: a.subjectId, periods: a.periodsPerWeek, pool });
    }
  }
  // Fewest options first; specialists (teachers listed for the subject) before "any subject" teachers.
  work.sort((a, b) => a.pool.length - b.pool.length || b.periods - a.periods);
  for (const w of work) {
    const ranked = w.pool
      .filter((t) => t.maxLoad == null || (weekly.get(t.id) ?? 0) + w.periods <= t.maxLoad)
      .sort((a, b) => {
        const spec = Number(b.subjectIds.length > 0) - Number(a.subjectIds.length > 0);
        if (spec) return spec;
        const ra = (weekly.get(a.id) ?? 0) / (a.maxLoad ?? 40), rb = (weekly.get(b.id) ?? 0) / (b.maxLoad ?? 40);
        return ra - rb || a.id - b.id;
      });
    if (!ranked.length) {
      unassigned.push({ sectionId: w.sectionId, subjectId: w.subjectId, reason: w.pool.length ? "Every qualified teacher would go over their max load." : "No teacher is listed for this subject and grade." });
      continue;
    }
    const t = ranked[0];
    weekly.set(t.id, (weekly.get(t.id) ?? 0) + w.periods);
    assigned.push({ sectionId: w.sectionId, subjectId: w.subjectId, teacherId: t.id });
  }
  return { assigned, unassigned };
}

// ---------------- substitutes ----------------

export interface SubCandidate { teacherId: number; score: number; qualified: boolean; periodsThatDay: number; recentSubs: number; note: string }

/**
 * Rank possible substitutes for one class: free at that time (own classes and
 * other substitutions that day), available, under their daily limit.
 */
export function rankSubstitutes(
  ctx: SchedCtx,
  args: { day: number; slotId: number; subjectId: number | null; gradeLevelId: number | null; absentTeacherId: number | null; subsThatDay: { substituteTeacherId: number | null; timeSlotId: number }[]; recentSubCounts: Map<number, number> },
): SubCandidate[] {
  const slotById = new Map(ctx.timeSlots.map((s) => [s.id, s]));
  const slot = slotById.get(args.slotId);
  if (!slot) return [];
  const out: SubCandidate[] = [];
  for (const t of ctx.teachers) {
    if (t.id === args.absentTeacherId) continue;
    const own = ctx.entries.filter((e) => e.teacherId === t.id && e.dayOfWeek === args.day);
    if (own.some((e) => slotById.get(e.timeSlotId) && slotsOverlap(slotById.get(e.timeSlotId)!, slot))) continue;
    const subs = args.subsThatDay.filter((s) => s.substituteTeacherId === t.id);
    if (subs.some((s) => slotById.get(s.timeSlotId) && slotsOverlap(slotById.get(s.timeSlotId)!, slot))) continue;
    if ((ctx.teacherUnavailable ?? []).some((u) => u.teacherId === t.id && u.dayOfWeek === args.day && slotById.get(u.timeSlotId) && slotsOverlap(slotById.get(u.timeSlotId)!, slot))) continue;
    const periods = own.length + subs.length;
    if (t.maxPerDay != null && periods + 1 > t.maxPerDay) continue;
    const qualified = args.subjectId != null && t.subjectIds.includes(args.subjectId);
    const gradeOk = args.gradeLevelId == null || (t.gradeLevelIds?.length ?? 0) === 0 || t.gradeLevelIds!.includes(args.gradeLevelId);
    const recent = args.recentSubCounts.get(t.id) ?? 0;
    const score = (qualified ? 0 : 20) + (gradeOk ? 0 : 6) + recent * 3 + periods;
    const bits = [qualified ? "teaches this subject" : null, gradeOk ? null : "other grade level", `${periods} period${periods === 1 ? "" : "s"} that day`, `${recent} recent sub${recent === 1 ? "" : "s"}`].filter(Boolean);
    out.push({ teacherId: t.id, score, qualified, periodsThatDay: periods, recentSubs: recent, note: bits.join(" · ") });
  }
  return out.sort((a, b) => a.score - b.score || a.teacherId - b.teacherId);
}
