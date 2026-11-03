import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Page, PageHeader } from "@/components/page";
import { Card, EmptyState, Modal, Field, Select, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ImportButton } from "@/components/import-button";
import { useGradeLevels, useSubjects, useAllocations, useAct } from "@/lib/hooks";
import type { Allocation } from "@/lib/types";
import { Gauge, Trash2, SlidersHorizontal } from "lucide-react";
import { useState, useEffect } from "react";
import { useConfirm } from "@/lib/confirm";
import { NO_COLOR, cn } from "@/lib/utils";

export default function AllocationsPage() {
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const allocations = useAllocations();
  const act = useAct();
  const confirm = useConfirm();
  const [rules, setRules] = useState<{ gradeLevelId: number; subjectId: number } | null>(null);

  const save = (a: { gradeLevelId: number; subjectId: number; periodsPerWeek?: number; blockSize?: number; maxPerDay?: number | null }) =>
    act("POST", "/allocations", a, { invalidate: ["allocations", "conflicts"] });
  const allocCount = allocations.data?.filter((a) => a.periodsPerWeek > 0).length ?? 0;
  const handleClearAll = async () => {
    if (await confirm({ title: "Reset all allocations?", message: `All ${allocCount} subject allocations go back to 0 periods a week. You can undo this afterwards.`, confirmLabel: "Reset all" }))
      act("POST", "/allocations/clear", {}, { invalidate: ["allocations", "conflicts"] });
  };

  const loading = grades.isLoading || subjects.isLoading || allocations.isLoading;
  const noData = !loading && ((grades.data?.length ?? 0) === 0 || (subjects.data?.length ?? 0) === 0);
  const find = (g: number, s: number) => allocations.data?.find((a) => a.gradeLevelId === g && a.subjectId === s);
  const get = (g: number, s: number) => find(g, s)?.periodsPerWeek ?? 0;

  return (
    <Layout>
      <Page>
        <PageHeader title="Subject Allocations" subtitle="Periods per week for each subject in each grade, plus double periods and daily limits. Drives auto-fill and the checks."
          tools={[{ key: "reset", label: "Reset all", icon: <Trash2 className="size-4" />, danger: true, hidden: allocCount === 0, onSelect: handleClearAll }]}
          actions={<ImportButton endpoint="/allocations/import" headerHints={["grade", "subject", "period"]} itemLabel="allocation" />} />
        <p className="text-xs text-muted-foreground -mt-3 mb-4">Import columns: grade level, subject, periods per week, block size (2 = double periods), max per day. Tap <SlidersHorizontal className="inline size-3" /> in a cell for double periods and daily limits.</p>

        {loading && <p className="text-muted-foreground">Loading…</p>}
        {noData && <Card><EmptyState icon={<Gauge className="size-12" />} title="Need grades & subjects first"
          hint="Add grade levels and subjects in Setup, then set allocations here." action={<Link href="/setup"><Button className="bg-brand text-white hover:bg-brand-mid">Go to Setup</Button></Link>} /></Card>}

        {!loading && !noData && (
          <Card className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-display font-bold text-brand-forest sticky left-0 bg-card z-10">Subject</th>
                  {grades.data!.map((g) => <th key={g.id} className="p-3 font-display font-bold text-brand-forest text-center min-w-[120px]">{g.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {subjects.data!.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="p-3 sticky left-0 bg-card z-10">
                      <span className="inline-flex items-center gap-2 font-semibold whitespace-nowrap"><span className="size-3 rounded" style={{ backgroundColor: s.color || NO_COLOR }} /> {s.name}</span>
                    </td>
                    {grades.data!.map((g) => {
                      const a = find(g.id, s.id);
                      const tag = a && a.periodsPerWeek > 0 ? [a.blockSize > 1 ? (a.blockSize === 2 ? "doubles" : `blocks of ${a.blockSize}`) : null, a.maxPerDay ? `max ${a.maxPerDay}/day` : null].filter(Boolean).join(" · ") : "";
                      return (
                        <td key={g.id} className="p-2 text-center">
                          <div className="inline-flex items-center gap-1">
                            <AllocCell value={get(g.id, s.id)} onSave={(v) => save({ gradeLevelId: g.id, subjectId: s.id, periodsPerWeek: v })} label={`${s.name} periods per week in ${g.name}`} />
                            <button type="button" aria-label={`Rules for ${s.name} in ${g.name}`} onClick={() => setRules({ gradeLevelId: g.id, subjectId: s.id })}
                              className={cn("p-1.5 rounded-md hover:bg-muted", tag ? "text-brand" : "text-muted-foreground/60")}><SlidersHorizontal className="size-3.5" /></button>
                          </div>
                          {tag && <div className="text-[10px] text-brand-forest mt-0.5">{tag}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-brand-sage/30 font-bold">
                  <td className="p-3 sticky left-0 bg-brand-sage/30 font-display text-brand-forest z-10">Total / week</td>
                  {grades.data!.map((g) => <td key={g.id} className="p-3 text-center text-brand-forest">{subjects.data!.reduce((sum, s) => sum + get(g.id, s.id), 0)}</td>)}
                </tr>
              </tbody>
            </table>
          </Card>
        )}
      </Page>
      {rules && (
        <RulesModal allocation={find(rules.gradeLevelId, rules.subjectId)} subject={subjects.data?.find((s) => s.id === rules.subjectId)?.name ?? ""} grade={grades.data?.find((g) => g.id === rules.gradeLevelId)?.name ?? ""}
          onClose={() => setRules(null)} onSave={async (v) => { await save({ ...rules, ...v }); setRules(null); }} />
      )}
    </Layout>
  );
}

function AllocCell({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const bad = v.trim() !== "" && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 60);
  return (
    <input type="number" inputMode="numeric" min={0} max={60} value={v} aria-label={label} aria-invalid={bad}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = Math.round(Number(v) || 0); if (bad) { setV(String(value)); return; } if (n !== value) onSave(Math.max(0, n)); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={cn("w-16 h-9 text-center rounded-lg border bg-white outline-none focus:ring-2 transition", bad ? "border-destructive focus:ring-destructive/30" : "border-input focus:border-brand-mid focus:ring-brand-mid/30")} />
  );
}

function RulesModal({ allocation, subject, grade, onClose, onSave }: {
  allocation?: Allocation; subject: string; grade: string; onClose: () => void;
  onSave: (v: { periodsPerWeek: number; blockSize: number; maxPerDay: number | null }) => void;
}) {
  const [per, setPer] = useState(String(allocation?.periodsPerWeek ?? 0));
  const [block, setBlock] = useState(allocation?.blockSize ?? 1);
  const [maxDay, setMaxDay] = useState(allocation?.maxPerDay ? String(allocation.maxPerDay) : "");
  const p = Number(per), m = maxDay ? Number(maxDay) : null;
  const err = !Number.isInteger(p) || p < 0 || p > 60 ? "Periods per week must be a whole number from 0 to 60."
    : m != null && (!Number.isInteger(m) || m < 1) ? "Max per day must be a whole number, 1 or more."
    : m != null && m < block ? "Max per day can't be smaller than the block size."
    : block > 1 && p % block !== 0 ? `With blocks of ${block}, ${p} periods leaves ${p % block} single period${p % block === 1 ? "" : "s"} (that's allowed, just so you know).` : null;
  const hardErr = err && !err.startsWith("With blocks");
  return (
    <Modal open onClose={onClose} title={`${subject} · ${grade}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!!hardErr} onClick={() => onSave({ periodsPerWeek: p, blockSize: block, maxPerDay: m })} className="bg-brand text-white hover:bg-brand-mid">Save</Button></>}>
      <Field label="Periods per week"><Input type="number" min={0} max={60} value={per} onChange={(e) => setPer(e.target.value)} /></Field>
      <Field label="Schedule as" hint="Double periods are placed back to back on the same day (for labs, PE, TLE…).">
        <Select value={block} onChange={(e) => setBlock(Number(e.target.value))}>
          <option value={1}>Single periods</option>
          <option value={2}>Double periods (2 in a row)</option>
          <option value={3}>Blocks of 3</option>
          <option value={4}>Blocks of 4</option>
        </Select>
      </Field>
      <Field label="Max periods per day" hint="Leave empty for no limit. Auto-fill spreads the subject across the week either way.">
        <Input type="number" min={1} value={maxDay} onChange={(e) => setMaxDay(e.target.value)} placeholder="No limit" />
      </Field>
      {err && <p className={cn("text-sm", hardErr ? "text-destructive" : "text-muted-foreground")}>{err}</p>}
    </Modal>
  );
}
