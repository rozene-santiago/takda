// Page frame: full-width content area and a header whose buttons fold into a
// "More" menu when the window is too narrow to show them all.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Undo2, Redo2, MoreHorizontal, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuButton, type MenuGroup } from "@/components/menu";
import { useLocked } from "@/lib/hooks";
import { useHistory } from "@/lib/history";
import { cn } from "@/lib/utils";

/** Content area of a page: uses the full width of the window. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-full px-4 sm:px-6 lg:px-8 2xl:px-10 pt-4 sm:pt-6 lg:pt-7 pb-10", className)}>{children}</div>;
}

export interface Tool {
  key: string;
  label: string;
  icon?: ReactNode;
  /** A plain button… */
  onSelect?: () => void;
  /** …or a button that opens a menu. */
  groups?: MenuGroup[];
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  hidden?: boolean;
}

const GAP = 8;

/**
 * Title on the left, buttons on the right on one line. Buttons are listed in
 * order of importance: when space runs out the last ones move into "More".
 * `primary` (the page's main action) always stays visible.
 */
export function PageHeader({ title, subtitle, tools = [], primary, actions }: {
  title: string;
  subtitle?: ReactNode;
  tools?: Tool[];
  primary?: ReactNode;
  /** Older pages: free-form buttons shown before `primary`. */
  actions?: ReactNode;
}) {
  const locked = useLocked();
  const items = tools.filter((t) => !t.hidden);
  const barRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const sig = items.map((t) => `${t.key}:${t.label}`).join("|");

  useLayoutEffect(() => {
    const bar = barRef.current, measure = measureRef.current;
    if (!bar || !measure) return;
    const compute = () => {
      const widths = Array.from(measure.children).map((c) => (c as HTMLElement).offsetWidth);
      const moreW = widths.pop() ?? 90;
      const fixedW = fixedRef.current?.offsetWidth ?? 0;
      const leadW = leadRef.current?.offsetWidth ?? 0;
      const avail = bar.clientWidth - fixedW - (fixedW ? GAP : 0) - leadW - (leadW ? GAP : 0) - 2;
      let used = 0, k = 0;
      for (; k < widths.length; k++) {
        const next = used + widths[k] + (k ? GAP : 0);
        const needMore = k + 1 < widths.length;
        if (next + (needMore ? GAP + moreW : 0) > avail) break;
        used = next;
      }
      setVisibleCount(k);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(bar);
    if (fixedRef.current) ro.observe(fixedRef.current);
    if (leadRef.current) ro.observe(leadRef.current);
    return () => ro.disconnect();
  }, [sig, locked]);

  const shown = items.slice(0, visibleCount);
  const folded = items.slice(visibleCount);
  const moreGroups: MenuGroup[] = folded.flatMap((t): MenuGroup[] =>
    t.groups
      ? t.groups.filter((g) => g.items.length).map((g) => ({ title: g.title ? `${t.label} · ${g.title}` : t.label, items: g.items }))
      : [{ items: [{ label: t.label, onSelect: t.onSelect ?? (() => {}), disabled: t.disabled, danger: t.danger, hint: t.title }] }]);
  // Merge consecutive plain buttons into one group so the menu stays compact.
  const merged: MenuGroup[] = [];
  for (const g of moreGroups) {
    const last = merged[merged.length - 1];
    if (!g.title && last && !last.title) last.items.push(...g.items);
    else merged.push({ ...g, items: [...g.items] });
  }

  return (
    <header className="mb-5 sm:mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-x-6 gap-y-3">
        <h1 className="font-display text-2xl sm:text-[1.75rem] font-extrabold text-brand-forest tracking-tight leading-tight shrink-0">{title}</h1>
        <div ref={barRef} className="relative flex-1 min-w-0 flex items-center sm:justify-end gap-2">
          {/* invisible copies, used only to measure how much room each button needs */}
          <div ref={measureRef} aria-hidden className="absolute left-0 top-0 flex gap-2 invisible pointer-events-none h-0 overflow-hidden" style={{ width: "max-content" }}>
            {items.map((t) => <ToolButton key={t.key} tool={t} measuring />)}
            <Button variant="outline" tabIndex={-1}><MoreHorizontal className="size-4" /> More</Button>
          </div>
          {!locked && (
            <div ref={leadRef} className="flex items-center gap-2 shrink-0">
              <UndoRedo />
              {items.length > 0 && <span className="hidden sm:block w-px h-6 bg-border" aria-hidden />}
            </div>
          )}
          <div className="flex items-center gap-2 min-w-0">
            {shown.map((t) => <ToolButton key={t.key} tool={t} />)}
            {folded.length > 0 && <MenuButton label="More" icon={<MoreHorizontal className="size-4" />} groups={merged} width="sm:w-72" />}
          </div>
          <div ref={fixedRef} className="flex items-center gap-2 shrink-0 empty:hidden ml-auto sm:ml-0">
            {actions}
            {primary}
          </div>
        </div>
      </div>
      {subtitle && <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl">{subtitle}</p>}
    </header>
  );
}

function ToolButton({ tool, measuring }: { tool: Tool; measuring?: boolean }) {
  if (tool.groups) {
    if (measuring) return <Button variant="outline" tabIndex={-1}>{tool.icon}{tool.label}<ChevronDown className="size-3.5 opacity-60" /></Button>;
    return <MenuButton label={<>{tool.label}<ChevronDown className="size-3.5 opacity-60" /></>} icon={tool.icon} groups={tool.groups} disabled={tool.disabled} title={tool.title} width="sm:w-72" />;
  }
  return (
    <Button variant="outline" tabIndex={measuring ? -1 : undefined} onClick={measuring ? undefined : tool.onSelect} disabled={tool.disabled} title={tool.title}
      className={cn(tool.danger && "text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive")}>
      {tool.icon}{tool.label}
    </Button>
  );
}

/** Undo / redo for the last change made anywhere in the app. */
export function UndoRedo() {
  const h = useHistory();
  return (
    <div className="flex items-center shrink-0 rounded-md border border-input bg-background shadow-xs overflow-hidden">
      <button type="button" aria-label={h.undoLabel ? `Undo: ${h.undoLabel}` : "Undo"} title={h.undoLabel ? `Undo: ${h.undoLabel} (Ctrl+Z)` : "Nothing to undo"}
        onClick={() => h.undo()} disabled={!h.canUndo || h.busy}
        className="h-9 w-10 grid place-items-center hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent transition">
        <Undo2 className="size-4" />
      </button>
      <span className="w-px h-5 bg-border" aria-hidden />
      <button type="button" aria-label={h.redoLabel ? `Redo: ${h.redoLabel}` : "Redo"} title={h.redoLabel ? `Redo: ${h.redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo"}
        onClick={() => h.redo()} disabled={!h.canRedo || h.busy}
        className="h-9 w-10 grid place-items-center hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent transition">
        <Redo2 className="size-4" />
      </button>
    </div>
  );
}
