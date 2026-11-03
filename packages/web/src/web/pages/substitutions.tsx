import { useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader } from "@/components/page";
import { Card, EmptyState, Select, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useTeachers, useTimeSlots, useSettings, useSubstitutions, useSubPlan, useLocked, useLookups, useAct } from "@/lib/hooks";
import { DAY_FULL } from "@/lib/types";
import type { Substitution, SubPlan } from "@/lib/types";
import { UserCheck, Printer, Trash2, Wand2, CalendarDays, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { printSubstitutions, type SubRow } from "@/lib/print";
import { todayIso, dayOfIso } from "@/lib/sched";
import { useConfirm } from "@/lib/confirm";

/** The next school day on or after today. */
function nextSchoolDay(active: number[]): string {
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    const iso = todayIso(d);
    if (active.includes(dayOfIso(iso))) return iso;
    d.setDate(d.getDate() + 1);
  }
  return todayIso();
}

export default function SubstitutionsPage() {
  const teachers = useTeachers();
  const slots = useTimeSlots();
  const settings = useSettings();
  const locked = useLocked();
  const { maps, printOpts } = useLookups();
  const act = useAct();
  const confirm = useConfirm();
  const active = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const [date, setDate] = useState<string>(() => nextSchoolDay([1, 2, 3, 4, 5]));
  const [absent, setAbsent] = useState<number | null>(null);
  const plan = useSubPlan(date, absent);
  const onDate = useSubstitutions({ date });
  const month = useSubstitutions({ from: date.slice(0, 8) + "01", to: date.slice(0, 8) + "31" });
  const slotById = useMemo(() => new Map((slots.data ?? []).map((s) => [s.id, s])), [slots.data]);
  const tName = (id: number | null | undefined) => (id != null ? maps.teacherMap.get(id)?.name : undefined);
  const day = dayOfIso(date);
  const schoolDay = active.includes(day);

  const toRow = (s: Substitution): SubRow => {
    const sec = maps.sectionMap.get(s.sectionId);
    return {
      date: s.date, slot: slotById.get(s.timeSlotId), section: sec?.name, subject: s.subjectId != null ? maps.subjMap.get(s.subjectId)?.name : undefined,
      absent: tName(s.absentTeacherId), substitute: tName(s.substituteTeacherId), room: sec?.homeroomId != null ? maps.roomMap.get(sec.homeroomId)?.name : undefined, note: s.note,
    };
  };
  const sortedOnDate = useMemo(() => (onDate.data ?? []).slice().sort((a, b) => (slotById.get(a.timeSlotId)?.startTime ?? "").localeCompare(slotById.get(b.timeSlotId)?.startTime ?? "")), [onDate.data, slotById]);

  const assign = (c: SubPlan["classes"][number], substituteTeacherId: number | null) =>
    act("POST", "/substitutions", { date, sectionId: c.sectionId, subjectId: c.subjectId, timeSlotId: c.timeSlotId, absentTeacherId: absent, substituteTeacherId }, { invalidate: ["substitutions"], success: substituteTeacherId != null ? `${tName(substituteTeacherId)} assigned.` : "Marked as needing cover." });

  async function assignAllSuggested() {
    const open = (plan.data?.classes ?? []).filter((c) => !c.existing?.substituteTeacherId);
    // Assign one by one: each pick changes who is free for the next class.
    let n = 0;
    for (const c of open) {
      const fresh = await act<SubPlan>("GET", `/substitutions/plan?date=${date}&teacherId=${absent}`, undefined, { invalidate: [] });
      const cur = fresh?.classes.find((x) => x.sectionId === c.sectionId && x.timeSlotId === c.timeSlotId);
      const best = cur?.candidates[0];
      if (!best) continue;
      await act("POST", "/substitutions", { date, sectionId: c.sectionId, subjectId: c.subjectId, timeSlotId: c.timeSlotId, absentTeacherId: absent, substituteTeacherId: best.teacherId }, { invalidate: [] });
      n++;
    }
    await act("GET", "/substitutions?date=" + date, undefined, { invalidate: ["substitutions"], success: n ? `Assigned ${n} substitute${n === 1 ? "" : "s"}.` : "No free teacher found for the remaining classes." });
  }

  const monthCounts = useMemo(() => {
    const cover = new Map<number, number>(), away = new Map<number, number>();
    for (const s of month.data ?? []) {
      if (s.substituteTeacherId != null) cover.set(s.substituteTeacherId, (cover.get(s.substituteTeacherId) ?? 0) + 1);
      if (s.absentTeacherId != null) away.set(s.absentTeacherId, (away.get(s.absentTeacherId) ?? 0) + 1);
    }
    return { cover: [...cover.entries()].sort((a, b) => b[1] - a[1]), away: [...away.entries()].sort((a, b) => b[1] - a[1]) };
  }, [month.data]);
  const maxCover = Math.max(1, ...monthCounts.cover.map(([, n]) => n));
  const monthLabel = new Date(date + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <Layout>
      <Page>
        <PageHeader title="Substitutions" subtitle="When a teacher is away, find who is free to cover each class, then print slips."
          tools={[{ key: "print", label: "Print sheet & slips", icon: <Printer className="size-4" />, disabled: !sortedOnDate.length, title: sortedOnDate.length ? undefined : "Nothing to print for this day yet", onSelect: () => printSubstitutions(date, sortedOnDate.map(toRow), printOpts) }]} />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)] gap-5 xl:gap-6 items-start">
          <Card className="p-4 sm:p-5">
            <div className="grid sm:grid-cols-[180px_1fr] gap-3">
              <label className="block">
                <span className="block text-sm font-semibold mb-1.5">Date</span>
                <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </label>
              {!locked && (
                <label className="block">
                  <span className="block text-sm font-semibold mb-1.5">Teacher who is away</span>
                  <Select value={absent ?? ""} onChange={(e) => setAbsent(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— Choose a teacher —</option>
                    {(teachers.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </label>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5"><CalendarDays className="size-4" /> {DAY_FULL[day]}{!schoolDay && " — not a school day in this schedule"}</p>

            {!locked && absent == null && (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground text-center">
                Choose the teacher who is away. Their classes for that day appear here, each with the teachers who are free to cover it.
              </p>
            )}

            {!locked && absent != null && schoolDay && (
              <div className="mt-4">
                {plan.isLoading && <p className="text-sm text-muted-foreground">Looking for free teachers…</p>}
                {plan.data && plan.data.classes.length === 0 && <p className="text-sm text-muted-foreground">{tName(absent)} has no classes on {DAY_FULL[day]}.</p>}
                {plan.data && plan.data.classes.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-brand-forest">{plan.data.classes.length} class{plan.data.classes.length !== 1 && "es"} to cover</p>
                      <Button size="sm" onClick={assignAllSuggested} disabled={plan.data.classes.every((c) => c.existing?.substituteTeacherId)} className="bg-brand text-white hover:bg-brand-mid"><Wand2 className="size-4" /> Assign the best match to each</Button>
                    </div>
                    <div className="divide-y divide-border rounded-lg border border-border">
                      {plan.data.classes.map((c) => <CoverRow key={`${c.sectionId}:${c.timeSlotId}`} c={c} maps={maps} slot={slotById.get(c.timeSlotId)} onAssign={(id) => assign(c, id)}
                        onRemove={c.existing ? () => act("DELETE", `/substitutions/${c.existing!.id}`, undefined, { invalidate: ["substitutions"] }) : undefined} />)}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>

          <div className="space-y-5 min-w-0">
          <Card>
            <div className="p-4 border-b border-border flex items-center gap-2">
              <UserCheck className="size-5 text-brand" />
              <h3 className="font-display font-bold text-brand-forest">Cover on {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</h3>
              <span className="ml-auto text-sm text-muted-foreground">{sortedOnDate.length}</span>
            </div>
            {sortedOnDate.length === 0 && <EmptyState icon={<UserCheck className="size-10" />} title="No substitutions on this day" hint={locked ? undefined : "Pick the teacher who is away above."} />}
            {sortedOnDate.map((s) => {
              const r = toRow(s);
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                  <div className="w-16 shrink-0"><p className="text-sm font-bold text-brand-forest">{r.slot?.label}</p><p className="text-[11px] text-muted-foreground">{r.slot?.startTime}</p></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{r.subject} · {r.section}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.absent ?? "?"} → <b className={cn(r.substitute ? "text-brand-forest" : "text-destructive")}>{r.substitute ?? "not covered yet"}</b>{r.note ? ` · ${r.note}` : ""}</p>
                  </div>
                  {!locked && <Button size="icon-sm" variant="ghost" aria-label="Remove" className="text-destructive hover:text-destructive" onClick={async () => { if (await confirm({ title: "Remove this substitution?", message: "You can undo this afterwards.", confirmLabel: "Remove" })) act("DELETE", `/substitutions/${s.id}`, undefined, { invalidate: ["substitutions"] }); }}><Trash2 className="size-4" /></Button>}
                </div>
              );
            })}
          </Card>

          <Card className="p-4 sm:p-5">
            <h3 className="font-display font-bold text-brand-forest mb-3">{monthLabel}</h3>
            {monthCounts.cover.length === 0 && monthCounts.away.length === 0 && <p className="text-sm text-muted-foreground">No substitutions this month.</p>}
            <div className="grid sm:grid-cols-2 gap-5">
              {monthCounts.cover.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Classes covered</p>
                  <div className="space-y-1.5">
                    {monthCounts.cover.map(([id, n]) => (
                      <div key={id} className="flex items-center gap-2 text-sm">
                        <span className="w-32 truncate">{tName(id) ?? "?"}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-brand rounded-full" style={{ width: `${(n / maxCover) * 100}%` }} /></div>
                        <span className="w-6 text-right font-semibold">{n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {monthCounts.away.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Classes missed</p>
                  <div className="space-y-1">
                    {monthCounts.away.map(([id, n]) => <div key={id} className="flex justify-between text-sm"><span className="truncate">{tName(id) ?? "?"}</span><span className="font-semibold">{n}</span></div>)}
                  </div>
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">Suggestions favour teachers who are free, teach the subject, and have covered fewer classes in the last 30 days.</p>
          </Card>
          </div>
        </div>
      </Page>
    </Layout>
  );
}

function CoverRow({ c, maps, slot, onAssign, onRemove }: {
  c: SubPlan["classes"][number]; maps: ReturnType<typeof useLookups>["maps"]; slot?: { label: string; startTime: string; endTime: string };
  onAssign: (teacherId: number | null) => void; onRemove?: () => void;
}) {
  const current = c.existing?.substituteTeacherId ?? null;
  const [pick, setPick] = useState<number | "">(current ?? c.candidates[0]?.teacherId ?? "");
  const subj = maps.subjMap.get(c.subjectId);
  const sec = maps.sectionMap.get(c.sectionId);
  const curName = current != null ? maps.teacherMap.get(current)?.name : null;
  // Keep the currently assigned teacher in the list even if they are no longer "free".
  const options = c.candidates.some((x) => x.teacherId === current) || current == null ? c.candidates : [{ teacherId: current, note: "assigned", qualified: false, score: 0, periodsThatDay: 0, recentSubs: 0 }, ...c.candidates];
  return (
    <div className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex items-center gap-3 sm:w-64 shrink-0">
        <div className="w-14 shrink-0"><p className="text-sm font-bold text-brand-forest">{slot?.label}</p><p className="text-[11px] text-muted-foreground">{slot?.startTime}</p></div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{subj?.name ?? "?"} · {sec?.name}</p>
          {curName ? <p className="text-xs text-brand-forest flex items-center gap-1"><Check className="size-3" /> {curName}</p> : <p className="text-xs text-destructive">Needs cover</p>}
        </div>
      </div>
      <div className="flex gap-2 flex-1 min-w-0">
        <Select value={pick} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : "")} className="min-w-0">
          {options.length === 0 && <option value="">No teacher is free</option>}
          {options.map((x, i) => <option key={x.teacherId} value={x.teacherId}>{i === 0 && current == null ? "★ " : ""}{maps.teacherMap.get(x.teacherId)?.name} — {x.note}</option>)}
        </Select>
        <Button onClick={() => pick !== "" && onAssign(pick)} disabled={pick === "" || pick === current} className="bg-brand text-white hover:bg-brand-mid shrink-0">{current != null ? "Change" : "Assign"}</Button>
        {onRemove && <Button size="icon" variant="ghost" aria-label="Remove" onClick={onRemove} className="text-destructive hover:text-destructive shrink-0"><Trash2 className="size-4" /></Button>}
      </div>
    </div>
  );
}

