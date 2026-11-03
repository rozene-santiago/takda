// A button that opens a list of actions: anchored under the button on larger
// screens, a bottom sheet on phones.
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn, MENU_CLS } from "@/lib/utils";

export interface MenuItem { label: string; onSelect: () => void; disabled?: boolean; hint?: string; danger?: boolean }
export interface MenuGroup { title?: string; items: MenuItem[] }

export function MenuButton({ label, icon, groups, variant = "outline", className, disabled, title, width = "sm:w-64" }: {
  label: ReactNode;
  icon?: ReactNode;
  groups: MenuGroup[];
  variant?: "outline" | "default";
  className?: string;
  disabled?: boolean;
  title?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const visible = groups.filter((g) => g.items.length);
  return (
    <div className="relative">
      <Button variant={variant} className={className} disabled={disabled} title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}{label}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent" onClick={() => setOpen(false)} />
          <div role="menu" className={cn(MENU_CLS, width, "py-1 max-h-[70vh] overflow-y-auto")}>
            {visible.map((g, gi) => (
              <div key={gi} className={cn(gi > 0 && "border-t border-border mt-1 pt-1")}>
                {g.title && <div className="px-3.5 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g.title}</div>}
                {g.items.map((it, i) => (
                  <button key={i} role="menuitem" disabled={it.disabled}
                    onClick={() => { setOpen(false); it.onSelect(); }}
                    className={cn("w-full text-left px-3.5 py-2.5 sm:py-2 text-sm font-medium hover:bg-brand-sage/15 disabled:opacity-40 disabled:hover:bg-transparent",
                      it.danger ? "text-destructive" : "text-brand-forest")}>
                    {it.label}
                    {it.hint && <span className="block text-xs font-normal text-muted-foreground">{it.hint}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
