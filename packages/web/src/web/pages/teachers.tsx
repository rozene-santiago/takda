import { useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Page, PageHeader } from "@/components/page";
import { Card, Modal, Field, Input, EmptyState, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ImportButton } from "@/components/import-button";
import { Chips, SlotGrid } from "@/components/chips";
import { useTeachers, useSubjects, useGradeLevels, useTimeSlots, useSettings, useUnavailability } from "@/lib/hooks";
import { request } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import type { Teacher } from "@/lib/types";
import { Users, Plus, Pencil, Trash2, Mail, CalendarX } from "lucide-react";
import { teacherColor } from "@/lib/utils";
import { useConfirm } from "@/lib/confirm";
import { notify } from "@/lib/save-file";
import { sortSlots, slotRunsOn } from "@/lib/sched";

export default function TeachersPage() {
  const teachers = useTeachers();
  const subjects = useSubjects();
  const gradeLevels = useGradeLevels();
  const unav = useUnavailability();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Teacher | "new" | null>(null);
  const refresh = () => Promise.all(["teachers", "teacher-unavailability", "conflicts", "entries"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  const count = teachers.data?.length ?? 0;
  const [subjectFilter, setSubjectFilter] = useState<number | "all" | "none">("all");
  const [sortBy, setSortBy] = useState<"name" | "subject" | "load">("name");
  const [query, setQuery] = useState("");
  const subjName = (id: number) => subjects.data?.find((s) => s.id === id)?.name ?? "";
  const unavCount = (id: number) => (unav.data ?? []).filter((u) => u.teacherId === id).length;

  const visibleTeachers = useMemo(() => {
    let list = [...(teachers.data ?? [])];
    if (query.trim()) list = list.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));
    if (subjectFilter === "none") list = list.filter((t) => t.subjectIds.length === 0);
    else if (subjectFilter !== "all") list = list.filter((t) => t.subjectIds.includes(subjectFilter));
    list.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "load") return (b.maxLoad ?? 0) - (a.maxLoad ?? 0);
      return (subjName(a.subjectIds[0] ?? -1) || "~").localeCompare(subjName(b.subjectIds[0] ?? -1) || "~");
    });
    return list;
  }, [teachers.data, subjectFilter, sortBy, query, subjects.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(t: Teacher) {
    if (!(await confirm({ title: "Delete teacher?", message: `Remove ${t.name}? Their classes will be left without a teacher. You can undo this afterwards.` }))) return;
    try { await request("DELETE", `/teachers/${t.id}`); await refresh(); } catch (e: any) { notify(e?.message ?? String(e), "error"); }
  }
  async function clearAll() {
    if (!(await confirm({ title: "Delete all teachers?", message: `This removes all ${count} teachers and unassigns them from their classes. You can undo this afterwards.`, confirmLabel: "Delete all" }))) return;
    try { await request("POST", "/teachers/clear"); await refresh(); } catch (e: any) { notify(e?.message ?? String(e), "error"); }
  }

  const selectCls = "h-9 rounded-lg border border-border bg-white px-2.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand/30";

  return (
    <Layout>
      <Page>
        <PageHeader title="Teacher Roster" subtitle="Teachers, what they teach, their limits and when they're not available."
          tools={[{ key: "clear", label: "Delete all", icon: <Trash2 className="size-4" />, danger: true, hidden: count === 0, onSelect: clearAll }]}
          actions={<ImportButton endpoint="/teachers/import" headerHints={["name", "email", "subject", "teacher"]} itemLabel="teacher" />}
          primary={<Button onClick={() => setEditing("new")} className="bg-brand text-white hover:bg-brand-mid"><Plus className="size-4" /> Add teacher</Button>} />
        <p className="text-xs text-muted-foreground -mt-3 mb-4">Import columns: name, email, subjects, grade levels, max periods/week, max periods/day (separate several subjects or grades with ;).</p>

        {count > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name…" className="w-full sm:w-52 h-9" />
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Subject
              <select className={selectCls} value={typeof subjectFilter === "number" ? String(subjectFilter) : subjectFilter} onChange={(e) => setSubjectFilter(e.target.value === "all" ? "all" : e.target.value === "none" ? "none" : Number(e.target.value))}>
                <option value="all">All subjects</option>
                <option value="none">Any subject (unassigned)</option>
                {(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Sort
              <select className={selectCls} value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                <option value="name">Name</option>
                <option value="subject">Subject</option>
                <option value="load">Max load</option>
              </select>
            </label>
            <span className="text-xs text-muted-foreground sm:ml-auto">{visibleTeachers.length} of {count} shown</span>
          </div>
        )}

        {teachers.isLoading && <p className="text-muted-foreground">Loading…</p>}
        {!teachers.isLoading && count === 0 && (
          <Card><EmptyState icon={<Users className="size-12" />} title="No teachers yet" hint="Add your teaching staff, or import them from a spreadsheet."
            action={<Button onClick={() => setEditing("new")} className="bg-brand text-white hover:bg-brand-mid"><Plus className="size-4" /> Add teacher</Button>} /></Card>
        )}
        {!teachers.isLoading && count > 0 && visibleTeachers.length === 0 && (
          <Card><EmptyState icon={<Users className="size-12" />} title="No teachers match" hint="Try a different search or subject." /></Card>
        )}

        <div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 min-[1900px]:grid-cols-5 gap-4">
          {visibleTeachers.map((t) => (
            <Card key={t.id} className="p-4 animate-fade-up flex flex-col">
              <div className="flex items-start gap-3">
                <div className="size-11 rounded-xl grid place-items-center text-white font-display font-bold text-lg shrink-0" style={{ backgroundColor: teacherColor(t.subjectIds, subjects.data) }}>
                  {t.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-bold text-brand-forest truncate">{t.name}</p>
                  {t.email && <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><Mail className="size-3" /> {t.email}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-3">
                {t.subjectIds.map((sid) => { const s = subjects.data?.find((x) => x.id === sid); return s ? <Badge key={sid} color={s.color ?? undefined}>{s.name}</Badge> : null; })}
                {t.subjectIds.length === 0 && <span className="text-xs text-muted-foreground italic">Any subject</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-2 text-xs text-muted-foreground">
                <span className="font-semibold">Grades:</span>
                {(t.gradeLevelIds ?? []).length === 0 ? <span className="italic">All grade levels</span>
                  : t.gradeLevelIds.map((gid) => { const g = gradeLevels.data?.find((x) => x.id === gid); return g ? <span key={gid} className="px-1.5 py-0.5 rounded bg-brand-sage/40 text-brand-forest font-medium">{g.name}</span> : null; })}
              </div>
              {unavCount(t.id) > 0 && <p className="text-xs text-destructive/90 mt-2 flex items-center gap-1"><CalendarX className="size-3.5" /> Not available for {unavCount(t.id)} period{unavCount(t.id) === 1 ? "" : "s"} a week</p>}
              <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                <span className="text-xs text-muted-foreground">{[t.maxLoad ? `Max ${t.maxLoad}/week` : "No weekly limit", t.maxPerDay ? `${t.maxPerDay}/day` : null].filter(Boolean).join(" · ")}</span>
                <div className="flex gap-1">
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="size-4" /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => remove(t)} className="text-destructive hover:text-destructive"><Trash2 className="size-4" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Page>

      {editing && <TeacherEditor teacher={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </Layout>
  );
}

function TeacherEditor({ teacher, onClose, onSaved }: { teacher: Teacher | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const subjects = useSubjects();
  const gradeLevels = useGradeLevels();
  const slots = useTimeSlots();
  const settings = useSettings();
  const unav = useUnavailability();
  const [name, setName] = useState(teacher?.name ?? "");
  const [email, setEmail] = useState(teacher?.email ?? "");
  const [maxLoad, setMaxLoad] = useState<string>(teacher?.maxLoad ? String(teacher.maxLoad) : "");
  const [maxPerDay, setMaxPerDay] = useState<string>(teacher?.maxPerDay ? String(teacher.maxPerDay) : "");
  const [subjectIds, setSubjectIds] = useState<number[]>(teacher?.subjectIds ?? []);
  const [gradeLevelIds, setGradeLevelIds] = useState<number[]>(teacher?.gradeLevelIds ?? []);
  const [marked, setMarked] = useState<Set<string>>(() => new Set((unav.data ?? []).filter((u) => u.teacherId === teacher?.id).map((u) => `${u.dayOfWeek}:${u.timeSlotId}`)));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const gradeFilter = gradeLevelIds.length ? gradeLevelIds : null;
  const gridSlots = sortSlots(slots.data ?? []).filter((s) => !s.isBreak && (!gradeFilter || !s.gradeLevelIds?.length || s.gradeLevelIds.some((g) => gradeFilter.includes(g))));

  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const limitsOk = [maxLoad, maxPerDay].every((v) => !v.trim() || (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= 80));

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const body = { name: name.trim(), email: email.trim() || null, maxLoad: num(maxLoad), maxPerDay: num(maxPerDay), subjectIds, gradeLevelIds };
      const row = teacher ? await request<Teacher>("PUT", `/teachers/${teacher.id}`, body) : await request<Teacher>("POST", "/teachers", body);
      const before = new Set((unav.data ?? []).filter((u) => u.teacherId === row.id).map((u) => `${u.dayOfWeek}:${u.timeSlotId}`));
      const changed = before.size !== marked.size || [...marked].some((k) => !before.has(k));
      if (changed) await request("PUT", `/teachers/${row.id}/unavailability`, { slots: [...marked].map((k) => { const [d, s] = k.split(":").map(Number); return { dayOfWeek: d, timeSlotId: s }; }) });
      await onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide title={teacher ? "Edit teacher" : "Add teacher"}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim() || !emailOk || !limitsOk || saving} onClick={save} className="bg-brand text-white hover:bg-brand-mid">{saving ? "Saving…" : "Save"}</Button>
      </>}>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ms. Reyes" autoFocus /></Field>
        <Field label="Email" hint={!emailOk ? "That doesn't look like an email address." : "For sending schedules (optional)"}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" aria-invalid={!emailOk} /></Field>
        <Field label="Max periods / week" hint="Warns when they have more"><Input type="number" min={1} value={maxLoad} onChange={(e) => setMaxLoad(e.target.value)} placeholder="e.g. 25" /></Field>
        <Field label="Max periods / day" hint="Auto-fill keeps within this"><Input type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} placeholder="e.g. 6" /></Field>
      </div>
      {!limitsOk && <p className="text-xs text-destructive -mt-2 mb-3">Limits must be whole numbers from 1 to 80.</p>}
      <Field label="Subjects taught" hint="None picked = can teach anything">
        <Chips options={(subjects.data ?? []).map((s) => ({ id: s.id, label: s.name, color: s.color }))} value={subjectIds} onChange={setSubjectIds} />
      </Field>
      <Field label="Grade levels taught" hint="None picked = all grade levels">
        <Chips options={(gradeLevels.data ?? []).map((g) => ({ id: g.id, label: g.name }))} value={gradeLevelIds} onChange={setGradeLevelIds} />
      </Field>
      <div className="mb-2">
        <p className="text-sm font-semibold mb-1">Not available</p>
        <p className="text-xs text-muted-foreground mb-2">Tap periods they can't teach (part-time days, meetings, other duties). Tap a day or period name to mark the whole column or row.</p>
        {gridSlots.length ? (
          <SlotGrid days={days} slots={gridSlots} marked={marked} onChange={setMarked} isNa={(d, s) => !slotRunsOn(s, d, gradeFilter)} />
        ) : <p className="text-xs text-muted-foreground italic">Add periods in Setup first.</p>}
        {marked.size > 0 && <button type="button" className="text-xs text-brand hover:underline mt-1.5" onClick={() => setMarked(new Set())}>Clear all ({marked.size})</button>}
      </div>
      {err && <p role="alert" className="text-sm text-destructive font-medium mt-2">{err}</p>}
    </Modal>
  );
}
