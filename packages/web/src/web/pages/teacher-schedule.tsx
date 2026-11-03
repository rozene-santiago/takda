import { Link } from "wouter";
import { useState, useMemo, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader, type Tool } from "@/components/page";
import { SidePicker, PickerBar, Segmented, type PickItem } from "@/components/side-picker";
import { useMediaQuery, BP } from "@/lib/use-media";
import { Card, Modal, Field, Select, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import {
  useSections, useSubjects, useTeachers, useRooms, useTimeSlots, useBlockedTimes, useTerms,
  useEntries, useSettings, useEntryMutations, useUnavailability, useSubstitutions, useLocked, useLookups,
} from "@/lib/hooks";
import { useAccess } from "@/lib/access";
import { DAY_SHORT, DAY_FULL } from "@/lib/types";
import type { ScheduleEntry, Teacher, Subject, Section, TimeSlot } from "@/lib/types";
import { CalendarClock, Users, LayoutGrid, Clock, AlertTriangle, Printer, Ban, ArrowLeftRight, Share2, FileSpreadsheet, Copy, Mail } from "lucide-react";
import { cn, teacherColor, NO_COLOR } from "@/lib/utils";
import { printTeachers, teacherSlots, teacherTable, pageHtml } from "@/lib/print";
import { exportMasterMatrix } from "@/lib/excel-export";
import { saveTeacherIcs, saveAllIcs, savePdfZip } from "@/lib/bundles";
import { slotRunsOn, slotApplies, isUnavailable, sortSlots, eligibleTeachers, todayIso, globalBlockAt, blockLabel } from "@/lib/sched";

/** Ctrl (Windows), Option or Cmd (Mac) held during a drag means "copy" rather than "move". */
const isCopyKey = (e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean }) => e.ctrlKey || e.altKey || e.metaKey;
import { request, HOSTED } from "@/lib/api";
import { notify } from "@/lib/save-file";
import { useConfirm } from "@/lib/confirm";

type View = "single" | "master";

