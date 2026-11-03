import { Link } from "wouter";
import { useState, useMemo, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader, type Tool } from "@/components/page";
import { SidePicker, PickerBar, Segmented, type PickItem } from "@/components/side-picker";
import { useMediaQuery, BP } from "@/lib/use-media";
import { Card, Modal, Field, Select, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { MenuButton } from "@/components/menu";
import { SavePointModal } from "@/components/save-point-modal";
import { Chips } from "@/components/chips";
import {
  useSections, useSubjects, useTeachers, useRooms, useTimeSlots, useBlockedTimes, useAllocations,
  useEntries, useSettings, useConflicts, useEntryMutations, useAutofill, useSeed, useGradeLevels,
  useTeachingLoads, useUnavailability, useLocked, useLookups, useAct,
} from "@/lib/hooks";
import { DAY_SHORT, DAY_FULL } from "@/lib/types";
import type { ScheduleEntry, Subject, Conflict, AutofillResult, Section, TimeSlot } from "@/lib/types";
import { CalendarDays, Wand2, Trash2, AlertTriangle, CheckCircle2, Lock, Plus, X, Database, GripVertical, Printer, FileSpreadsheet, Save, Wrench, Info, ChevronDown, Copy as CopyIcon } from "lucide-react";
import { cn, NO_COLOR } from "@/lib/utils";
import { printSections } from "@/lib/print";
import { exportScheduleWorkbook } from "@/lib/excel-export";
import { useConfirm } from "@/lib/confirm";
import { gradeSlots, slotApplies, isBlockedFor, isUnavailable, eligibleTeachers, defaultTeacher, defaultRoom, slotsOverlap } from "@/lib/sched";
import { request } from "@/lib/api";
import { notify } from "@/lib/save-file";
import { useQueryClient } from "@tanstack/react-query";

type Proposal = AutofillResult & { mode: "add" | "rebuild"; sectionIds: number[] | null };

/** Ctrl (Windows), Option or Cmd (Mac) held during a drag means "copy" rather than "move". */
const isCopyKey = (e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean }) => e.ctrlKey || e.altKey || e.metaKey;

