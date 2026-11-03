import { useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader } from "@/components/page";
import { Card } from "@/components/ui/primitives";
import {
  useTeachers, useEntries, useSections, useGradeLevels, useSubjects, useAllocations, useRooms, useTimeSlots,
  useSettings, useConflicts, useSubstitutions, useLookups,
} from "@/lib/hooks";
import { DAY_SHORT } from "@/lib/types";
import { FileSpreadsheet, Users, CalendarDays, AlertTriangle, DoorOpen, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportReportsWorkbook, type ReportData } from "@/lib/excel-export";
import { roomSlots } from "@/lib/print";
import { todayIso } from "@/lib/sched";

type Tab = "teachers" | "sections" | "rooms" | "conflicts";

export default function ReportsPage() {
  const teachers = useTeachers();
  const entries = useEntries();
  const sections = useSections();
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const allocations = useAllocations();
  const rooms = useRooms();
  const slots = useTimeSlots();
  const settings = useSettings();
  const conflicts = useConflicts();
  const since = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 30); return todayIso(d); }, []);
  const subs = useSubstitutions({ from: since });
  const { maps } = useLookups();
  const [tab, setTab] = useState<Tab>("teachers");
  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];

  const data: ReportData = useMemo(() => {
    const all = entries.data ?? [];
    const teacherLoads = (teachers.data ?? []).map((t) => {
      const mine = all.filter((e) => e.teacherId === t.id);
      return {
        name: t.name,
        periods: mine.length,
        maxLoad: t.maxLoad,
        perDay: days.map((d) => mine.filter((e) => e.dayOfWeek === d).length),
        maxPerDay: t.maxPerDay,
        subjects: [...new Set(mine.map((e) => maps.subjMap.get(e.subjectId)?.name).filter(Boolean))].join(", "),
        sections: [...new Set(mine.map((e) => maps.sectionMap.get(e.sectionId)?.name).filter(Boolean))].join(", "),
        subs: (subs.data ?? []).filter((s) => s.substituteTeacherId === t.id).length,
      };
    });
    const allocation = (sections.data ?? []).map((s) => {
      const req = (allocations.data ?? []).filter((a) => a.gradeLevelId === s.gradeLevelId && a.periodsPerWeek > 0);
      const mine = all.filter((e) => e.sectionId === s.id);
      const issues: string[] = [];
      for (const a of req) {
        const n = mine.filter((e) => e.subjectId === a.subjectId).length;
        if (n !== a.periodsPerWeek) issues.push(`${maps.subjMap.get(a.subjectId)?.name ?? "?"} ${n}/${a.periodsPerWeek}`);
      }
      const extra = new Set(mine.filter((e) => !req.some((a) => a.subjectId === e.subjectId)).map((e) => maps.subjMap.get(e.subjectId)?.name ?? "?"));
      extra.forEach((n) => issues.push(`${n} not in allocations`));
      const noTeacher = mine.filter((e) => e.teacherId == null).length;
      if (noTeacher) issues.push(`${noTeacher} without a teacher`);
      return { section: s.name, grade: grades.data?.find((g) => g.id === s.gradeLevelId)?.name ?? "", required: req.reduce((n, a) => n + a.periodsPerWeek, 0), scheduled: mine.length, issues: issues.join(" · ") };
    });
    const roomRows = (rooms.data ?? []).map((r) => {
      const rows = roomSlots(r, slots.data ?? [], all, maps.sectionMap);
      const available = days.reduce((n, d) => n + rows.filter((s) => !s.isBreak && (!s.days?.length || s.days.includes(d))).length, 0);
      const used = new Set(all.filter((e) => e.roomId === r.id).map((e) => `${e.dayOfWeek}:${e.timeSlotId}`)).size;
      return { name: r.name, capacity: r.capacity, used, available };
    });
    return { teacherLoads, days, allocation, rooms: roomRows, conflicts: (conflicts.data?.conflicts ?? []).map((c) => ({ severity: c.severity, message: c.message })) };
  }, [entries.data, teachers.data, sections.data, allocations.data, rooms.data, slots.data, conflicts.data, subs.data, grades.data, maps, days]);

  const errors = (conflicts.data?.conflicts ?? []).filter((c) => c.severity === "error").length;
  const warnings = (conflicts.data?.conflicts ?? []).filter((c) => c.severity === "warning").length;
  const complete = data.allocation.filter((a) => !a.issues && a.required > 0).length;
  const overLoaded = data.teacherLoads.filter((t) => (t.maxLoad != null && t.periods > t.maxLoad) || (t.maxPerDay != null && t.perDay.some((n) => n > t.maxPerDay!))).length;
  const roomUse = data.rooms.reduce((a, r) => ({ u: a.u + r.used, v: a.v + r.available }), { u: 0, v: 0 });

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: "teachers", label: "Teacher loads", icon: Users },
    { key: "sections", label: "Allocation check", icon: CalendarDays },
    { key: "rooms", label: "Room usage", icon: DoorOpen },
    { key: "conflicts", label: "Conflicts", icon: AlertTriangle },
  ];

  return (
    <Layout>
      <Page>
        <PageHeader title="Reports" subtitle="Loads, missing periods, room use and conflicts, for checking and for the office."
          tools={[{ key: "export", label: "Export to Excel", icon: <FileSpreadsheet className="size-4" />, onSelect: () => exportReportsWorkbook(data) }]} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Tile label="Classes scheduled" value={String(entries.data?.length ?? 0)} />
          <Tile label="Sections complete" value={`${complete} / ${data.allocation.length}`} good={complete === data.allocation.length && complete > 0} />
          <Tile label="Conflicts" value={errors ? `${errors} errors` : warnings ? `${warnings} warnings` : "None"} bad={errors > 0} good={!errors && !warnings} />
          <Tile label="Teachers over limit" value={String(overLoaded)} bad={overLoaded > 0} good={overLoaded === 0} />
        </div>

        <div className="flex gap-1.5 overflow-x-auto thin-scroll -mx-4 px-4 pb-1 mb-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn("shrink-0 whitespace-nowrap flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition border", tab === key ? "bg-brand text-white border-brand" : "bg-white text-brand-forest border-border hover:border-brand-mid")}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {tab === "teachers" && (
          <Card className="overflow-x-auto thin-scroll p-0">
            <table className="w-full text-sm border-collapse min-w-[680px]">
              <thead><tr className="bg-muted/40 text-left">
                <Th sticky>Teacher</Th><Th right>Periods</Th><Th right>Max</Th>{days.map((d) => <Th key={d} right>{DAY_SHORT[d]}</Th>)}<Th right>Max/day</Th><Th right>Subs (30d)</Th><Th>Sections</Th>
              </tr></thead>
              <tbody>
                {data.teacherLoads.slice().sort((a, b) => b.periods - a.periods).map((t) => {
                  const over = t.maxLoad != null && t.periods > t.maxLoad;
                  return (
                    <tr key={t.name} className="border-t border-border">
                      <td className="sticky left-0 bg-card px-3 py-2 font-semibold text-brand-forest whitespace-nowrap">{t.name}</td>
                      <td className={cn("px-3 py-2 text-right font-semibold", over && "text-destructive")}>{t.periods}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{t.maxLoad ?? "—"}</td>
                      {t.perDay.map((n, i) => <td key={i} className={cn("px-3 py-2 text-right", t.maxPerDay != null && n > t.maxPerDay && "text-destructive font-semibold")}>{n}</td>)}
                      <td className="px-3 py-2 text-right text-muted-foreground">{t.maxPerDay ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{t.subs}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px] truncate" title={t.sections}>{t.sections || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "sections" && (
          <Card className="overflow-x-auto thin-scroll p-0">
            <table className="w-full text-sm border-collapse min-w-[560px]">
              <thead><tr className="bg-muted/40 text-left"><Th sticky>Section</Th><Th>Grade</Th><Th right>Scheduled</Th><Th>What's off</Th></tr></thead>
              <tbody>
                {data.allocation.map((a) => (
                  <tr key={a.section + a.grade} className="border-t border-border">
                    <td className="sticky left-0 bg-card px-3 py-2 font-semibold text-brand-forest whitespace-nowrap">{a.section}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{a.grade}</td>
                    <td className={cn("px-3 py-2 text-right font-semibold", a.scheduled !== a.required && "text-[#8a6400]")}>{a.scheduled} / {a.required}</td>
                    <td className="px-3 py-2 text-xs">{a.issues ? a.issues : <span className="inline-flex items-center gap-1 text-brand-forest"><CheckCircle2 className="size-3.5" /> Complete</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "rooms" && (
          <Card className="overflow-x-auto thin-scroll p-0">
            <p className="px-4 py-3 text-sm text-muted-foreground border-b border-border">Overall {roomUse.v ? Math.round((roomUse.u / roomUse.v) * 100) : 0}% of room-periods are in use.</p>
            <table className="w-full text-sm border-collapse min-w-[480px]">
              <thead><tr className="bg-muted/40 text-left"><Th sticky>Room</Th><Th right>Seats</Th><Th right>Periods used</Th><Th>Use</Th></tr></thead>
              <tbody>
                {data.rooms.slice().sort((a, b) => b.used / (b.available || 1) - a.used / (a.available || 1)).map((r) => {
                  const pct = r.available ? Math.round((r.used / r.available) * 100) : 0;
                  return (
                    <tr key={r.name} className="border-t border-border">
                      <td className="sticky left-0 bg-card px-3 py-2 font-semibold text-brand-forest whitespace-nowrap">{r.name}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{r.capacity ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{r.used} / {r.available}</td>
                      <td className="px-3 py-2 w-1/3"><div className="flex items-center gap-2"><div className="flex-1 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} /></div><span className="w-9 text-right text-xs">{pct}%</span></div></td>
                    </tr>
                  );
                })}
                {data.rooms.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No rooms set up yet.</td></tr>}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "conflicts" && (
          <Card className="p-4 space-y-1.5">
            {data.conflicts.length === 0 && <p className="text-sm text-muted-foreground flex items-center gap-2"><CheckCircle2 className="size-4 text-brand-bright" /> No conflicts. Everything checks out.</p>}
            {(conflicts.data?.conflicts ?? []).slice().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)).map((c, i) => (
              <div key={i} className={cn("text-sm p-2 rounded-lg flex items-start gap-2", c.severity === "error" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-[#8a6400]")}>
                <AlertTriangle className="size-4 mt-0.5 shrink-0" /><span>{c.message}</span>
              </div>
            ))}
          </Card>
        )}
        <p className="text-[11px] text-muted-foreground mt-4">{subjects.data?.length ?? 0} subjects · {teachers.data?.length ?? 0} teachers · {sections.data?.length ?? 0} sections. Loads count scheduled face-to-face periods only.</p>
      </Page>
    </Layout>
  );
}

function Th({ children, right, sticky }: { children: React.ReactNode; right?: boolean; sticky?: boolean }) {
  return <th className={cn("px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap", right && "text-right", sticky && "sticky left-0 bg-muted z-10")}>{children}</th>;
}

function Tile({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-display font-extrabold", bad ? "text-destructive" : good ? "text-brand" : "text-brand-forest")}>{value}</p>
    </Card>
  );
}