export default function TeacherSchedulePage() {
  const sections = useSections();
  const subjects = useSubjects();
  const teachers = useTeachers();
  const slots = useTimeSlots();
  const entries = useEntries();
  const settings = useSettings();
  const blocked = useBlockedTimes();
  const unav = useUnavailability();
  const terms = useTerms();
  const access = useAccess();
  const { update, create } = useEntryMutations();
  const locked = useLocked();
  const { maps, printOpts } = useLookups();
  const { subjMap, sectionMap, roomMap } = maps;
  const monthStart = todayIso().slice(0, 8) + "01";
  const subsThisMonth = useSubstitutions({ from: monthStart });

  const [dragEntry, setDragEntry] = useState<{ id: number; day: number; slotId: number } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState(false); // Ctrl held while dragging a class
  const confirm = useConfirm();
  const endDrag = () => { setDragEntry(null); setDropKey(null); setCopyMode(false); };
  const [view, setView] = useState<View>("single");
  const [masterDay, setMasterDay] = useState<number | "all">("all");
  const [activeTeacher, setActiveTeacher] = useState<number | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<number | "all">("all");
  const [editor, setEditor] = useState<{ entry?: ScheduleEntry; day: number; slotId: number } | null>(null);
  const [shareFor, setShareFor] = useState<Teacher | null>(null);

  const loading = teachers.isLoading || slots.isLoading || settings.isLoading || entries.isLoading;
  const noData = !loading && (teachers.data?.length ?? 0) === 0;
  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const allSlots = slots.data ?? [];
  const slotById = useMemo(() => new Map(allSlots.map((s) => [s.id, s])), [allSlots]);
  const activeTerm = terms.data?.find((t) => t.isActive) ?? null;

  const dayDefaulted = useRef(false);
  useEffect(() => {
    if (dayDefaulted.current || !settings.data) return;
    dayDefaulted.current = true;
    if (!window.matchMedia("(max-width: 639px)").matches) return;
    const today = ((new Date().getDay() + 6) % 7) + 1;
    const active = settings.data.activeDays ?? [1, 2, 3, 4, 5];
    setMasterDay(active.includes(today) ? today : active[0] ?? "all");
  }, [settings.data]);

  // Blocks for all sections are shown on teacher grids; grade/section blocks aren't universal.
  const blockAt = (day: number, slotId: number) => globalBlockAt(blocked.data, day, slotId);

  const filteredTeachers = useMemo(() => {
    const all = teachers.data ?? [];
    return subjectFilter === "all" ? all : all.filter((t) => (t.subjectIds ?? []).includes(subjectFilter));
  }, [teachers.data, subjectFilter]);


  const entriesByTeacher = useMemo(() => {
    const m = new Map<number, ScheduleEntry[]>();
    (entries.data ?? []).forEach((e) => {
      if (e.teacherId == null) return;
      if (!m.has(e.teacherId)) m.set(e.teacherId, []);
      m.get(e.teacherId)!.push(e);
    });
    return m;
  }, [entries.data]);

  const teacherClashKeys = useMemo(() => {
    const out = new Map<number, Set<string>>();
    entriesByTeacher.forEach((list, tid) => {
      const seen = new Map<string, number>();
      list.forEach((e) => { const k = `${e.dayOfWeek}:${e.timeSlotId}`; seen.set(k, (seen.get(k) ?? 0) + 1); });
      out.set(tid, new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k)));
    });
    return out;
  }, [entriesByTeacher]);

  const teacher = teachers.data?.find((t) => t.id === activeTeacher);
  const wide = useMediaQuery(BP.wide);

  // Teachers grouped by their first subject (department), alphabetical inside.
  const pickItems: PickItem[] = useMemo(() => {
    const subjName = (t: Teacher) => (t.subjectIds[0] != null ? subjMap.get(t.subjectIds[0])?.name : undefined) ?? "Any subject";
    const subjOrder = new Map((subjects.data ?? []).map((s, i) => [s.name, i]));
    return (teachers.data ?? []).slice()
      .sort((a, b) => (subjOrder.get(subjName(a)) ?? 999) - (subjOrder.get(subjName(b)) ?? 999) || a.name.localeCompare(b.name))
      .map((t) => {
        const list = entriesByTeacher.get(t.id) ?? [];
        const clash = (teacherClashKeys.get(t.id)?.size ?? 0) > 0;
        const over = t.maxLoad != null && list.length > t.maxLoad;
        const dayOver = t.maxPerDay != null && days.some((d) => list.filter((e) => e.dayOfWeek === d).length > t.maxPerDay!);
        return {
          id: t.id, label: t.name, group: subjName(t), color: teacherColor(t.subjectIds, subjects.data),
          badge: t.maxLoad ? `${list.length}/${t.maxLoad}` : String(list.length),
          tone: clash || over ? "error" : dayOver ? "warn" : undefined,
        } satisfies PickItem;
      });
  }, [teachers.data, subjects.data, entriesByTeacher, teacherClashKeys, subjMap, days]);

  useEffect(() => {
    if (pickItems.length && (activeTeacher == null || !pickItems.some((t) => t.id === activeTeacher))) setActiveTeacher(pickItems[0].id);
  }, [pickItems, activeTeacher]);

  async function moveEntryTo(day: number, slotId: number, copy = false) {
    const d = dragEntry;
    endDrag();
    if (!d || locked || (d.day === day && d.slotId === slotId) || blockAt(day, slotId)) return;
    const slot = slotById.get(slotId);
    const src = (entries.data ?? []).find((e) => e.id === d.id);
    if (!slot || slot.isBreak || !src) return;
    const sec = sectionMap.get(src.sectionId);
    if (sec && !slotApplies(slot, sec.gradeLevelId, day)) {
      notify(`${slot.label} isn't a class period for ${sec.name} on ${DAY_FULL[day]}.`, "error");
      return;
    }
    const target = activeTeacher != null ? (entriesByTeacher.get(activeTeacher) ?? []).find((e) => e.dayOfWeek === day && e.timeSlotId === slotId) : undefined;
    if (!copy) {
      if (target && target.id !== d.id) update.mutate({ id: target.id, dayOfWeek: d.day, timeSlotId: d.slotId });
      update.mutate({ id: d.id, dayOfWeek: day, timeSlotId: slotId });
      return;
    }
    // Copy: same section, subject, teacher and room at the new time.
    if (target) { notify(`${teacher?.name ?? "This teacher"} already teaches ${sectionMap.get(target.sectionId)?.name ?? "a class"} then. Drop the copy on a free period.`, "error"); return; }
    const sectionHas = (entries.data ?? []).find((e) => e.sectionId === src.sectionId && e.dayOfWeek === day && e.timeSlotId === slotId);
    const vals = { subjectId: src.subjectId, teacherId: src.teacherId, roomId: src.roomId };
    const subj = subjMap.get(src.subjectId)?.name ?? "the class";
    if (sectionHas) {
      const ok = await confirm({ title: "Replace a class?", message: `${sec?.name ?? "This section"} already has ${subjMap.get(sectionHas.subjectId)?.name ?? "a class"} on ${DAY_FULL[day]}, ${slot.label}. Replace it with a copy of ${subj}? You can undo this afterwards.`, confirmLabel: "Replace" });
      if (!ok) return;
      update.mutate({ id: sectionHas.id, ...vals });
    } else {
      create.mutate({ sectionId: src.sectionId, dayOfWeek: day, timeSlotId: slotId, ...vals });
    }
    notify(`Copied ${subj} (${sec?.name ?? ""}) to ${DAY_SHORT[day]} · ${slot.label}. Ctrl+Z to undo.`);
  }

  const common = (timeStyle: "default" | "emphasizeTime" = "default") => ({ days, slots: allSlots, entries: entries.data ?? [], blocked: blocked.data ?? [], maps, ...printOpts, timeStyle });
  const icsData = { entries: entries.data ?? [], slotById, subjMap, sectionMap, roomMap, term: activeTerm };
  const orderedTeachers = pickItems.map((p) => teachers.data!.find((t) => t.id === p.id)!).filter(Boolean);

  const pdfZip = () => savePdfZip(`Teacher schedules ${todayIso()}.zip`, orderedTeachers.map((t) => ({ title: t.name, html: pageHtml(teacherTable(t, common()), printOpts, t.name) })), printOpts.rowHeight);

  async function emailAll() {
    const withEmail = (teachers.data ?? []).filter((t) => t.email).length;
    if (!withEmail) { notify("No teacher has an email address yet. Add them on the Teachers page.", "error"); return; }
    notify(`Sending to ${withEmail} teacher${withEmail === 1 ? "" : "s"}…`, "info", true);
    try {
      const r = await request<{ sent: number; skipped: string[]; failed: string[] }>("POST", "/email/teacher-schedules", {});
      notify(`Sent ${r.sent} email${r.sent === 1 ? "" : "s"}.${r.failed.length ? ` ${r.failed.length} failed: ${r.failed.slice(0, 2).join("; ")}` : ""}${r.skipped.length ? ` ${r.skipped.length} without an email address.` : ""}`, r.failed.length ? "error" : "info");
    } catch (e: any) {
      notify(e?.message ?? String(e), "error");
    }
  }

  const tools: Tool[] = noData ? [] : [
    { key: "print", label: "Print", icon: <Printer className="size-4" />, groups: [
      { title: teacher ? `${teacher.name}` : "This teacher", items: [
        { label: "Original format", disabled: !teacher, onSelect: () => teacher && printTeachers([teacher], common("default")) },
        { label: "Emphasize time periods", disabled: !teacher, onSelect: () => teacher && printTeachers([teacher], common("emphasizeTime")) },
      ] },
      { title: "All teachers", items: [
        { label: "Original format", onSelect: () => printTeachers(orderedTeachers, common("default")) },
        { label: "Emphasize time periods", onSelect: () => printTeachers(orderedTeachers, common("emphasizeTime")) },
      ] },
    ] },
    { key: "share", label: "Share", icon: <Share2 className="size-4" />, groups: [
      { title: teacher ? teacher.name : undefined, items: teacher ? [
        ...(!HOSTED && !locked ? [{ label: "Copy schedule link…", hint: "A page the teacher can open on their phone, no sign-in", onSelect: () => setShareFor(teacher) }] : []),
        { label: "Calendar file (.ics)", hint: "Adds weekly classes to Google/Outlook/Apple Calendar", onSelect: () => saveTeacherIcs(teacher, icsData) },
      ] : [] },
      { title: "All teachers", items: [
        { label: "PDFs, one per teacher (.zip)", onSelect: pdfZip },
        { label: "Calendar files (.zip)", onSelect: () => saveAllIcs(orderedTeachers, icsData) },
        ...(!HOSTED && access.emailEnabled && !locked ? [{ label: "Email each teacher their schedule", hint: "Sends their timetable, link and calendar file", onSelect: emailAll }] : []),
      ] },
    ] },
    { key: "export", label: "Export", icon: <FileSpreadsheet className="size-4" />, title: "All teachers in one Excel sheet", onSelect: () => exportMasterMatrix({ teachers: view === "master" ? filteredTeachers : orderedTeachers, days, slots: allSlots, entries: entries.data ?? [], maps }) },
  ];

  const viewSwitch = (
    <Segmented label="View" value={view} onChange={setView} options={[
      { value: "single" as const, label: <><CalendarClock className="size-4" /> One teacher</> },
      { value: "master" as const, label: <><LayoutGrid className="size-4" /> All teachers</> },
    ]} />
  );
  const dayOptions = [{ value: "all" as const, label: "Week" }, ...days.map((d) => ({ value: d, label: DAY_SHORT[d] }))];

  return (
    <Layout>
      <Page>
        <PageHeader title="Teacher Schedule"
          subtitle={locked ? "Each teacher's timetable and load, or all teachers at once." : "Each teacher's timetable and load, or all teachers at once. Click a cell to assign or change a class."}
          tools={tools} />

        {loading && <div className="text-muted-foreground">Loading…</div>}

        {noData && (
          <Card>
            <EmptyState icon={<Users className="size-12" />} title="No teachers yet"
              hint="Add teachers in the Teachers tab, then assign them to classes on the Schedule board."
              action={!locked && <Link href="/teachers"><Button className="bg-brand text-white hover:bg-brand-mid">Go to Teachers</Button></Link>} />
          </Card>
        )}

        {!loading && !noData && view === "single" && (
          <div className="flex gap-5 xl:gap-6 items-start">
            <SidePicker label="Teachers" items={pickItems} value={activeTeacher} onChange={setActiveTeacher} searchPlaceholder="Find a teacher…" />
            <div className="flex-1 min-w-0 space-y-4">
              <PickerBar label="Teacher" items={pickItems} value={activeTeacher} onChange={setActiveTeacher}
                info={teacher && [teacher.email, teacher.subjectIds.map((id) => subjMap.get(id)?.name).filter(Boolean).join(", ") || "Any subject"].filter(Boolean).join(" · ")}>
                <Segmented label="Days shown" value={masterDay} onChange={setMasterDay} options={dayOptions} />
                {viewSwitch}
              </PickerBar>

              {teacher && (() => {
                const tEntries = entriesByTeacher.get(teacher.id) ?? [];
                const clashes = teacherClashKeys.get(teacher.id) ?? new Set<string>();
                const entryAt = (day: number, slotId: number) => tEntries.find((e) => e.dayOfWeek === day && e.timeSlotId === slotId);
                const rows = teacherSlots(teacher, allSlots, entries.data ?? [], sectionMap);
                const gradeIds = teacher.gradeLevelIds?.length ? teacher.gradeLevelIds : null;
                const shownDays = masterDay === "all" ? days : days.filter((d) => d === masterDay);
                const teachable = days.reduce((n, d) => n + rows.filter((s) => !s.isBreak && slotRunsOn(s, d, gradeIds)).length, 0);
                const subs = (subsThisMonth.data ?? []).filter((s) => s.substituteTeacherId === teacher.id).length;
                const summary = <LoadSummary teacher={teacher} entries={tEntries} teachable={teachable} days={days} clashCount={clashes.size} subsThisMonth={subs} subjMap={subjMap} sectionMap={sectionMap} compact={!wide} />;
                return (
                  <div className="grid grid-cols-1 min-[1700px]:grid-cols-[minmax(0,1fr)_290px] gap-5 xl:gap-6 items-start">
                    {!wide && summary}
                    <Card className="overflow-x-auto thin-scroll">
                      <div style={{ minWidth: Math.min(640, 84 + shownDays.length * 120) }}>
                        <div className="grid" style={{ gridTemplateColumns: `minmax(84px, 104px) repeat(${shownDays.length}, minmax(0, 1fr))` }}>
                          <div className="p-3 text-xs font-bold text-muted-foreground uppercase tracking-wide border-b border-border">Time</div>
                          {shownDays.map((d) => <div key={d} className="p-3 text-center text-sm font-display font-bold text-brand-forest border-b border-l border-border">{DAY_FULL[d]}</div>)}
                          {rows.map((slot) => (
                            <div key={slot.id} className="contents">
                              <div className={cn("px-3 py-2 border-b border-border flex flex-col justify-center", slot.isBreak && "bg-muted/50")}>
                                <span className="text-xs font-bold text-brand-forest">{slot.label}</span>
                                <span className="text-[11px] text-muted-foreground tabular-nums">{slot.startTime}–{slot.endTime}</span>
                              </div>
                              {shownDays.map((day) => {
                                const key = `${day}:${slot.id}`;
                                const e = entryAt(day, slot.id);
                                if (!e && slot.isBreak) return <div key={key} className="border-b border-l border-border bg-muted/40 grid place-items-center text-[11px] text-muted-foreground italic py-2">{slot.label}</div>;
                                if (!e && !slotRunsOn(slot, day, gradeIds)) return <div key={key} className="border-b border-l border-border bg-muted/60 grid place-items-center text-[11px] text-muted-foreground">—</div>;
                                const subj = e ? subjMap.get(e.subjectId) : undefined;
                                const sec = e ? sectionMap.get(e.sectionId) : undefined;
                                const room = e?.roomId ? roomMap.get(e.roomId) : undefined;
                                const clash = clashes.has(key);
                                const block = !e ? blockAt(day, slot.id) : undefined;
                                const away = isUnavailable(unav.data, teacher.id, day, slot, slotById);
                                const canDrop = !!dragEntry && !locked && !block;
                                return (
                                  <div key={key}
                                    onClick={() => { if (!locked && !block) setEditor({ entry: e, day, slotId: slot.id }); }}
                                    onDragOver={(ev) => {
                                      if (!canDrop) return;
                                      ev.preventDefault();
                                      const copy = isCopyKey(ev);
                                      ev.dataTransfer.dropEffect = copy ? "copy" : "move";
                                      if (copy !== copyMode) setCopyMode(copy);
                                      setDropKey(key);
                                    }}
                                    onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
                                    onDrop={(ev) => { ev.preventDefault(); void moveEntryTo(day, slot.id, isCopyKey(ev)); }}
                                    title={away ? "Marked unavailable" : block?.reason ?? undefined}
                                    className={cn("relative border-b border-l border-border min-h-[64px] p-1 transition",
                                      block ? "bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_12px)] cursor-not-allowed"
                                        : away && !e ? "bg-[repeating-linear-gradient(45deg,#fdf0ef,#fdf0ef_6px,#f8dedb_6px,#f8dedb_12px)]"
                                        : locked ? "" : "cursor-pointer hover:bg-brand-sage/15",
                                      dropKey === key && (copyMode ? "drop-target drop-copy" : "ring-2 ring-brand ring-inset bg-brand-sage/25"))}>
                                    {dropKey === key && (
                                      <span className={cn("pointer-events-none absolute z-10 top-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-bold shadow", copyMode ? "bg-brand-bright text-white" : "bg-white/90 text-brand-forest")}>
                                        {copyMode ? "+ Copy here" : e ? "Swap" : "Move here"}
                                      </span>
                                    )}
                                    {block && <div className="h-full w-full grid place-items-center text-[11px] text-muted-foreground font-medium"><span className="flex items-center gap-1"><Ban className="size-3" /> {blockLabel(block)}</span></div>}
                                    {!block && away && !e && <div className="h-full w-full grid place-items-center text-[11px] text-destructive/80 font-medium">Unavailable</div>}
                                    {e && (
                                      <div draggable={!locked} title={[subj?.name, sec?.name, room?.name, locked ? null : "\nDrag to move · hold Ctrl while dragging to copy"].filter(Boolean).join("\n")}
                                        onDragStart={(ev) => { if (locked) return; ev.stopPropagation(); ev.dataTransfer.effectAllowed = "copyMove"; ev.dataTransfer.setData("text/plain", subj?.name ?? "class"); setDragEntry({ id: e.id, day, slotId: slot.id }); }}
                                        onDragEnd={endDrag}
                                        className={cn("relative h-full w-full rounded-md px-2 py-1.5 text-white text-xs flex flex-col justify-center gap-px overflow-hidden", !locked && "cursor-grab active:cursor-grabbing", (clash || away) && "ring-2 ring-destructive ring-offset-1")}
                                        style={{ backgroundColor: subj?.color || NO_COLOR }}>
                                        <span className="font-bold leading-[1.15] line-clamp-2 break-words pr-3">{subj?.name ?? "?"}</span>
                                        {sec && <span className="text-white/85 truncate text-[11px] leading-tight">{sec.name}</span>}
                                        {room && <span className="text-white/70 truncate text-[10.5px] leading-tight">{room.name}</span>}
                                        {(clash || away) && <AlertTriangle className="absolute top-1 right-1 size-3 text-white" />}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                    </Card>
                    {wide && summary}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {!loading && !noData && view === "master" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <div className="w-full sm:w-64"><Select value={subjectFilter === "all" ? "" : subjectFilter} onChange={(e) => setSubjectFilter(e.target.value ? Number(e.target.value) : "all")} aria-label="Subject">
                <option value="">All subjects ({teachers.data?.length ?? 0} teachers)</option>
                {(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select></div>
              <Segmented label="Days shown" value={masterDay} onChange={setMasterDay} options={dayOptions} />
              <div className="lg:ml-auto">{viewSwitch}</div>
            </div>
            <MasterMatrix teachers={subjectFilter === "all" ? orderedTeachers : filteredTeachers} days={masterDay === "all" ? days : days.filter((d) => d === masterDay)} slots={allSlots}
              entriesByTeacher={entriesByTeacher} clashes={teacherClashKeys} maps={maps} subjects={subjects.data ?? []}
              onOpen={locked ? undefined : (entry) => setEditor({ entry, day: entry.dayOfWeek, slotId: entry.timeSlotId })} />
          </div>
        )}
      </Page>

      {editor && (
        <TeacherCellEditor editor={editor} teacherId={view === "single" ? activeTeacher ?? editor.entry?.teacherId ?? null : editor.entry?.teacherId ?? null}
          sections={sections.data ?? []} subjects={subjects.data ?? []} teachers={teachers.data ?? []} onClose={() => setEditor(null)} />
      )}
      {shareFor && <ShareLinkModal teacher={shareFor} onClose={() => setShareFor(null)} />}
    </Layout>
  );
}

function MasterMatrix({ teachers, days, slots, entriesByTeacher, clashes, maps, subjects, onOpen }: {
  teachers: Teacher[]; days: number[]; slots: TimeSlot[]; entriesByTeacher: Map<number, ScheduleEntry[]>; clashes: Map<number, Set<string>>;
  maps: ReturnType<typeof useLookups>["maps"]; subjects: Subject[]; onOpen?: (e: ScheduleEntry) => void;
}) {
  const cols = useMemo(() => {
    const ordered = sortSlots(slots).filter((s) => !s.isBreak);
    return days.flatMap((d) => ordered.filter((s) => !s.days?.length || s.days.includes(d)).map((s) => ({ d, s })));
  }, [days, slots]);
  return (
    <Card className="overflow-auto thin-scroll p-0 max-h-[calc(100vh-13rem)]">
      <table className="w-full border-separate border-spacing-0 min-w-[760px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-10 bg-brand-forest text-white text-left text-xs font-bold uppercase tracking-wide px-3 py-2.5 min-w-[190px]">Teacher</th>
            {cols.map(({ d, s }, i) => (
              <th key={`${d}:${s.id}`} className={cn("bg-brand-forest text-white text-[10px] font-semibold px-2 py-2 whitespace-nowrap min-w-[88px]", i > 0 && cols[i - 1].d !== d ? "border-l-2 border-l-brand-lime/60" : "border-l border-white/10")}>
                <div>{DAY_SHORT[d]}</div><div className="text-white/60 font-normal">{s.label}</div>
              </th>
            ))}
            <th className="sticky right-0 bg-brand-forest text-white text-[10px] font-bold px-2 py-2 border-l border-white/10">Load</th>
          </tr>
        </thead>
        <tbody>
          {teachers.length === 0 && <tr><td colSpan={cols.length + 2} className="px-3 py-6 text-center text-sm text-muted-foreground">No teachers match this subject.</td></tr>}
          {teachers.map((t, ri) => {
            const tEntries = entriesByTeacher.get(t.id) ?? [];
            const cl = clashes.get(t.id) ?? new Set<string>();
            return (
              <tr key={t.id} className={ri % 2 ? "bg-[#fbfaf7]" : "bg-card"}>
                <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 text-sm font-semibold text-brand-forest border-b border-r border-border whitespace-nowrap">
                  <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: teacherColor(t.subjectIds, subjects) }} />{t.name}</span>
                </td>
                {cols.map(({ d, s }, ci) => {
                  const key = `${d}:${s.id}`;
                  const dayStart = ci > 0 && cols[ci - 1].d !== d;
                  const e = tEntries.find((x) => x.dayOfWeek === d && x.timeSlotId === s.id);
                  const subj = e ? maps.subjMap.get(e.subjectId) : undefined;
                  const sec = e ? maps.sectionMap.get(e.sectionId) : undefined;
                  const room = e?.roomId ? maps.roomMap.get(e.roomId) : undefined;
                  return (
                    <td key={key} onClick={() => { if (onOpen && e) onOpen(e); }} className={cn("border-b border-border p-0.5 align-top", dayStart ? "border-l-2 border-l-brand-forest/25" : "border-l", onOpen && e && "cursor-pointer")}>
                      {e ? (
                        <div className={cn("rounded px-1.5 py-1 text-white text-[10px] leading-tight min-h-[34px] flex flex-col justify-center", cl.has(key) && "ring-2 ring-destructive")}
                          style={{ backgroundColor: subj?.color || NO_COLOR }} title={`${subj?.name} · ${sec?.name}${room ? " · " + room.name : ""}`}>
                          <span className="font-bold truncate">{subj?.code || subj?.name || "?"}</span>
                          <span className="text-white/80 truncate">{sec?.name}{room ? ` · ${room.name}` : ""}</span>
                        </div>
                      ) : <div className="min-h-[34px]" />}
                    </td>
                  );
                })}
                <td className={cn("sticky right-0 bg-inherit border-l border-b border-border text-center text-xs font-bold px-2", t.maxLoad != null && tEntries.length > t.maxLoad ? "text-destructive" : "text-brand-forest")}>
                  {tEntries.length}{t.maxLoad ? `/${t.maxLoad}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function LoadSummary({ teacher, entries, teachable, days, clashCount, subsThisMonth, subjMap, sectionMap, compact }: {
  teacher: Teacher; entries: ScheduleEntry[]; teachable: number; days: number[]; clashCount: number; subsThisMonth: number;
  subjMap: Map<number, Subject>; sectionMap: Map<number, Section>; compact?: boolean;
}) {
  const used = entries.length;
  const pct = teachable ? Math.round((used / teachable) * 100) : 0;
  const over = teacher.maxLoad != null && used > teacher.maxLoad;
  const perDay = days.map((d) => ({ d, n: entries.filter((e) => e.dayOfWeek === d).length }));
  const overDays = teacher.maxPerDay != null ? perDay.filter((x) => x.n > teacher.maxPerDay!) : [];
  const bySubject = entries.reduce((acc, e) => acc.set(e.subjectId, (acc.get(e.subjectId) ?? 0) + 1), new Map<number, number>());
  const secs = [...new Set(entries.map((e) => sectionMap.get(e.sectionId)?.name).filter(Boolean))];
  const warnings = [
    over && `Over max load by ${used - teacher.maxLoad!} period(s).`,
    overDays.length > 0 && `Too many periods on ${overDays.map((x) => DAY_SHORT[x.d]).join(", ")}.`,
    clashCount > 0 && `${clashCount} double-booked period(s).`,
  ].filter(Boolean) as string[];
  const dayBars = (
    <div className="flex gap-1">
      {perDay.map(({ d, n }) => (
        <div key={d} className={cn("flex-1 min-w-9 rounded-md text-center py-1", teacher.maxPerDay != null && n > teacher.maxPerDay ? "bg-destructive/15 text-destructive" : "bg-muted/60")}>
          <div className="text-[10px] text-muted-foreground">{DAY_SHORT[d]}</div><div className="text-sm font-bold tabular-nums">{n}</div>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2"><Clock className="size-5 text-brand" /><span className="font-display font-bold text-brand-forest">Load</span></div>
          <MiniStat label="Periods / week" value={`${used}${teacher.maxLoad != null ? ` / ${teacher.maxLoad}` : ""}`} danger={over} />
          <MiniStat label="Free periods" value={String(Math.max(0, teachable - used))} />
          <MiniStat label="Subs this month" value={String(subsThisMonth)} />
          <div className="min-w-[220px] flex-1 max-w-sm">{dayBars}</div>
          {bySubject.size > 1 && <p className="text-xs text-muted-foreground">{[...bySubject.entries()].map(([sid, n]) => `${subjMap.get(sid)?.name ?? "?"} ${n}`).join(" · ")}</p>}
        </div>
        {warnings.length > 0 && <div className="mt-2.5 flex flex-wrap gap-2">{warnings.map((w) => <span key={w} className="text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive inline-flex items-center gap-1"><AlertTriangle className="size-3.5" />{w}</span>)}</div>}
      </Card>
    );
  }

  return (
    <Card className="p-4 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto thin-scroll space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="size-5 text-brand" />
        <h3 className="font-display font-bold text-brand-forest">Teaching Load</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Periods/week" value={String(used)} />
        <Stat label="Max load" value={teacher.maxLoad != null ? String(teacher.maxLoad) : "—"} tone={over ? "danger" : undefined} />
        <Stat label="Free periods" value={String(Math.max(0, teachable - used))} />
        <Stat label="Subs this month" value={String(subsThisMonth)} />
      </div>
      <div>
        <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-brand")} style={{ width: `${Math.min(100, pct)}%` }} /></div>
        <p className="text-[11px] text-muted-foreground mt-1">{pct}% of the periods they could teach</p>
      </div>
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Per day{teacher.maxPerDay != null ? ` (max ${teacher.maxPerDay})` : ""}</p>
        {dayBars}
      </div>
      {warnings.map((w) => <div key={w} className="text-xs p-2 rounded-lg bg-destructive/10 text-destructive flex items-start gap-1.5"><AlertTriangle className="size-3.5 mt-0.5 shrink-0" /> {w}</div>)}
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1.5">By subject</p>
        <div className="space-y-1">
          {[...bySubject.entries()].map(([sid, n]) => {
            const s = subjMap.get(sid);
            return <div key={sid} className="flex items-center gap-2 text-sm"><span className="size-3 rounded shrink-0" style={{ backgroundColor: s?.color || NO_COLOR }} /><span className="flex-1 truncate">{s?.name ?? "?"}</span><span className="font-semibold text-brand-forest">{n}</span></div>;
          })}
          {bySubject.size === 0 && <p className="text-sm text-muted-foreground">No classes assigned.</p>}
        </div>
      </div>
      {secs.length > 0 && <p className="text-xs text-muted-foreground"><b className="text-foreground">Sections:</b> {secs.join(", ")}</p>}
      <p className="text-[10px] leading-snug text-muted-foreground border-t border-border pt-2.5 italic">
        This counts scheduled face-to-face periods only; it may not be the teacher's full official load.
      </p>
    </Card>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
      <p className={cn("text-lg font-bold leading-tight tabular-nums", danger ? "text-destructive" : "text-brand-forest")}>{value}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold", tone === "danger" ? "text-destructive" : "text-brand-forest")}>{value}</p>
    </div>
  );
}

/** Server version: a private link to a read-only page with the teacher's week and calendar file. */
function ShareLinkModal({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const confirm = useConfirm();
  const load = async (reset = false) => {
    setErr(null);
    try { setToken((await request<{ token: string }>("POST", `/teachers/${teacher.id}/share-link`, { reset })).token); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  };
  useEffect(() => { void load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const url = token ? `${location.origin}/s/${token}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); notify("Link copied."); } catch { notify("Select the link and copy it.", "error"); }
  };
  return (
    <Modal open onClose={onClose} title={`Schedule link for ${teacher.name}`}
      footer={<>
        <Button variant="outline" className="mr-auto" disabled={!token} onClick={async () => { if (await confirm({ title: "Make a new link?", message: "The current link will stop working. Send the new one to the teacher.", confirmLabel: "New link" })) void load(true); }}>New link</Button>
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button onClick={copy} disabled={!token} className="bg-brand text-white hover:bg-brand-mid"><Copy className="size-4" /> Copy link</Button>
      </>}>
      <p className="text-sm text-muted-foreground mb-3">Anyone with this link can see {teacher.name}'s weekly classes and add them to their calendar. It always shows the latest schedule. No sign-in is needed, so share it only with the teacher.</p>
      {err ? <p className="text-sm text-destructive">{err}</p> : (
        <input readOnly value={url || "Making link…"} onFocus={(e) => e.target.select()} className="w-full h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm font-mono" />
      )}
      {teacher.email && token && (
        <a className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline mt-3" href={`mailto:${encodeURIComponent(teacher.email)}?subject=${encodeURIComponent("Your class schedule")}&body=${encodeURIComponent(`Here is your class schedule (it always shows the latest version):\n${url}\n\nOn that page you can also add the classes to your calendar.`)}`}>
          <Mail className="size-4" /> Email it to {teacher.email}
        </a>
      )}
    </Modal>
  );
}

/** Editing from a teacher's view: take a class in some section at this time, or change/hand over an existing one. */
function TeacherCellEditor({ editor, teacherId, sections, subjects, teachers, onClose }: {
  editor: { entry?: ScheduleEntry; day: number; slotId: number };
  teacherId: number | null; sections: Section[]; subjects: Subject[]; teachers: Teacher[]; onClose: () => void;
}) {
  const rooms = useRooms();
  const slots = useTimeSlots();
  const entries = useEntries();
  const { create, update } = useEntryMutations();
  const { entry, day, slotId } = editor;
  const [transferTo, setTransferTo] = useState<number | null>(null);
  const others = useMemo(() => {
    if (!entry) return [];
    const grade = sections.find((s) => s.id === entry.sectionId)?.gradeLevelId ?? null;
    return eligibleTeachers(teachers, entry.subjectId, grade).filter((t) => t.id !== entry.teacherId);
  }, [entry, teachers, sections]);
  // Sections whose bell schedule has this period on this day.
  const slot = slots.data?.find((s) => s.id === slotId);
  const usable = sections.filter((s) => !slot || ((!slot.gradeLevelIds?.length || slot.gradeLevelIds.includes(s.gradeLevelId)) && (!slot.days?.length || slot.days.includes(day))));
  const openHere = (entries.data ?? []).filter((e) => e.dayOfWeek === day && e.timeSlotId === slotId && e.teacherId == null);
  const [sectionId, setSectionId] = useState<number | null>(entry?.sectionId ?? openHere[0]?.sectionId ?? usable[0]?.id ?? null);
  const [subjectId, setSubjectId] = useState<number>(entry?.subjectId ?? openHere[0]?.subjectId ?? subjects[0]?.id ?? 0);
  const [roomId, setRoomId] = useState<number | null>(entry?.roomId ?? openHere[0]?.roomId ?? null);
  const targetEntry = useMemo(() => entry && entry.sectionId === sectionId ? entry : (entries.data ?? []).find((e) => e.sectionId === sectionId && e.dayOfWeek === day && e.timeSlotId === slotId), [entry, entries.data, sectionId, day, slotId]);
  const busy = create.isPending || update.isPending;

  function save() {
    if (sectionId == null || !subjectId) return;
    if (targetEntry) update.mutate({ id: targetEntry.id, subjectId, roomId, teacherId }, { onSuccess: onClose });
    else create.mutate({ sectionId, dayOfWeek: day, timeSlotId: slotId, subjectId, teacherId, roomId }, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={`${DAY_SHORT[day]} · ${slot?.label ?? ""}`}
      footer={<>
        {entry && <Button variant="outline" onClick={() => update.mutate({ id: entry.id, teacherId: null }, { onSuccess: onClose })} disabled={busy} className="mr-auto">Unassign teacher</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy || sectionId == null || !subjectId || teacherId == null} className="bg-brand text-white hover:bg-brand-mid">Save</Button>
      </>}>
      <Field label="Section">
        <Select value={sectionId ?? ""} onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : null;
          setSectionId(id);
          const ex = (entries.data ?? []).find((x) => x.sectionId === id && x.dayOfWeek === day && x.timeSlotId === slotId);
          if (ex) { setSubjectId(ex.subjectId); setRoomId(ex.roomId); }
        }} disabled={!!entry}>
          {usable.map((s) => {
            const ex = (entries.data ?? []).find((x) => x.sectionId === s.id && x.dayOfWeek === day && x.timeSlotId === slotId);
            return <option key={s.id} value={s.id}>{s.name}{ex ? ` — has ${subjects.find((x) => x.id === ex.subjectId)?.name ?? "a class"}${ex.teacherId == null ? " (no teacher)" : ""}` : ""}</option>;
          })}
        </Select>
      </Field>
      <Field label="Subject">
        <Select value={subjectId} onChange={(e) => setSubjectId(Number(e.target.value))}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </Field>
      <Field label="Room">
        <Select value={roomId ?? ""} onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— None —</option>
          {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </Field>
      {!entry && <p className="text-xs text-muted-foreground">If that section already has a class at this time, it is changed; otherwise a new class is added.</p>}
      {entry && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-1.5 mb-2 text-brand-forest font-semibold text-sm"><ArrowLeftRight className="size-4" /> Hand over to another teacher</div>
          <div className="flex gap-2">
            <Select value={transferTo ?? ""} onChange={(e) => setTransferTo(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Choose teacher —</option>
              {others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Button onClick={() => transferTo != null && update.mutate({ id: entry.id, teacherId: transferTo }, { onSuccess: onClose })} disabled={transferTo == null || busy} className="bg-brand text-white hover:bg-brand-mid shrink-0">Hand over</Button>
          </div>
          {others.length === 0 && <p className="text-xs text-muted-foreground italic mt-1.5">No other teacher is set up for this subject and grade.</p>}
        </div>
      )}
    </Modal>
  );
}
