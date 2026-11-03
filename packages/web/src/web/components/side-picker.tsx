// Choosing a section, teacher or room: a searchable list beside the timetable
// on larger screens, a dropdown on phones and tablets, and previous/next
// buttons everywhere.
import { useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocked } from "@/lib/hooks";

export interface PickItem {
  id: number;
  label: string;
  sub?: string;
  group?: string;
  /** Short text on the right, e.g. "30/30". */
  badge?: string;
  tone?: "ok" | "warn" | "error";
  color?: string;
}

const toneCls = { ok: "text-brand", warn: "text-[#9a6b00]", error: "text-destructive" } as const;

function groupItems(items: PickItem[]) {
  const out: { group?: string; items: PickItem[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.group === it.group) last.items.push(it);
    else out.push({ group: it.group, items: [it] });
  }
  return out;
}

export function SidePicker({ items, value, onChange, label, searchPlaceholder = "Search…", footer }: {
  items: PickItem[];
  value: number | null;
  onChange: (id: number) => void;
  label: string;
  searchPlaceholder?: string;
  footer?: ReactNode;
}) {
  const locked = useLocked();
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => `${i.label} ${i.sub ?? ""} ${i.group ?? ""}`.toLowerCase().includes(s)) : items;
  }, [items, q]);
  const groups = groupItems(filtered);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = filtered.findIndex((x) => x.id === value);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      onChange(next.id);
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" }));
    }
  };

  return (
    <aside aria-label={label} className={cn("hidden lg:flex flex-col w-[220px] xl:w-[240px] shrink-0 sticky self-start rounded-xl border border-border bg-card shadow-sm overflow-hidden",
      locked ? "top-14 max-h-[calc(100vh-4.5rem)]" : "top-4 max-h-[calc(100vh-2rem)]")}>
      <div className="p-2.5 border-b border-border">
        <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label} <span className="font-medium normal-case tracking-normal">· {items.length}</span></p>
        {items.length > 6 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={searchPlaceholder} aria-label={`Search ${label.toLowerCase()}`}
              className="w-full h-8 rounded-md border border-input bg-white pl-8 pr-7 text-sm outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-mid/25" />
            {q && <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>}
          </div>
        )}
      </div>
      <div ref={listRef} role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKey} className="flex-1 overflow-y-auto thin-scroll py-1 outline-none">
        {groups.map((g, gi) => (
          <div key={gi} role="group" aria-label={g.group}>
            {g.group && <p className="sticky top-0 z-[1] bg-card/95 backdrop-blur px-3.5 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.group}</p>}
            {g.items.map((it) => {
              const active = it.id === value;
              return (
                <button key={it.id} data-id={it.id} role="option" aria-selected={active} type="button" onClick={() => onChange(it.id)}
                  className={cn("relative w-full flex items-center gap-2 pl-3.5 pr-3 py-1.5 text-left text-sm transition",
                    active ? "bg-brand-sage/35 text-brand-forest font-semibold" : "text-foreground hover:bg-muted/70")}>
                  {active && <span className="absolute left-0 inset-y-1 w-[3px] rounded-r bg-brand" aria-hidden />}
                  {it.color && <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: it.color }} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" title={it.label}>{it.label}</span>
                    {it.sub && <span className="block truncate text-[11px] font-normal text-muted-foreground">{it.sub}</span>}
                  </span>
                  {it.badge && <span className={cn("shrink-0 text-[11px] font-semibold tabular-nums", it.tone ? toneCls[it.tone] : "text-muted-foreground")}>{it.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && <p className="px-3.5 py-6 text-sm text-muted-foreground text-center">No match.</p>}
      </div>
      {footer && <div className="border-t border-border p-2.5">{footer}</div>}
    </aside>
  );
}

/** Above the timetable: the current choice, a dropdown on small screens, and previous/next. */
export function PickerBar({ items, value, onChange, label, info, children }: {
  items: PickItem[];
  value: number | null;
  onChange: (id: number) => void;
  label: string;
  info?: ReactNode;
  children?: ReactNode;
}) {
  const i = items.findIndex((x) => x.id === value);
  const cur = items[i];
  const groups = groupItems(items);
  const nav = (d: number) => { const n = items[i + d]; if (n) onChange(n.id); };
  const navBtn = "size-9 grid place-items-center rounded-md border border-input bg-background hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent shrink-0";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <div className="flex items-center gap-2 min-w-0 w-full lg:w-auto">
        <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}
          className="lg:hidden h-10 min-w-0 flex-1 rounded-lg border border-input bg-white px-3 text-base font-semibold text-brand-forest outline-none focus:border-brand-mid">
          {groups.map((g, gi) => g.group
            ? <optgroup key={gi} label={g.group}>{g.items.map((it) => <option key={it.id} value={it.id}>{it.label}{it.badge ? ` (${it.badge})` : ""}</option>)}</optgroup>
            : g.items.map((it) => <option key={it.id} value={it.id}>{it.label}{it.badge ? ` (${it.badge})` : ""}</option>))}
        </select>
        <div className="hidden lg:block min-w-0">
          <h2 className="font-display text-xl font-bold text-brand-forest leading-tight truncate">{cur?.label ?? "—"}{cur?.group && <span className="ml-2 text-sm font-semibold text-muted-foreground">{cur.group}</span>}</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className={navBtn} onClick={() => nav(-1)} disabled={i <= 0} aria-label={`Previous ${label.toLowerCase()}`} title="Previous"><ChevronLeft className="size-4" /></button>
          <button type="button" className={navBtn} onClick={() => nav(1)} disabled={i < 0 || i >= items.length - 1} aria-label={`Next ${label.toLowerCase()}`} title="Next"><ChevronRight className="size-4" /></button>
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 max-w-full lg:ml-auto">{children}</div>}
      {info && <div className="basis-full text-xs text-muted-foreground -mt-1">{info}</div>}
    </div>
  );
}

/** Small segmented control (e.g. All days / Mon / Tue…). */
export function Segmented<T extends string | number>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto thin-scroll rounded-lg border border-input bg-white p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} title={o.title} onClick={() => onChange(o.value)}
          className={cn("shrink-0 px-3 h-8 rounded-md text-sm font-semibold transition whitespace-nowrap inline-flex items-center gap-1.5",
            value === o.value ? "bg-brand text-white shadow-sm" : "text-brand-forest hover:bg-brand-sage/20")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