export default function SchedulePage() {
  const sections = useSections();
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const teachers = useTeachers();
  const rooms = useRooms();
  const slots = useTimeSlots();
  const blocked = useBlockedTimes();
  const entries = useEntries();
  const settings = useSettings();
  const conflicts = useConflicts();
  const loads = useTeachingLoads();
  const allocations = useAllocations();
  const seed = useSeed();
  const { create, update, remove, bulk, clear } = useEntryMutations();
  const autofill = useAutofill();
  const locked = useLocked();
  const wide = useMediaQuery(BP.wide);
  const { maps, printOpts } = useLookups();
  const qc = useQueryClient();
  const { subjMap, teacherMap, roomMap } = maps;

  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [savePointOpen, setSavePointOpen] = useState(false);
  const [tool, setTool] = useState<"copy" | "copy-day" | "replace" | null>(null);

  // Sections in grade order, so the list and Previous/Next follow the school's structure.
  const gradeOrder = useMemo(() => new Map((grades.data ?? []).map((g, i) => [g.id, (g.sortOrder ?? 0) * 1000 + i])), [grades.data]);
  const orderedSections = useMemo(() => (sections.data ?? []).slice().sort((a, b) => (gradeOrder.get(a.gradeLevelId) ?? 0) - (gradeOrder.get(b.gradeLevelId) ?? 0) || a.sortOrder - b.sortOrder || a.id - b.id), [sections.data, gradeOrder]);
  const activeSec = useMemo(() => sections.data?.find((s) => s.id === activeSection), [sections.data, activeSection]);
  const activeSectionName = activeSec?.name ?? "this section";
  const activeGrade = activeSec?.gradeLevelId ?? null;
  const totalEntries = entries.data?.length ?? 0;

  useEffect(() => {
    if (orderedSections.length && (activeSection == null || !orderedSections.some((s) => s.id === activeSection))) setActiveSection(orderedSections[0].id);
  }, [orderedSections, activeSection]);

  const loading = sections.isLoading || subjects.isLoading || slots.isLoading || settings.isLoading;
  const noData = !loading && (sections.data?.length ?? 0) === 0;

  const allDays = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const rowSlots = useMemo(() => gradeSlots(slots.data ?? [], activeGrade), [slots.data, activeGrade]);
  const gradeAllocs = useAllocationsFor(activeGrade);
  const allSlots = slots.data ?? [];

  const [dayFilter, setDayFilter] = useState<number | "all">("all");
  const days = useMemo(() => (dayFilter === "all" ? allDays : allDays.filter((d) => d === dayFilter)), [allDays, dayFilter]);
  // On phones a full week doesn't fit, so open on today's column (or the first school day).
  const dayDefaulted = useRef(false);
  useEffect(() => {
    if (dayDefaulted.current || !settings.data) return;
    dayDefaulted.current = true;
    if (!window.matchMedia("(max-width: 639px)").matches) return;
    const today = ((new Date().getDay() + 6) % 7) + 1;
    const active = settings.data.activeDays ?? [1, 2, 3, 4, 5];
    setDayFilter(active.includes(today) ? today : active[0] ?? "all");
  }, [settings.data]);

  const sectionEntries = useMemo(() => (entries.data ?? []).filter((e) => e.sectionId === activeSection), [entries.data, activeSection]);
  const entryAt = (day: number, slotId: number) => sectionEntries.find((e) => e.dayOfWeek === day && e.timeSlotId === slotId);
  const isBlocked = (day: number, slotId: number) => isBlockedFor(blocked.data, activeSection, activeGrade, day, slotId);
  const isNa = (day: number, slot: TimeSlot) => !slotApplies(slot, activeGrade, day);

  const conflictEntryIds = useMemo(() => {
    const set = new Set<number>();
    (conflicts.data?.conflicts ?? []).forEach((c) => { if (c.severity === "error") c.entryIds.forEach((id) => set.add(id)); });
    return set;
  }, [conflicts.data]);

  // List entries: periods scheduled out of periods required, and whether anything clashes.
  const pickItems: PickItem[] = useMemo(() => {
    const count = new Map<number, number>();
    const secOfEntry = new Map<number, number>();
    (entries.data ?? []).forEach((e) => { count.set(e.sectionId, (count.get(e.sectionId) ?? 0) + 1); secOfEntry.set(e.id, e.sectionId); });
    const bad = new Set<number>();
    (conflicts.data?.conflicts ?? []).forEach((c) => {
      if (c.severity !== "error") return;
      if (c.sectionId != null) bad.add(c.sectionId);
      c.entryIds.forEach((id) => { const s = secOfEntry.get(id); if (s != null) bad.add(s); });
    });
    const need = new Map<number, number>();
    (allocations.data ?? []).forEach((a) => need.set(a.gradeLevelId, (need.get(a.gradeLevelId) ?? 0) + a.periodsPerWeek));
    return orderedSections.map((s) => {
      const n = count.get(s.id) ?? 0, req = need.get(s.gradeLevelId) ?? 0;
      return {
        id: s.id, label: s.name, group: grades.data?.find((g) => g.id === s.gradeLevelId)?.name,
        sub: s.adviser || undefined,
        badge: req ? `${n}/${req}` : n ? String(n) : undefined,
        tone: bad.has(s.id) ? "error" : req && n !== req ? "warn" : req ? "ok" : undefined,
      } satisfies PickItem;
    });
  }, [orderedSections, entries.data, conflicts.data, allocations.data, grades.data]);

  const [dragData, setDragData] = useState<{ kind: "subject" | "entry"; subjectId: number; entryId?: number; fromDay?: number; fromSlotId?: number } | null>(null);
  const [dropCell, setDropCell] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState(false); // Ctrl held while dragging a class
  const [editor, setEditor] = useState<{ day: number; slotId: number; entry?: ScheduleEntry } | null>(null);
  const endDrag = () => { setDragData(null); setDropCell(null); setCopyMode(false); };

  const defaultsFor = (subjectId: number) => ({
    teacherId: activeSection == null ? null : defaultTeacher({ loads: loads.data, teachers: teachers.data ?? [], entries: entries.data, sectionId: activeSection, subjectId, gradeLevelId: activeGrade }),
    roomId: defaultRoom({ section: activeSec, subject: subjMap.get(subjectId), rooms: rooms.data ?? [] }),
  });

  function handleDropOnCell(day: number, slot: TimeSlot, copy = false) {
    const drag = dragData;
    endDrag();
    if (!drag || activeSection == null || slot.isBreak || isNa(day, slot) || isBlocked(day, slot.id)) return;
    const existing = entryAt(day, slot.id);
    if (drag.kind === "entry" && drag.entryId) {
      if (existing && existing.id === drag.entryId) return;
      const src = sectionEntries.find((e) => e.id === drag.entryId);
      if (copy && src) {
        copyClass(src, day, slot, existing);
        return;
      }
      if (existing && drag.fromDay != null && drag.fromSlotId != null) update.mutate({ id: existing.id, dayOfWeek: drag.fromDay, timeSlotId: drag.fromSlotId });
      update.mutate({ id: drag.entryId, dayOfWeek: day, timeSlotId: slot.id });
    } else if (existing) {
      update.mutate({ id: existing.id, subjectId: drag.subjectId, ...defaultsFor(drag.subjectId) });
    } else {
      create.mutate({ sectionId: activeSection, dayOfWeek: day, timeSlotId: slot.id, subjectId: drag.subjectId, ...defaultsFor(drag.subjectId) });
    }
  }

  /** Put a copy of a class (same subject, teacher and room) into another period of this section. */
  function copyClass(src: ScheduleEntry, day: number, slot: TimeSlot, existing?: ScheduleEntry) {
    if (activeSection == null) return;
    const vals = { subjectId: src.subjectId, teacherId: src.teacherId, roomId: src.roomId };
    if (existing) update.mutate({ id: existing.id, ...vals });
    else create.mutate({ sectionId: activeSection, dayOfWeek: day, timeSlotId: slot.id, ...vals });
    const slotById = new Map(allSlots.map((x) => [x.id, x]));
    const sameTime = (entries.data ?? []).filter((e) => e.id !== existing?.id && e.sectionId !== activeSection && e.dayOfWeek === day && slotById.get(e.timeSlotId) && slotsOverlap(slotById.get(e.timeSlotId)!, slot));
    const where = `${DAY_SHORT[day]} · ${slot.label}`;
    const subj = subjMap.get(src.subjectId)?.name ?? "Class";
    const busyTeacher = src.teacherId != null && sameTime.some((e) => e.teacherId === src.teacherId);
    const busyRoom = src.roomId != null && sameTime.some((e) => e.roomId === src.roomId);
    if (busyTeacher || busyRoom) {
      notify(`Copied ${subj} to ${where}, but ${[busyTeacher && `${teacherMap.get(src.teacherId!)?.name ?? "the teacher"} is teaching elsewhere`, busyRoom && `${roomMap.get(src.roomId!)?.name ?? "the room"} is in use`].filter(Boolean).join(" and ")} then. See the Conflict Checker.`, "error");
    } else {
      notify(`${existing ? "Replaced with a copy of" : "Copied"} ${subj} to ${where}. Ctrl+Z to undo.`);
    }
  }

  async function runAutofill(ids: number[], mode: "add" | "rebuild") {
    if (!ids.length) return;
    const res = await autofill.mutateAsync({ sectionIds: ids, fresh: mode === "rebuild" });
    const all = ids.length === (sections.data?.length ?? 0);
    setProposal({ ...res, mode, sectionIds: all ? null : ids });
  }

  async function applyProposal() {
    if (!proposal) return;
    setApplying(true);
    try {
      if (proposal.mode === "add") await bulk.mutateAsync(proposal.suggestions);
      else {
        await request("POST", "/entries/replace", { entries: proposal.suggestions, sectionIds: proposal.sectionIds ?? undefined, source: "rebuild" });
        await qc.invalidateQueries({ queryKey: ["entries"] });
        await qc.invalidateQueries({ queryKey: ["conflicts"] });
      }
      setProposal(null);
    } catch (e: any) {
      notify(e?.message ?? String(e), "error");
    } finally {
      setApplying(false);
    }
  }

  const gradeName = (gid: number) => grades.data?.find((g) => g.id === gid)?.name;
  const printArgs = (timeStyle: "default" | "emphasizeTime") => ({ days: allDays, slots: allSlots, entries: entries.data ?? [], blocked: blocked.data ?? [], maps, gradeName, ...printOpts, timeStyle });

  const sectionConflicts = (conflicts.data?.conflicts ?? []).filter(
    (c) => c.sectionId === activeSection || c.entryIds.some((id) => sectionEntries.some((e) => e.id === id)),
  );
  const allIds = orderedSections.map((s) => s.id);
  const busy = autofill.isPending || applying || clear.isPending || bulk.isPending;

  const tools: Tool[] = noData ? [] : [
    { key: "print", label: "Print", icon: <Printer className="size-4" />, groups: [
      { title: "Original format", items: [
        { label: `This section (${activeSectionName})`, disabled: !activeSec, onSelect: () => activeSec && printSections([activeSec], printArgs("default")) },
        { label: "All sections", onSelect: () => printSections(orderedSections, printArgs("default")) },
      ] },
      { title: "Emphasize time periods", items: [
        { label: `This section (${activeSectionName})`, disabled: !activeSec, onSelect: () => activeSec && printSections([activeSec], printArgs("emphasizeTime")) },
        { label: "All sections", onSelect: () => printSections(orderedSections, printArgs("emphasizeTime")) },
      ] },
    ] },
    { key: "export", label: "Export", icon: <FileSpreadsheet className="size-4" />, title: "Every section and teacher as an Excel workbook", onSelect: () => exportScheduleWorkbook({
      sections: orderedSections, teachers: teachers.data ?? [], days: allDays, slots: allSlots, entries: entries.data ?? [],
      gradeNameFor: (s) => gradeName(s.gradeLevelId), maps,
    }) },
    { key: "tools", label: "Tools", icon: <Wrench className="size-4" />, hidden: locked, groups: [{ items: [
      { label: "Copy this schedule to other sections…", hint: "Same subjects and times; teachers from teaching loads", disabled: !sectionEntries.length, onSelect: () => setTool("copy") },
      { label: "Copy one day to another…", hint: "e.g. make Friday the same as Monday", onSelect: () => setTool("copy-day") },
      { label: "Replace a teacher…", hint: "Move all of one teacher's classes to another", onSelect: () => setTool("replace") },
      { label: "Clear schedule…", danger: true, disabled: !totalEntries, onSelect: () => setConfirmClear(true) },
    ] }] },
    { key: "save", label: "Save point", icon: <Save className="size-4" />, hidden: locked, title: "Keep a copy you can go back to", onSelect: () => setSavePointOpen(true) },
  ];

  const autofillBtn = !noData && !locked && (
    <MenuButton label={autofill.isPending ? "Thinking…" : "Auto-fill"} icon={<Wand2 className="size-4" />} variant="default"
      className="bg-brand text-white hover:bg-brand-mid" disabled={busy || !allIds.length} width="sm:w-72" groups={[
        { title: "Fill empty periods", items: [
          { label: `This section (${activeSectionName})`, disabled: activeSection == null, onSelect: () => runAutofill([activeSection!], "add") },
          { label: "All sections", onSelect: () => runAutofill(allIds, "add") },
        ] },
        { title: "Start over (replaces classes)", items: [
          { label: `Rebuild ${activeSectionName}`, hint: "Plans this section again around the others", disabled: activeSection == null, onSelect: () => runAutofill([activeSection!], "rebuild") },
          { label: "Rebuild all sections", hint: "Plans the whole school again", onSelect: () => runAutofill(allIds, "rebuild") },
        ] },
      ]} />
  );

  const conflictPanel = (
    <ConflictPanel conflicts={sectionConflicts} allConflicts={conflicts.data?.conflicts ?? []} collapsible={!wide}
      onRedo={locked ? undefined : () => runAutofill(allIds, "rebuild")}
      onRedoSection={locked || activeSection == null ? undefined : () => runAutofill([activeSection], "rebuild")}
      sectionName={activeSec?.name} redoing={busy} />
  );

  return (
    <Layout>
      <Page>
        <PageHeader title="Class Schedule"
          subtitle={locked ? "Each section's weekly timetable." : "Drag subjects onto the grid, or click a cell. Conflicts are checked as you go."}
          tools={tools} primary={autofillBtn} />

        {loading && <div className="text-muted-foreground">Loading scheduler…</div>}

        {noData && (
          <Card>
            <EmptyState icon={<CalendarDays className="size-12" />} title="No sections yet"
              hint="Set up your grade levels, sections, subjects and time slots first — or load demo data to explore."
              action={!locked && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => seed.mutate()} disabled={seed.isPending} className="bg-brand text-white hover:bg-brand-mid">
                    <Database className="size-4" /> {seed.isPending ? "Loading…" : "Load demo data"}
                  </Button>
                  <Link href="/setup"><Button variant="outline"><Plus className="size-4" /> Go to Setup</Button></Link>
                </div>
              )} />
          </Card>
        )}

        {!loading && !noData && (
          <div className="flex gap-5 xl:gap-6 items-start">
            <SidePicker label="Sections" items={pickItems} value={activeSection} onChange={setActiveSection} searchPlaceholder="Find a section…" />

            <div className="flex-1 min-w-0 space-y-4">
              <PickerBar label="Section" items={pickItems} value={activeSection} onChange={setActiveSection}
                info={activeSec && [activeSec.adviser && `Adviser: ${activeSec.adviser}`, activeSec.homeroomId != null && `Homeroom: ${roomMap.get(activeSec.homeroomId)?.name ?? "?"}`, activeSec.studentCount && `${activeSec.studentCount} students`, `${sectionEntries.length} classes this week`].filter(Boolean).join(" · ")}>
                <Segmented label="Days shown" value={dayFilter} onChange={setDayFilter}
                  options={[{ value: "all" as const, label: "Week" }, ...allDays.map((d) => ({ value: d, label: DAY_SHORT[d] }))]} />
              </PickerBar>

              {!wide && conflictPanel}

              <div className="grid grid-cols-1 min-[1700px]:grid-cols-[minmax(0,1fr)_300px] gap-5 xl:gap-6 items-start">
                <div className="space-y-4 min-w-0">
                  <Card className="overflow-x-auto thin-scroll">
                    <div style={{ minWidth: Math.min(640, 84 + days.length * 120) }}>
                      <div className="grid" style={{ gridTemplateColumns: `minmax(84px, 104px) repeat(${days.length}, minmax(0, 1fr))` }}>
                        <div className="p-3 text-xs font-bold text-muted-foreground uppercase tracking-wide border-b border-border">Time</div>
                        {days.map((d) => <div key={d} className="p-3 text-center text-sm font-display font-bold text-brand-forest border-b border-l border-border">{DAY_FULL[d]}</div>)}
                        {rowSlots.length === 0 && (
                          <div className="p-6 text-sm text-muted-foreground" style={{ gridColumn: `1 / span ${days.length + 1}` }}>No periods for this grade yet. Add them in Setup → Time Slots.</div>
                        )}
                        {rowSlots.map((slot) => (
                          <div key={slot.id} className="contents">
                            <div className={cn("px-3 py-2 border-b border-border flex flex-col justify-center", slot.isBreak && "bg-muted/50")}>
                              <span className="text-xs font-bold text-brand-forest">{slot.label}</span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">{slot.startTime}–{slot.endTime}</span>
                            </div>
                            {days.map((day) => {
                              const cellKey = `${day}:${slot.id}`;
                              if (isNa(day, slot)) return <div key={cellKey} title={`${slot.label} isn't used on ${DAY_FULL[day]}`} className="border-b border-l border-border bg-muted/60 grid place-items-center text-[11px] text-muted-foreground">—</div>;
                              if (slot.isBreak) return <div key={cellKey} className="border-b border-l border-border bg-muted/40 grid place-items-center text-[11px] text-muted-foreground italic py-2">{slot.label}</div>;
                              const entry = entryAt(day, slot.id);
                              const block = isBlocked(day, slot.id);
                              return (
                                <div key={cellKey}
                                  onDragOver={(e) => {
                                    if (locked || !dragData || block) return;
                                    e.preventDefault();
                                    const copy = dragData.kind === "entry" && isCopyKey(e);
                                    e.dataTransfer.dropEffect = dragData.kind === "entry" && !copy ? "move" : "copy";
                                    if (copy !== copyMode) setCopyMode(copy);
                                    setDropCell(cellKey);
                                  }}
                                  onDragLeave={() => setDropCell((c) => (c === cellKey ? null : c))}
                                  onDrop={(e) => { e.preventDefault(); if (!locked) handleDropOnCell(day, slot, dragData?.kind === "entry" && isCopyKey(e)); }}
                                  onClick={() => { if (!locked && !block) setEditor({ day, slotId: slot.id, entry }); }}
                                  title={block ? `Blocked${block.reason ? `: ${block.reason}` : ""}` : undefined}
                                  className={cn("relative border-b border-l border-border min-h-[64px] p-1 transition",
                                    locked ? "cursor-default" : "cursor-pointer",
                                    block ? "bg-[repeating-linear-gradient(45deg,#f0efe8,#f0efe8_6px,#e6e4da_6px,#e6e4da_12px)] cursor-not-allowed" : !locked && "hover:bg-brand-sage/20",
                                    dropCell === cellKey && (copyMode ? "drop-target drop-copy" : "drop-target"))}>
                                  {dropCell === cellKey && dragData?.kind === "entry" && (
                                    <span className={cn("pointer-events-none absolute z-10 top-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-bold shadow", copyMode ? "bg-brand-bright text-white" : "bg-white/90 text-brand-forest")}>
                                      {copyMode ? "+ Copy here" : entry ? "Swap" : "Move here"}
                                    </span>
                                  )}
                                  {block && !entry && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-muted-foreground/70 px-1 text-center">
                                      <Lock className="size-3.5" />
                                      {block.reason && <span className="text-[10px] leading-tight line-clamp-2">{block.reason}</span>}
                                    </div>
                                  )}
                                  {entry && (
                                    <BlockChip subj={subjMap.get(entry.subjectId)} teacherName={entry.teacherId ? teacherMap.get(entry.teacherId)?.name : undefined}
                                      roomName={entry.roomId ? roomMap.get(entry.roomId)?.name : undefined}
                                      hasConflict={conflictEntryIds.has(entry.id)} locked={locked}
                                      onDragStart={() => setDragData({ kind: "entry", subjectId: entry.subjectId, entryId: entry.id, fromDay: entry.dayOfWeek, fromSlotId: entry.timeSlotId })}
                                      onDragEnd={endDrag}
                                      onOpen={() => setEditor({ day, slotId: slot.id, entry })}
                                      onDelete={() => remove.mutate(entry.id)} />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>

                  {!locked && activeSec && (
                    <SubjectPalette subjects={subjects.data ?? []} section={activeSec} entries={sectionEntries} allocations={gradeAllocs}
                      onDragStart={(id) => setDragData({ kind: "subject", subjectId: id })}
                      onDragEnd={endDrag} />
                  )}
                </div>
                {wide && conflictPanel}
              </div>
            </div>
          </div>
        )}
      </Page>

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear schedule?"
        footer={<>
          <Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => { if (activeSection != null) clear.mutate(activeSection); setConfirmClear(false); }} disabled={clear.isPending || !sectionEntries.length}>
            <Trash2 className="size-4" /> Clear this section
          </Button>
          <Button variant="destructive" onClick={() => { clear.mutate(undefined); setConfirmClear(false); }} disabled={clear.isPending}>
            <Trash2 className="size-4" /> Clear all sections
          </Button>
        </>}>
        <p className="text-sm text-foreground">
          <span className="font-semibold">{activeSectionName}</span> has <span className="font-semibold">{sectionEntries.length}</span> {sectionEntries.length === 1 ? "class" : "classes"}; all sections together have <span className="font-semibold">{totalEntries}</span>. You can undo this afterwards.
        </p>
      </Modal>

      {proposal && (
        <ProposalModal proposal={proposal} onClose={() => setProposal(null)} onApply={applyProposal} applying={applying}
          sections={sections.data ?? []} slots={allSlots} currentCount={proposal.sectionIds ? (entries.data ?? []).filter((e) => proposal.sectionIds!.includes(e.sectionId)).length : totalEntries} />
      )}
      {savePointOpen && <SavePointModal onClose={() => setSavePointOpen(false)} />}
      {tool === "copy" && activeSec && <CopyScheduleModal from={activeSec} onClose={() => setTool(null)} />}
      {tool === "copy-day" && <CopyDayModal section={activeSec} days={allDays} onClose={() => setTool(null)} />}
      {tool === "replace" && <ReplaceTeacherModal section={activeSec} onClose={() => setTool(null)} />}
      {editor && activeSec && <CellEditor day={editor.day} slotId={editor.slotId} entry={editor.entry} section={activeSec} onClose={() => setEditor(null)} />}
    </Layout>
  );
}

function useAllocationsFor(gradeId: number | null) {
  const a = useAllocations();
  return useMemo(() => (a.data ?? []).filter((x) => x.gradeLevelId === gradeId), [a.data, gradeId]);
}

/** Subjects to drag onto the grid, with how many periods each still needs this week. */
function SubjectPalette({ subjects, section, entries, allocations, onDragStart, onDragEnd }: {
  subjects: Subject[]; section: Section; entries: ScheduleEntry[]; allocations: { subjectId: number; periodsPerWeek: number }[];
  onDragStart: (id: number) => void; onDragEnd: () => void;
}) {
  const left = (id: number) => {
    const need = allocations.find((a) => a.subjectId === id)?.periodsPerWeek ?? 0;
    return need - entries.filter((e) => e.subjectId === id).length;
  };
  return (
    <Card className="p-4">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
        <span className="max-sm:hidden [@media(hover:none)]:hidden">Drag a subject onto the grid · number = periods still needed for {section.name} · drag a class to move it, hold <kbd className="px-1 py-px rounded border border-border bg-muted text-[10px] font-semibold normal-case">Ctrl</kbd> to copy it</span>
        <span className="hidden max-sm:inline [@media(hover:none)]:inline">Tap a cell in the grid to add or change a class</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {subjects.map((s) => {
          const n = left(s.id);
          return (
            <div key={s.id} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", s.name); onDragStart(s.id); }} onDragEnd={onDragEnd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white cursor-grab active:cursor-grabbing select-none transition hover:scale-105"
              style={{ backgroundColor: s.color || NO_COLOR }}>
              <GripVertical className="size-3.5 opacity-60" />
              {s.name}
              {n !== 0 && <span className={cn("ml-0.5 rounded px-1 text-[11px] font-bold", n > 0 ? "bg-white/25" : "bg-black/30")} title={n > 0 ? `${n} more period(s) needed` : `${-n} period(s) over the allocation`}>{n > 0 ? n : `+${-n}`}</span>}
            </div>
          );
        })}
        {subjects.length === 0 && <span className="text-sm text-muted-foreground">No subjects yet — add some in Setup.</span>}
      </div>
    </Card>
  );
}

function BlockChip({ subj, teacherName, roomName, hasConflict, locked, onDragStart, onDragEnd, onDelete, onOpen }: {
  subj?: Subject; teacherName?: string; roomName?: string; hasConflict: boolean; locked?: boolean;
  onDragStart: () => void; onDragEnd?: () => void; onDelete: () => void; onOpen?: () => void;
}) {
  const name = subj?.name ?? "?";
  return (
    <div draggable={!locked}
      onDragStart={(e) => { if (locked) return; e.stopPropagation(); e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", name); onDragStart(); }}
      onDragEnd={() => onDragEnd?.()}
      title={[name, teacherName ?? "No teacher", roomName, locked ? null : "\nDrag to move · hold Ctrl while dragging to copy"].filter(Boolean).join("\n")}
      className={cn("group h-full w-full rounded-md px-2 py-1.5 text-white text-xs flex flex-col justify-center gap-px relative overflow-hidden",
        locked ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        hasConflict && "ring-2 ring-destructive ring-offset-1")}
      style={{ backgroundColor: subj?.color || NO_COLOR }}
      onClick={(e) => { e.stopPropagation(); if (!locked) onOpen?.(); }}>
      <span className="font-bold leading-[1.15] line-clamp-2 break-words pr-3">{name}</span>
      {teacherName ? <span className="text-white/85 truncate text-[11px] leading-tight">{teacherName}</span> : <span className="text-white/65 italic truncate text-[11px] leading-tight">No teacher</span>}
      {roomName && <span className="text-white/70 truncate text-[10.5px] leading-tight">{roomName}</span>}
      {hasConflict && <AlertTriangle className="absolute top-1 right-1 size-3 text-white" />}
      {!locked && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Remove class"
          className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition bg-black/30 rounded p-0.5 hover:bg-black/50">
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function ConflictPanel({ conflicts, allConflicts, onRedo, onRedoSection, sectionName, redoing, collapsible }: {
  conflicts: Conflict[]; allConflicts?: Conflict[]; onRedo?: () => void; onRedoSection?: () => void; sectionName?: string; redoing?: boolean; collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isDouble = (c: Conflict) => c.type === "teacher_double" || c.type === "section_double" || c.type === "room_double";
  const errors = conflicts.filter((c) => c.severity === "error");
  const warnings = conflicts.filter((c) => c.severity === "warning");
  const doubleBookings = (allConflicts ?? []).filter(isDouble);
  const sectionDoubles = conflicts.filter(isDouble);
  const totalErrors = (allConflicts ?? []).filter((c) => c.severity === "error").length;
  const clear = errors.length === 0 && warnings.length === 0;
  const summary = clear ? `All clear for ${sectionName ?? "this section"}` : [errors.length && `${errors.length} error${errors.length !== 1 ? "s" : ""}`, warnings.length && `${warnings.length} warning${warnings.length !== 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const body = (
    <>
      {onRedo && doubleBookings.length > 0 && (
        <div className="mb-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-xs text-destructive font-medium mb-2 flex items-start gap-1.5">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            {doubleBookings.length} double-booking{doubleBookings.length !== 1 && "s"} across the schedule.
          </p>
          <div className="flex flex-wrap gap-2">
            {onRedoSection && sectionDoubles.length > 0 && (
              <Button size="sm" onClick={onRedoSection} disabled={redoing} className="bg-destructive text-white hover:bg-destructive/90"><Wand2 className="size-4" /> Rebuild {sectionName ?? "this section"}</Button>
            )}
            <Button size="sm" onClick={onRedo} disabled={redoing} className="bg-destructive text-white hover:bg-destructive/90"><Wand2 className="size-4" /> Rebuild all sections</Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">You'll see the new plan before anything changes, and you can undo it.</p>
        </div>
      )}
      {clear && <p className="text-sm text-muted-foreground">No double-bookings or allocation issues in this section.</p>}
      <div className={cn(collapsible && "grid gap-x-4 lg:grid-cols-2")}>
        {errors.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-bold text-destructive uppercase tracking-wide mb-1.5">{errors.length} Error{errors.length !== 1 && "s"}</p>
            <div className="space-y-1.5">
              {errors.map((c, i) => <div key={i} className="text-xs p-2 rounded-lg bg-destructive/10 text-destructive flex items-start gap-1.5"><AlertTriangle className="size-3.5 mt-0.5 shrink-0" />{c.message}</div>)}
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mb-1">
            <p className="text-xs font-bold text-[#8a6400] uppercase tracking-wide mb-1.5">{warnings.length} Warning{warnings.length !== 1 && "s"}</p>
            <div className="space-y-1.5">
              {warnings.map((c, i) => <div key={i} className="text-xs p-2 rounded-lg bg-warning/10 text-[#8a6400] flex items-start gap-1.5"><AlertTriangle className="size-3.5 mt-0.5 shrink-0" />{c.message}</div>)}
            </div>
          </div>
        )}
      </div>
    </>
  );
  const icon = clear ? <CheckCircle2 className="size-5 text-brand-bright shrink-0" /> : <AlertTriangle className={cn("size-5 shrink-0", errors.length ? "text-destructive" : "text-warning")} />;

  if (collapsible) {
    return (
      <Card className={cn("overflow-hidden", errors.length ? "border-destructive/40" : "")}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={clear && !doubleBookings.length}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/40 disabled:hover:bg-transparent">
          {icon}
          <span className="font-display font-bold text-brand-forest text-sm">Conflict Checker</span>
          <span className={cn("text-sm truncate", errors.length ? "text-destructive font-semibold" : warnings.length ? "text-[#8a6400] font-semibold" : "text-muted-foreground")}>{summary}</span>
          {totalErrors > 0 && <span className="hidden sm:inline text-[11px] text-muted-foreground">· {totalErrors} school-wide</span>}
          {!(clear && !doubleBookings.length) && <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition", open && "rotate-180")} />}
        </button>
        {open && <div className="px-4 pb-3 pt-1 border-t border-border max-h-[45vh] overflow-y-auto thin-scroll">{body}</div>}
      </Card>
    );
  }
  return (
    <Card className="p-4 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto thin-scroll">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-display font-bold text-brand-forest">Conflict Checker</h3>
        {totalErrors > 0 && <span className="ml-auto text-[11px] text-muted-foreground">{totalErrors} school-wide</span>}
      </div>
      {body}
    </Card>
  );
}

function ProposalModal({ proposal, onClose, onApply, applying, sections, slots, currentCount }: {
  proposal: Proposal; onClose: () => void; onApply: () => void; applying: boolean; sections: Section[]; slots: TimeSlot[]; currentCount: number;
}) {
  const { maps } = useLookups();
  const errors = proposal.projectedConflicts.filter((c) => c.severity === "error");
  const secName = (id: number) => sections.find((s) => s.id === id)?.name ?? "?";
  const bySection = useMemo(() => {
    const m = new Map<number, number>();
    proposal.suggestions.forEach((s) => m.set(s.sectionId, (m.get(s.sectionId) ?? 0) + 1));
    return m;
  }, [proposal.suggestions]);
  const single = bySection.size <= 1 && (proposal.sectionIds?.length ?? 2) === 1;
  const n = proposal.suggestions.length;
  const rebuild = proposal.mode === "rebuild";
  return (
    <Modal open onClose={onClose} wide title={rebuild ? "Rebuild plan" : "Auto-fill plan"}
      footer={<>
        <Button variant="outline" onClick={onClose}>Discard</Button>
        <Button onClick={onApply} disabled={applying || (!n && !rebuild)} className="bg-brand text-white hover:bg-brand-mid">
          <CheckCircle2 className="size-4" /> {applying ? "Applying…" : rebuild ? `Replace with ${n} classes` : `Add ${n} classes`}
        </Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {rebuild
            ? <>The {proposal.sectionIds?.length === 1 ? "section's" : "school's"} <b>{currentCount}</b> current classes will be replaced by <b>{n}</b> newly planned ones. Teaching loads, homerooms, rooms, double periods, teacher availability and blocked times are respected.</>
            : <>Found places for <b>{n}</b> more class{n !== 1 && "es"} in empty periods, following allocations, teaching loads, rooms and availability.</>}
        </p>
        {proposal.unplaced.length > 0 && (
          <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-sm">
            <p className="font-semibold text-[#8a6400] flex items-center gap-1.5 mb-1.5"><Info className="size-4" /> Could not place {proposal.unplaced.reduce((a, u) => a + u.periods, 0)} period(s)</p>
            <ul className="space-y-1 max-h-40 overflow-y-auto thin-scroll text-xs text-foreground">
              {proposal.unplaced.map((u, i) => (
                <li key={i}><b>{secName(u.sectionId)} · {maps.subjMap.get(u.subjectId)?.name ?? "?"}</b> — {u.periods} period{u.periods !== 1 && "s"}: {u.reason}</li>
              ))}
            </ul>
          </div>
        )}
        {proposal.teacherless > 0 && (
          <p className="text-xs p-2 rounded-lg bg-muted text-foreground">{proposal.teacherless} class{proposal.teacherless !== 1 && "es"} will have no teacher yet (no qualified teacher was free). Set teaching loads or assign them afterwards.</p>
        )}
        {errors.length > 0 && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>The schedule would still have {errors.length} conflict{errors.length !== 1 && "s"}{rebuild ? "" : " (some may already exist)"}. You can apply and fix them by hand.</span>
          </div>
        )}
        {single ? (
          <div className="space-y-1.5 max-h-72 overflow-y-auto thin-scroll">
            {proposal.suggestions.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek || (slots.find((s) => s.id === a.timeSlotId)?.startTime ?? "").localeCompare(slots.find((s) => s.id === b.timeSlotId)?.startTime ?? "")).map((s, i) => {
              const subj = maps.subjMap.get(s.subjectId);
              return (
                <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm p-2 rounded-lg bg-muted/50">
                  <span className="size-3 rounded" style={{ backgroundColor: subj?.color || NO_COLOR }} />
                  <span className="font-semibold">{subj?.name}</span>
                  <span className="text-muted-foreground">{DAY_SHORT[s.dayOfWeek]} · {slots.find((sl) => sl.id === s.timeSlotId)?.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{[s.teacherId ? maps.teacherMap.get(s.teacherId)?.name : "No teacher", s.roomId ? maps.roomMap.get(s.roomId)?.name : null].filter(Boolean).join(" · ")}</span>
                </div>
              );
            })}
            {n === 0 && <p className="text-sm text-muted-foreground">Nothing to add — allocations are already met or there are no free periods.</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-60 overflow-y-auto thin-scroll">
            {[...bySection.entries()].map(([id, count]) => (
              <div key={id} className="text-sm px-2.5 py-1.5 rounded-lg bg-muted/50 flex justify-between gap-2"><span className="font-semibold truncate">{secName(id)}</span><span className="text-muted-foreground">{count}</span></div>
            ))}
            {n === 0 && <p className="text-sm text-muted-foreground col-span-full">Nothing to add — allocations are already met or there are no free periods.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function CellEditor({ day, slotId, entry, section, onClose }: { day: number; slotId: number; entry?: ScheduleEntry; section: Section; onClose: () => void }) {
  const subjects = useSubjects();
  const teachers = useTeachers();
  const rooms = useRooms();
  const slots = useTimeSlots();
  const entries = useEntries();
  const loads = useTeachingLoads();
  const unav = useUnavailability();
  const allocations = useAllocationsFor(section.gradeLevelId);
  const { create, update, remove } = useEntryMutations();
  const confirm = useConfirm();
  const gradeId = section.gradeLevelId;

  const left = (id: number) => (allocations.find((a) => a.subjectId === id)?.periodsPerWeek ?? 0) - (entries.data ?? []).filter((e) => e.sectionId === section.id && e.subjectId === id && e.id !== entry?.id).length;
  const subjectList = useMemo(() => (subjects.data ?? []).slice().sort((a, b) => Number(left(b.id) > 0) - Number(left(a.id) > 0)), [subjects.data, allocations, entries.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstSubject = entry?.subjectId ?? subjectList.find((s) => left(s.id) > 0)?.id ?? subjectList[0]?.id ?? 0;

  const [subjectId, setSubjectId] = useState(firstSubject);
  const pick = (sid: number) => ({
    teacherId: defaultTeacher({ loads: loads.data, teachers: teachers.data ?? [], entries: entries.data, sectionId: section.id, subjectId: sid, gradeLevelId: gradeId }),
    roomId: defaultRoom({ section, subject: subjects.data?.find((s) => s.id === sid), rooms: rooms.data ?? [] }),
  });
  const [teacherId, setTeacherId] = useState<number | null>(entry ? entry.teacherId : pick(firstSubject).teacherId);
  const [roomId, setRoomId] = useState<number | null>(entry ? entry.roomId : pick(firstSubject).roomId);

  const slotById = useMemo(() => new Map((slots.data ?? []).map((s) => [s.id, s])), [slots.data]);
  const slot = slotById.get(slotId);
  // Other classes at an overlapping time on this day.
  const sameTime = useMemo(() => (entries.data ?? []).filter((e) => e.id !== entry?.id && e.dayOfWeek === day && slot && slotById.get(e.timeSlotId) && slotsOverlap(slotById.get(e.timeSlotId)!, slot)), [entries.data, entry, day, slot, slotById]);
  const loadTeacher = loads.data?.find((l) => l.sectionId === section.id && l.subjectId === subjectId)?.teacherId;

  const qualified = eligibleTeachers(teachers.data ?? [], subjectId, gradeId);
  const others = (teachers.data ?? []).filter((t) => !qualified.includes(t));
  const teacherNote = (id: number) => {
    const bits: string[] = [];
    if (id === loadTeacher) bits.push("teaching load");
    if (sameTime.some((e) => e.teacherId === id)) bits.push("busy");
    if (slot && isUnavailable(unav.data, id, day, slot, slotById)) bits.push("unavailable");
    return bits.length ? ` (${bits.join(", ")})` : "";
  };
  const roomNote = (id: number) => {
    const r = rooms.data?.find((x) => x.id === id);
    const bits: string[] = [];
    if (id === section.homeroomId) bits.push("homeroom");
    if (sameTime.some((e) => e.roomId === id)) bits.push("in use");
    if (r?.capacity && section.studentCount && r.capacity < section.studentCount) bits.push(`only ${r.capacity} seats`);
    return bits.length ? ` (${bits.join(", ")})` : r?.capacity ? ` · ${r.capacity} seats` : "";
  };

  function changeSubject(sid: number) {
    setSubjectId(sid);
    const d = pick(sid);
    setTeacherId(d.teacherId);
    setRoomId(d.roomId);
  }

  function save() {
    if (entry) update.mutate({ id: entry.id, subjectId, teacherId, roomId }, { onSuccess: onClose });
    else create.mutate({ sectionId: section.id, dayOfWeek: day, timeSlotId: slotId, subjectId, teacherId, roomId }, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={`${section.name} · ${DAY_SHORT[day]} · ${slot?.label ?? ""}`}
      footer={<>
        {entry && <Button variant="destructive" className="mr-auto" onClick={async () => { if (await confirm({ title: "Remove class?", message: "This class will be removed from the timetable. You can undo this afterwards.", confirmLabel: "Remove" })) remove.mutate(entry.id, { onSuccess: onClose }); }}><Trash2 className="size-4" /> Remove</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!subjectId || create.isPending || update.isPending} className="bg-brand text-white hover:bg-brand-mid">Save</Button>
      </>}>
      <Field label="Subject">
        <Select value={subjectId} onChange={(e) => changeSubject(Number(e.target.value))}>
          {subjectList.map((s) => { const n = left(s.id); return <option key={s.id} value={s.id}>{s.name}{n > 0 ? ` — ${n} more needed` : ""}</option>; })}
        </Select>
      </Field>
      <Field label="Teacher" hint={teacherId != null && teacherNote(teacherId).includes("busy") ? "This teacher already has a class at this time." : undefined}>
        <Select value={teacherId ?? ""} onChange={(e) => setTeacherId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— None —</option>
          <optgroup label="Teaches this subject & grade">
            {qualified.map((t) => <option key={t.id} value={t.id}>{t.name}{teacherNote(t.id)}</option>)}
          </optgroup>
          {others.length > 0 && <optgroup label="Other teachers">{others.map((t) => <option key={t.id} value={t.id}>{t.name}{teacherNote(t.id)}</option>)}</optgroup>}
        </Select>
      </Field>
      <Field label="Room">
        <Select value={roomId ?? ""} onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— None —</option>
          {(rooms.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}{roomNote(r.id)}</option>)}
        </Select>
      </Field>
      {entry && <CopyTo entry={entry} section={section} onDone={onClose} />}
    </Modal>
  );
}

/** "Copy this class to…" inside the class dialog — the keyboard-free way to Ctrl+drag. */
function CopyTo({ entry, section, onDone }: { entry: ScheduleEntry; section: Section; onDone: () => void }) {
  const slots = useTimeSlots();
  const entries = useEntries();
  const blocked = useBlockedTimes();
  const settings = useSettings();
  const subjects = useSubjects();
  const { create, update } = useEntryMutations();
  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const [day, setDay] = useState(entry.dayOfWeek);
  const [slotId, setSlotId] = useState<number | "">("");
  const options = gradeSlots(slots.data ?? [], section.gradeLevelId)
    .filter((s) => !s.isBreak && slotApplies(s, section.gradeLevelId, day) && !isBlockedFor(blocked.data, section.id, section.gradeLevelId, day, s.id) && !(day === entry.dayOfWeek && s.id === entry.timeSlotId));
  const at = (sid: number) => (entries.data ?? []).find((e) => e.sectionId === section.id && e.dayOfWeek === day && e.timeSlotId === sid);
  const subjName = (id: number) => subjects.data?.find((x) => x.id === id)?.name ?? "a class";
  const target = slotId === "" ? undefined : at(slotId);
  const copy = () => {
    if (slotId === "") return;
    const vals = { subjectId: entry.subjectId, teacherId: entry.teacherId, roomId: entry.roomId };
    const done = () => { notify(`Copied ${subjName(entry.subjectId)} to ${DAY_SHORT[day]} · ${slots.data?.find((x) => x.id === slotId)?.label}.`); onDone(); };
    if (target) update.mutate({ id: target.id, ...vals }, { onSuccess: done });
    else create.mutate({ sectionId: section.id, dayOfWeek: day, timeSlotId: slotId, ...vals }, { onSuccess: done });
  };
  return (
    <div className="mt-2 pt-4 border-t border-border">
      <p className="text-sm font-semibold mb-0.5 flex items-center gap-1.5"><CopyIcon className="size-4 text-brand" /> Copy this class to another period</p>
      <p className="text-xs text-muted-foreground mb-2.5">Same subject, teacher and room. On a computer you can also hold Ctrl while dragging the class.</p>
      <div className="grid grid-cols-[110px_1fr_auto] gap-2">
        <Select value={day} onChange={(e) => { setDay(Number(e.target.value)); setSlotId(""); }} aria-label="Day">{days.map((d) => <option key={d} value={d}>{DAY_SHORT[d]}</option>)}</Select>
        <Select value={slotId} onChange={(e) => setSlotId(e.target.value ? Number(e.target.value) : "")} aria-label="Period">
          <option value="">— Period —</option>
          {options.map((s) => { const ex = at(s.id); return <option key={s.id} value={s.id}>{s.label} {s.startTime}{ex ? ` (replaces ${subjName(ex.subjectId)})` : ""}</option>; })}
        </Select>
        <Button variant="outline" onClick={copy} disabled={slotId === "" || create.isPending || update.isPending}>Copy</Button>
      </div>
    </div>
  );
}

// ---------------- bulk tools ----------------

function CopyScheduleModal({ from, onClose }: { from: Section; onClose: () => void }) {
  const sections = useSections();
  const grades = useGradeLevels();
  const act = useAct();
  const [targets, setTargets] = useState<number[]>([]);
  const [teachers, setTeachers] = useState<"loads" | "same" | "none">("loads");
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const others = (sections.data ?? []).filter((s) => s.id !== from.id);
  const sameGrade = others.filter((s) => s.gradeLevelId === from.gradeLevelId);
  const run = async () => {
    setBusy(true);
    const r = await act<{ created: number; skipped: number }>("POST", "/tools/copy-schedule", { fromSectionId: from.id, toSectionIds: targets, teachers, replace }, {
      success: (r) => `Copied ${r.created} classes${r.skipped ? ` (${r.skipped} skipped: period not used or already taken)` : ""}.`,
    });
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Copy ${from.name}'s schedule`} wide
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={run} disabled={busy || !targets.length} className="bg-brand text-white hover:bg-brand-mid">{busy ? "Copying…" : `Copy to ${targets.length} section${targets.length === 1 ? "" : "s"}`}</Button></>}>
      <Field label="Copy to">
        <div className="space-y-2">
          {sameGrade.length > 0 && <button type="button" className="text-xs text-brand hover:underline" onClick={() => setTargets(sameGrade.map((s) => s.id))}>All other {grades.data?.find((g) => g.id === from.gradeLevelId)?.name ?? "same-grade"} sections</button>}
          <Chips options={others.map((s) => ({ id: s.id, label: s.name }))} value={targets} onChange={setTargets} />
        </div>
      </Field>
      <Field label="Teachers">
        <Select value={teachers} onChange={(e) => setTeachers(e.target.value as any)}>
          <option value="loads">From each section's teaching loads (recommended)</option>
          <option value="same">Same teachers as {from.name} (will double-book them)</option>
          <option value="none">No teachers — assign later</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="size-4 accent-brand" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        Replace their current classes (otherwise only fill empty periods)
      </label>
    </Modal>
  );
}

function CopyDayModal({ section, days, onClose }: { section?: Section; days: number[]; onClose: () => void }) {
  const sections = useSections();
  const act = useAct();
  const [fromDay, setFromDay] = useState(days[0] ?? 1);
  const [toDay, setToDay] = useState(days[days.length - 1] ?? 5);
  const [scope, setScope] = useState<"section" | "grade" | "all">(section ? "section" : "all");
  const [replace, setReplace] = useState(true);
  const ids = scope === "section" && section ? [section.id] : scope === "grade" && section ? (sections.data ?? []).filter((s) => s.gradeLevelId === section.gradeLevelId).map((s) => s.id) : (sections.data ?? []).map((s) => s.id);
  const run = async () => {
    const r = await act<{ created: number; skipped: number }>("POST", "/tools/copy-day", { sectionIds: ids, fromDay, toDay, replace }, {
      success: (r) => `Copied ${r.created} classes to ${DAY_FULL[toDay]}${r.skipped ? ` (${r.skipped} skipped)` : ""}.`,
    });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Copy one day to another"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={run} disabled={fromDay === toDay} className="bg-brand text-white hover:bg-brand-mid">Copy</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><Select value={fromDay} onChange={(e) => setFromDay(Number(e.target.value))}>{days.map((d) => <option key={d} value={d}>{DAY_FULL[d]}</option>)}</Select></Field>
        <Field label="To"><Select value={toDay} onChange={(e) => setToDay(Number(e.target.value))}>{days.map((d) => <option key={d} value={d}>{DAY_FULL[d]}</option>)}</Select></Field>
      </div>
      <Field label="For">
        <Select value={scope} onChange={(e) => setScope(e.target.value as any)}>
          {section && <option value="section">{section.name} only</option>}
          {section && <option value="grade">Every section in its grade</option>}
          <option value="all">All sections</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="size-4 accent-brand" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        Replace classes already on {DAY_FULL[toDay]}
      </label>
    </Modal>
  );
}

function ReplaceTeacherModal({ section, onClose }: { section?: Section; onClose: () => void }) {
  const teachers = useTeachers();
  const entries = useEntries();
  const act = useAct();
  const list = teachers.data ?? [];
  const [fromId, setFromId] = useState<number | null>(list[0]?.id ?? null);
  const [toId, setToId] = useState<number | "none" | null>(null);
  const [onlySection, setOnlySection] = useState(false);
  const [includeLoads, setIncludeLoads] = useState(true);
  const count = (entries.data ?? []).filter((e) => e.teacherId === fromId && (!onlySection || e.sectionId === section?.id)).length;
  const run = async () => {
    const r = await act<{ classes: number; loads: number }>("POST", "/tools/replace-teacher", { fromTeacherId: fromId, toTeacherId: toId === "none" ? null : toId, sectionIds: onlySection && section ? [section.id] : undefined, includeLoads }, {
      success: (r) => `Changed ${r.classes} classes${r.loads ? ` and ${r.loads} teaching loads` : ""}.`,
    });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Replace a teacher"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={run} disabled={fromId == null || toId == null || toId === fromId} className="bg-brand text-white hover:bg-brand-mid">Replace</Button></>}>
      <Field label="Teacher to replace" hint={`${count} class${count === 1 ? "" : "es"}`}>
        <Select value={fromId ?? ""} onChange={(e) => setFromId(Number(e.target.value))}>{list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      </Field>
      <Field label="Give their classes to">
        <Select value={toId ?? ""} onChange={(e) => setToId(e.target.value === "none" ? "none" : e.target.value ? Number(e.target.value) : null)}>
          <option value="">— Choose —</option>
          <option value="none">Nobody (leave without a teacher)</option>
          {list.filter((t) => t.id !== fromId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      {section && (
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
          <input type="checkbox" className="size-4 accent-brand" checked={onlySection} onChange={(e) => setOnlySection(e.target.checked)} />
          Only in {section.name}
        </label>
      )}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="size-4 accent-brand" checked={includeLoads} onChange={(e) => setIncludeLoads(e.target.checked)} />
        Also change their teaching loads
      </label>
    </Modal>
  );
}
