import { Link } from "wouter";
import { useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader } from "@/components/page";
import { Segmented } from "@/components/side-picker";
import { useMediaQuery, BP } from "@/lib/use-media";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ImportButton } from "@/components/import-button";
import { useGradeLevels, useSections, useSubjects, useTeachers, useAllocations, useTeachingLoads, useEntries, useAct } from "@/lib/hooks";
import { ClipboardList, Wand2, CalendarCheck, AlertTriangle, Trash2, ChevronDown } from "lucide-react";
import { cn, NO_COLOR } from "@/lib/utils";
import { eligibleTeachers } from "@/lib/sched";
import { useConfirm } from "@/lib/confirm";

export default function TeachingLoadsPage() {
  const grades = useGradeLevels();
  const sections = useSections();
  const subjects = useSubjects();
  const teachers = useTeachers();
  const allocations = useAllocations();
  const loads = useTeachingLoads();
  const entries = useEntries();
  const act = useAct();
  const confirm = useConfirm();
  const [gradeId, setGradeId] = useState<number | "all">("all");
  const wide = useMediaQuery(BP["2xl"]);

  const loading = grades.isLoading || sections.isLoading || subjects.isLoading || teachers.isLoading || allocations.isLoading || loads.isLoading;
  const gradeList = grades.data ?? [];
  const shownGrades = gradeId === "all" ? gradeList : gradeList.filter((g) => g.id === gradeId);
  const loadAt = (sectionId: number, subjectId: number) => loads.data?.find((l) => l.sectionId === sectionId && l.subjectId === subjectId);
  const per = (gid: number, sid: number) => allocations.data?.find((a) => a.gradeLevelId === gid && a.subjectId === sid)?.periodsPerWeek ?? 0;
  const scopeIds = (sections.data ?? []).filter((s) => gradeId === "all" || s.gradeLevelId === gradeId).map((s) => s.id);

  const totals = useMemo(() => {
    const m = new Map<number, { periods: number; classes: number }>();
    for (const l of loads.data ?? []) {
      const sec = sections.data?.find((s) => s.id === l.sectionId);
      if (!sec) continue;
      const cur = m.get(l.teacherId) ?? { periods: 0, classes: 0 };
      cur.periods += per(sec.gradeLevelId, l.subjectId);
      cur.classes += 1;
      m.set(l.teacherId, cur);
    }
    return m;
  }, [loads.data, sections.data, allocations.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const needed = (sections.data ?? []).reduce((n, s) => n + (allocations.data ?? []).filter((a) => a.gradeLevelId === s.gradeLevelId && a.periodsPerWeek > 0).length, 0);
  const assigned = (loads.data ?? []).length;

  const autoAssign = () => act<{ assigned: unknown[]; unassigned: { sectionId: number; subjectId: number; reason: string }[] }>("POST", "/teaching-loads/auto", { sectionIds: scopeIds }, {
    success: (r) => `Assigned ${r.assigned.length} class${r.assigned.length === 1 ? "" : "es"}.${r.unassigned.length ? ` ${r.unassigned.length} still need a teacher (${r.unassigned[0].reason}).` : ""}`,
  });
  const apply = async () => {
    if (await confirm({ title: "Use these teachers in the schedule?", message: "Every class already on the timetable gets the teacher from its teaching load. Classes without a load keep their teacher. You can undo this afterwards.", confirmLabel: "Apply", destructive: false }))
      act<{ changed: number }>("POST", "/teaching-loads/apply", {}, { success: (r) => `Updated ${r.changed} class${r.changed === 1 ? "" : "es"} on the timetable.` });
  };
  const clear = async () => {
    if (await confirm({ title: gradeId === "all" ? "Clear all teaching loads?" : "Clear these teaching loads?", message: "The timetable itself isn't changed. You can undo this afterwards.", confirmLabel: "Clear" }))
      act("POST", "/teaching-loads/clear", gradeId === "all" ? {} : { sectionIds: scopeIds }, { success: "Teaching loads cleared." });
  };

  return (
    <Layout>
      <Page>
        <PageHeader title="Teaching Loads" subtitle="Decide who teaches each subject in each section. Auto-fill and new classes then use that teacher."
          tools={[
            { key: "apply", label: "Use in schedule", icon: <CalendarCheck className="size-4" />, title: "Give classes already on the timetable the teacher chosen here", onSelect: apply },
            { key: "clear", label: gradeId === "all" ? "Clear all" : "Clear grade", icon: <Trash2 className="size-4" />, danger: true, onSelect: clear },
          ]}
          actions={<ImportButton endpoint="/teaching-loads/import" headerHints={["section", "subject", "teacher"]} itemLabel="teaching load" />}
          primary={<Button onClick={autoAssign} disabled={!scopeIds.length} className="bg-brand text-white hover:bg-brand-mid"><Wand2 className="size-4" /> Fill in the blanks</Button>} />

        {loading && <p className="text-muted-foreground">Loading…</p>}
        {!loading && (!gradeList.length || !(sections.data ?? []).length) && (
          <Card><EmptyState icon={<ClipboardList className="size-12" />} title="Add grades, sections and subjects first" hint="Then set periods per week on the Allocations page."
            action={<Link href="/setup"><Button className="bg-brand text-white hover:bg-brand-mid">Go to Setup</Button></Link>} /></Card>
        )}

        {!loading && gradeList.length > 0 && (sections.data ?? []).length > 0 && (
          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_300px] gap-5 xl:gap-6 items-start">
            <div className="space-y-4 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented label="Grade" value={gradeId} onChange={setGradeId} options={[{ value: "all" as const, label: "All grades" }, ...gradeList.map((g) => ({ value: g.id, label: g.name }))]} />
                <span className={cn("text-sm sm:ml-auto font-medium", assigned < needed ? "text-[#8a6400]" : "text-brand")}>{assigned} of {needed} set</span>
              </div>
              <p className="text-xs text-muted-foreground">Import columns: section, subject, teacher, grade level (optional). A dot means the timetable currently uses a different teacher.</p>

              {shownGrades.map((g) => {
                const secs = (sections.data ?? []).filter((s) => s.gradeLevelId === g.id);
                const subjs = (subjects.data ?? []).filter((s) => per(g.id, s.id) > 0);
                if (!secs.length) return null;
                return (
                  <Card key={g.id} className="overflow-x-auto thin-scroll p-0">
                    <div className="px-4 py-3 border-b border-border font-display font-bold text-brand-forest">{g.name}</div>
                    {subjs.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">No periods per week set for {g.name}. <Link href="/allocations" className="text-brand underline">Set allocations</Link> first.</p>
                    ) : (
                      <table className="w-full border-collapse text-sm table-fixed" style={{ minWidth: 120 + subjs.length * 160 }}>
                        <thead>
                          <tr className="bg-muted/40">
                            <th className="sticky left-0 z-10 bg-muted text-left px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground w-[120px]">Section</th>
                            {subjs.map((s) => (
                              <th key={s.id} title={s.name} className="px-2 py-2 text-left font-semibold border-l border-border align-bottom">
                                <span className="flex items-center gap-1.5 min-w-0"><span className="size-2.5 rounded shrink-0" style={{ backgroundColor: s.color || NO_COLOR }} /><span className="truncate">{s.code || s.name}</span><span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">{per(g.id, s.id)}/wk</span></span>
                                {s.code && <span className="block text-[11px] font-normal text-muted-foreground truncate">{s.name}</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {secs.map((sec) => (
                            <tr key={sec.id} className="border-t border-border">
                              <td className="sticky left-0 z-10 bg-card px-3 py-2 font-semibold text-brand-forest whitespace-nowrap">{sec.name}</td>
                              {subjs.map((s) => {
                                const l = loadAt(sec.id, s.id);
                                const used = new Set((entries.data ?? []).filter((e) => e.sectionId === sec.id && e.subjectId === s.id && e.teacherId != null).map((e) => e.teacherId));
                                const differs = l && used.size > 0 && [...used].some((t) => t !== l.teacherId);
                                const qualified = eligibleTeachers(teachers.data ?? [], s.id, g.id);
                                const rest = (teachers.data ?? []).filter((t) => !qualified.includes(t));
                                return (
                                  <td key={s.id} className="border-l border-border px-1.5 py-1.5">
                                    <div className={cn("relative min-h-9 rounded-md border bg-white pl-2 pr-6 py-1 flex items-center text-[13px] leading-tight transition has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-brand-mid/30 has-[select:focus-visible]:border-brand-mid hover:border-brand-mid",
                                      l ? "border-input text-foreground" : "border-dashed border-warning/70 text-muted-foreground")}>
                                      <span className="line-clamp-2 break-words">{l ? teachers.data?.find((t) => t.id === l.teacherId)?.name ?? "?" : "— None —"}</span>
                                      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                                      {differs && <span title="The timetable uses a different teacher for this class" className="absolute -right-1 -top-1 size-2.5 rounded-full bg-warning ring-2 ring-white" />}
                                      <select value={l?.teacherId ?? ""} aria-label={`${sec.name} ${s.name} teacher`}
                                        onChange={(e) => act("PUT", "/teaching-loads", { sectionId: sec.id, subjectId: s.id, teacherId: e.target.value ? Number(e.target.value) : null }, { invalidate: ["teaching-loads", "conflicts"] })}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-sm">
                                        <option value="">— None —</option>
                                        <optgroup label="Qualified">{qualified.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                                        {rest.length > 0 && <optgroup label="Others">{rest.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
                                      </select>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Card>
                );
              })}
            </div>

            <Card className="p-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-y-auto thin-scroll">
              <h3 className="font-display font-bold text-brand-forest mb-1">Load per teacher</h3>
              <p className="text-xs text-muted-foreground mb-3">Periods a week from these assignments.</p>
              <div className={cn("gap-x-8 gap-y-2.5", wide ? "space-y-2" : "grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
                {(teachers.data ?? []).slice().sort((a, b) => (totals.get(b.id)?.periods ?? 0) - (totals.get(a.id)?.periods ?? 0)).map((t) => {
                  const tot = totals.get(t.id) ?? { periods: 0, classes: 0 };
                  const over = t.maxLoad != null && tot.periods > t.maxLoad;
                  const pct = t.maxLoad ? Math.min(100, (tot.periods / t.maxLoad) * 100) : 0;
                  return (
                    <div key={t.id}>
                      <div className="flex justify-between text-sm gap-2">
                        <span className="truncate">{t.name}</span>
                        <span className={cn("font-semibold shrink-0", over ? "text-destructive" : "text-brand-forest")}>{tot.periods}{t.maxLoad ? ` / ${t.maxLoad}` : ""}</span>
                      </div>
                      {t.maxLoad ? <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1"><div className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-brand")} style={{ width: `${pct}%` }} /></div> : null}
                      {over && <p className="text-[11px] text-destructive flex items-center gap-1 mt-0.5"><AlertTriangle className="size-3" /> {tot.periods - t.maxLoad!} over the limit</p>}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}
      </Page>
    </Layout>
  );
}
