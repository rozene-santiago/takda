// Small shared controls: toggle chips for picking several items, and a
// day × period grid for marking times (e.g. when a teacher is unavailable).
import { cn } from "@/lib/utils";
import { DAY_SHORT } from "@/lib/types";
import type { TimeSlot } from "@/lib/types";

export function Chips<T extends number | string>({ options, value, onChange, emptyLabel }: {
  options: { id: T; label: string; color?: string | null }[];
  value: T[];
  onChange: (next: T[]) => void;
  /** Shown when nothing is picked (e.g. "All grades"). */
  emptyLabel?: string;
}) {
  const toggle = (id: T) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button key={String(o.id)} type="button" onClick={() => toggle(o.id)} aria-pressed={on}
            className={cn("px-2.5 py-1 rounded-lg text-sm font-semibold border-2 transition",
              on ? "text-white border-transparent" : "bg-white text-foreground border-border hover:border-brand-mid")}
            style={on ? { backgroundColor: o.color || "var(--color-brand, #007041)" } : undefined}>
            {o.label}
          </button>
        );
      })}
      {options.length === 0 && <span className="text-xs text-muted-foreground italic">Nothing to choose yet.</span>}
      {emptyLabel && value.length === 0 && options.length > 0 && <span className="self-center text-xs text-muted-foreground italic ml-1">{emptyLabel}</span>}
    </div>
  );
}

/** Tap cells to mark them; tap a day or period heading to toggle the whole column/row. */
export function SlotGrid({ days, slots, marked, onChange, isNa }: {
  days: number[];
  slots: TimeSlot[];
  marked: Set<string>; // "day:slotId"
  onChange: (next: Set<string>) => void;
  isNa?: (day: number, slot: TimeSlot) => boolean;
}) {
  const usable = (d: number, s: TimeSlot) => !s.isBreak && !isNa?.(d, s);
  const set = (keys: string[], on: boolean) => {
    const next = new Set(marked);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    onChange(next);
  };
  const toggleKeys = (keys: string[]) => set(keys, !keys.every((k) => marked.has(k)));
  return (
    <div className="overflow-x-auto thin-scroll rounded-lg border border-border">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="p-1.5 text-left font-semibold text-muted-foreground bg-muted/40">Period</th>
            {days.map((d) => (
              <th key={d} className="p-0 bg-muted/40 border-l border-border">
                <button type="button" className="w-full p-1.5 font-bold text-brand-forest hover:bg-brand-sage/30"
                  onClick={() => toggleKeys(slots.filter((s) => usable(d, s)).map((s) => `${d}:${s.id}`))}>{DAY_SHORT[d]}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id} className="border-t border-border">
              <td className="p-0">
                <button type="button" disabled={s.isBreak} className="w-full text-left p-1.5 hover:bg-brand-sage/30 disabled:hover:bg-transparent"
                  onClick={() => toggleKeys(days.filter((d) => usable(d, s)).map((d) => `${d}:${s.id}`))}>
                  <span className="font-semibold">{s.label}</span> <span className="text-muted-foreground">{s.startTime}</span>
                </button>
              </td>
              {days.map((d) => {
                const k = `${d}:${s.id}`;
                if (!usable(d, s)) return <td key={d} className="border-l border-border bg-muted/50" />;
                const on = marked.has(k);
                return (
                  <td key={d} className="border-l border-border p-0">
                    <button type="button" aria-pressed={on} aria-label={`${DAY_SHORT[d]} ${s.label}`} onClick={() => set([k], !on)}
                      className={cn("w-full h-8 transition", on ? "bg-destructive/80 hover:bg-destructive" : "hover:bg-brand-sage/30")} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
