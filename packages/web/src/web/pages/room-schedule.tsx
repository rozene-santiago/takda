import { Link } from "wouter";
import { useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader, type Tool } from "@/components/page";
import { SidePicker, PickerBar, Segmented, type PickItem } from "@/components/side-picker";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useRooms, useTimeSlots, useEntries, useSettings, useSections, useLocked, useLookups, useConflicts, useBlockedTimes } from "@/lib/hooks";
import { DAY_SHORT, DAY_FULL } from "@/lib/types";
import type { BlockedTime, Room, ScheduleEntry, TimeSlot } from "@/lib/types";
import { DoorOpen, Printer, AlertTriangle, LayoutGrid, Ban } from "lucide-react";
import { cn, NO_COLOR } from "@/lib/utils";
import { printRooms, roomSlots, roomTable, pageHtml } from "@/lib/print";
import { savePdfZip } from "@/lib/bundles";
import { sortSlots, todayIso, globalBlockAt, blockLabel } from "@/lib/sched";

export default function RoomSchedulePage() {
  const rooms = useRooms();
  const slots = useTimeSlots();
  const entries = useEntries();
  const settings = useSettings();
  const sections = useSections();
  const conflicts = useConflicts();
  const blocked = useBlockedTimes();
  const locked = useLocked();
  const { maps, printOpts } = useLookups();
  const [view, setView] = useState<"room" | "day">("room");
  const [active, setActive] = useState<number | null>(null);
  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const [day, setDay] = useState<number>(days[0] ?? 1);
  const [dayFilter, setDayFilter] = useState<number | "all">("all");
  const dayDefaulted = useRef(false);
  useEffect(() => {
    if (dayDefaulted.current || !settings.data) return;
    dayDefaulted.current = true;
    const today = ((new Date().getDay() + 6) % 7) + 1;
    const d = days.includes(today) ? today : days[0] ?? 1;
    setDay(d);
    if (window.matchMedia("(max-width: 639px)").matches) setDayFilter(d);
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = rooms.data ?? [];
  const all = entries.data ?? [];
  const allSlots = slots.data ?? [];
  const room = list.find((r) => r.id === active);
  const loading = rooms.isLoading || slots.isLoading || entries.isLoading;
  const roomClashIds = useMemo(() => new Set((conflicts.data?.conflicts ?? []).filter((c) => c.type === "room_double" || c.type === "room_capacity" || c.type === "room_type").flatMap((c) => c.entryIds)), [conflicts.data]);
  const common = (timeStyle: "default" | "emphasizeTime" = "default") => ({ days, slots: allSlots, entries: all, blocked: blocked.data ?? [], maps, ...printOpts, timeStyle });

  // Rooms with how full they are (periods in use out of periods available).
  const pickItems: PickItem[] = useMemo(() => list.map((r) => {
    const rows = roomSlots(r, allSlots, all, maps.sectionMap);
    const avail = days.reduce((n, d) => n + rows.filter((s) => !s.isBreak && (!s.days?.length || s.days.includes(d))).length, 0);
    const used = new Set(all.filter((e) => e.roomId === r.id).map((e) => `${e.dayOfWeek}:${e.timeSlotId}`)).size;
    const clash = all.some((e) => e.roomId === r.id && roomClashIds.has(e.id));
    return { id: r.id, label: r.name, sub: r.capacity ? `${r.capacity} seats` : undefined, badge: avail ? `${Math.round((used / avail) * 100)}%` : undefined, tone: clash ? "error" : undefined } satisfies PickItem;
  }), [list, allSlots, all, maps.sectionMap, days, roomClashIds]);

  useEffect(() => { if (pickItems.length && (active == null || !pickItems.some((r) => r.id === active))) setActive(pickItems[0].id); }, [pickItems, active]);

  const tools: Tool[] = list.length ? [
    { key: "print", label: "Print", icon: <Printer className="size-4" />, groups: [
      { title: room ? room.name : "This room", items: [
        { label: "Original format", disabled: !room, onSelect: () => room && printRooms([room], common("default")) },
        { label: "Emphasize time periods", disabled: !room, onSelect: () => room && printRooms([room], common("emphasizeTime")) },
      ] },
      { title: "All rooms", items: [
        { label: "Print all rooms", onSelect: () => printRooms(list, common()) },
        { label: "PDFs, one per room (.zip)", onSelect: () => savePdfZip(`Room schedules ${todayIso()}.zip`, list.map((r) => ({ title: r.name, html: pageHtml(roomTable(r, common()), printOpts, `Room: ${r.name}`) })), printOpts.rowHeight) },
      ] },
    ] },
  ] : [];

  const viewSwitch = (
    <Segmented label="View" value={view} onChange={setView} options={[
      { value: "room" as const, label: <><DoorOpen className="size-4" /> One room</> },
      { value: "day" as const, label: <><LayoutGrid className="size-4" /> Free rooms</> },
    ]} />
  );

  return (
    <Layout>
      <Page>
        <PageHeader title="Room Schedule" subtitle="What is happening in each room, and which rooms are free." tools={tools} />

        {loading && <p className="text-muted-foreground">Loading…</p>}
        {!loading && list.length === 0 && (
          <Card><EmptyState icon={<DoorOpen className="size-12" />} title="No rooms yet" hint="Add rooms (with how many students fit) in Setup → Rooms, then give classes a room."
            action={!locked && <Link href="/setup"><Button className="bg-brand text-white hover:bg-brand-mid">Go to Setup</Button></Link>} /></Card>
        )}

        {!loading && list.length > 0 && view === "room" && (
          <div className="flex gap-5 xl:gap-6 items-start">
            <SidePicker label="Rooms" items={pickItems} value={active} onChange={setActive} searchPlaceholder="Find a room…" />
            <div className="flex-1 min-w-0 space-y-4">
              <PickerBar label="Room" items={pickItems} value={active} onChange={setActive}
                info={room && [room.capacity ? `${room.capacity} seats` : null, (sections.data ?? []).filter((s) => s.homeroomId === room.id).length ? `Homeroom of ${(sections.data ?? []).filter((s) => s.homeroomId === room.id).map((s) => s.name).join(", ")}` : null].filter(Boolean).join(" · ")}>
                <Segmented label="Days shown" value={dayFilter} onChange={setDayFilter} options={[{ value: "all" as const, label: "Week" }, ...days.map((d) => ({ value: d, label: DAY_SHORT[d] }))]} />
                {viewSwitch}
              </PickerBar>
              {room && <RoomWeek room={room} days={dayFilter === "all" ? days : days.filter((d) => d === dayFilter)} allDays={days} entries={all} maps={maps} slots={allSlots} clashIds={roomClashIds} blocked={blocked.data} />}
            </div>
          </div>
        )}

        {!loading && list.length > 0 && view === "day" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
              <Segmented label="Day" value={day} onChange={setDay} options={days.map((d) => ({ value: d, label: DAY_FULL[d] }))} />
              <p className="text-sm text-muted-foreground">Empty cells are free rooms.</p>
              <div className="lg:ml-auto">{viewSwitch}</div>
            </div>
            <FreeRooms rooms={list} day={day} entries={all} maps={maps} slots={allSlots} />
          </div>
        )}
      </Page>
    </Layout>
  );
}

function RoomWeek({ room, days, allDays, entries, maps, slots, clashIds, blocked }: {
  room: Room; days: number[]; allDays: number[]; entries: ScheduleEntry[]; maps: ReturnType<typeof useLookups>["maps"]; slots: TimeSlot[]; clashIds: Set<number>; blocked?: BlockedTime[];
}) {
  const rows = roomSlots(room, slots, entries, maps.sectionMap);
  const mine = entries.filter((e) => e.roomId === room.id);
  const usable = allDays.reduce((n, d) => n + rows.filter((s) => !s.isBreak && (!s.days?.length || s.days.includes(d))).length, 0);
  const usedCells = new Set(mine.map((e) => `${e.dayOfWeek}:${e.timeSlotId}`)).size;
  const bySubject = mine.reduce((acc, e) => acc.set(e.subjectId, (acc.get(e.subjectId) ?? 0) + 1), new Map<number, number>());
  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div><p className="text-[11px] text-muted-foreground leading-tight">Seats</p><p className="text-lg font-bold text-brand-forest leading-tight">{room.capacity ?? "—"}</p></div>
          <div><p className="text-[11px] text-muted-foreground leading-tight">In use</p><p className="text-lg font-bold text-brand-forest leading-tight">{usable ? Math.round((usedCells / usable) * 100) : 0}% <span className="text-xs font-medium text-muted-foreground">({usedCells} of {usable} periods)</span></p></div>
          {bySubject.size > 0 && <p className="text-xs text-muted-foreground min-w-0">{[...bySubject.entries()].sort((a, b) => b[1] - a[1]).map(([sid, n]) => `${maps.subjMap.get(sid)?.name ?? "?"} ${n}`).join(" · ")}</p>}
          {mine.some((e) => clashIds.has(e.id)) && <p className="text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive">Some classes here clash, don't fit, or need a different kind of room.</p>}
        </div>
      </Card>
      <Card className="overflow-x-auto thin-scroll">
        <div style={{ minWidth: Math.min(640, 84 + days.length * 120) }}>
          <div className="grid" style={{ gridTemplateColumns: `minmax(84px, 104px) repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="p-3 text-xs font-bold text-muted-foreground uppercase tracking-wide border-b border-border">Time</div>
            {days.map((d) => <div key={d} className="p-3 text-center text-sm font-display font-bold text-brand-forest border-b border-l border-border">{DAY_FULL[d]}</div>)}
            {rows.map((slot) => (
              <div key={slot.id} className="contents">
                <div className={cn("px-3 py-2 border-b border-border flex flex-col justify-center", slot.isBreak && "bg-muted/50")}>
                  <span className="text-xs font-bold text-brand-forest">{slot.label}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{slot.startTime}–{slot.endTime}</span>
                </div>
                {days.map((d) => {
                  const here = mine.filter((e) => e.dayOfWeek === d && e.timeSlotId === slot.id);
                  if (!here.length && slot.isBreak) return <div key={d} className="border-b border-l border-border bg-muted/40 grid place-items-center text-[11px] text-muted-foreground italic py-2">{slot.label}</div>;
                  if (!here.length && slot.days?.length && !slot.days.includes(d)) return <div key={d} className="border-b border-l border-border bg-muted/60 grid place-items-center text-[11px] text-muted-foreground">—</div>;
                  const block = !here.length ? globalBlockAt(blocked, d, slot.id) : undefined;
                  if (block) return (
                    <div key={d} title={blockLabel(block)} className="border-b border-l border-border min-h-[64px] bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_12px)] grid place-items-center px-1 text-center text-[11px] text-muted-foreground font-medium">
                      <span className="flex items-center gap-1"><Ban className="size-3 shrink-0" /> <span className="line-clamp-2">{blockLabel(block)}</span></span>
                    </div>
                  );
                  const e = here[0];
                  const subj = e ? maps.subjMap.get(e.subjectId) : undefined;
                  const clash = here.length > 1 || here.some((x) => clashIds.has(x.id));
                  return (
                    <div key={d} className="relative border-b border-l border-border min-h-[64px] p-1">
                      {e && (
                        <div className={cn("relative h-full w-full rounded-md px-2 py-1.5 text-white text-xs flex flex-col justify-center gap-px overflow-hidden", clash && "ring-2 ring-destructive ring-offset-1")} style={{ backgroundColor: subj?.color || NO_COLOR }}
                          title={[subj?.name, here.map((x) => maps.sectionMap.get(x.sectionId)?.name).join(", "), e.teacherId != null ? maps.teacherMap.get(e.teacherId)?.name : null].filter(Boolean).join("\n")}>
                          <span className="font-bold leading-[1.15] line-clamp-2 break-words pr-3">{subj?.name ?? "?"}</span>
                          <span className="text-white/85 truncate text-[11px] leading-tight">{here.map((x) => maps.sectionMap.get(x.sectionId)?.name).join(", ")}</span>
                          {e.teacherId != null && <span className="text-white/70 truncate text-[10.5px] leading-tight">{maps.teacherMap.get(e.teacherId)?.name}</span>}
                          {clash && <AlertTriangle className="absolute top-1 right-1 size-3 text-white" />}
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
    </div>
  );
}

/** One day: every room down the side, every period across; empty cells are free. */
function FreeRooms({ rooms, day, entries, maps, slots }: { rooms: Room[]; day: number; entries: ScheduleEntry[]; maps: ReturnType<typeof useLookups>["maps"]; slots: TimeSlot[] }) {
  const cols = sortSlots(slots).filter((s) => !s.isBreak && (!s.days?.length || s.days.includes(day)));
  const today = entries.filter((e) => e.dayOfWeek === day);
  return (
    <Card className="overflow-x-auto thin-scroll p-0">
      <table className="w-full border-collapse min-w-[640px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-brand-forest text-white text-left text-xs font-bold uppercase tracking-wide px-3 py-2.5 min-w-[130px]">Room</th>
            {cols.map((s) => <th key={s.id} className="bg-brand-forest text-white text-[10px] font-semibold px-2 py-2 border-l border-white/10 whitespace-nowrap"><div>{s.label}</div><div className="text-white/60 font-normal">{s.startTime}</div></th>)}
          </tr>
        </thead>
        <tbody>
          {rooms.map((r, i) => (
            <tr key={r.id} className={i % 2 ? "bg-[#fbfaf7]" : "bg-card"}>
              <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 text-sm font-semibold text-brand-forest border-b border-border whitespace-nowrap">{r.name}{r.capacity ? <span className="text-xs text-muted-foreground font-normal"> · {r.capacity}</span> : null}</td>
              {cols.map((s) => {
                const here = today.filter((e) => e.roomId === r.id && e.timeSlotId === s.id);
                const subj = here[0] ? maps.subjMap.get(here[0].subjectId) : undefined;
                return (
                  <td key={s.id} className="border-l border-b border-border p-0.5 align-top">
                    {here.length ? (
                      <div className={cn("rounded px-1.5 py-1 text-white text-[10px] leading-tight min-h-[32px] flex flex-col justify-center", here.length > 1 && "ring-2 ring-destructive")} style={{ backgroundColor: subj?.color || NO_COLOR }}>
                        <span className="font-bold truncate">{subj?.code || subj?.name}</span>
                        <span className="text-white/80 truncate">{here.map((x) => maps.sectionMap.get(x.sectionId)?.name).join(", ")}</span>
                      </div>
                    ) : <div className="min-h-[32px] grid place-items-center text-[10px] font-semibold text-brand-bright">free</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
