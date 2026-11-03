import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("bg-card rounded-xl border border-border shadow-sm", className)}>{children}</div>;
}

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  // Rendered at the end of <body> so a dialog opened from inside the sliding
  // menu (which is transformed) still covers the whole screen.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[max(12px,env(safe-area-inset-bottom,0px))] bg-black/40 animate-fade-up" onClick={onClose}>
      <div className={cn("bg-card rounded-2xl shadow-2xl w-full max-h-[88vh] max-h-[88dvh] overflow-hidden flex flex-col", wide ? "max-w-2xl" : "max-w-md")}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-border">
          <h3 className="font-display text-lg font-bold text-brand-forest min-w-0">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-muted-foreground hover:text-foreground transition rounded-md p-1.5 hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-4 sm:p-5 overflow-y-auto thin-scroll">{children}</div>
        {footer && <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-t border-border flex flex-wrap justify-end gap-2 bg-muted/40">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-semibold text-foreground mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full h-10 rounded-lg border border-input bg-white px-3 text-base sm:text-sm outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-mid/30 transition", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("w-full h-10 rounded-lg border border-input bg-white px-3 text-base sm:text-sm outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-mid/30 transition", props.className)} />;
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}
      style={color ? { backgroundColor: color + "22", color } : undefined}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 sm:py-16 px-5 sm:px-6">
      <div className="text-brand-sage mb-3">{icon}</div>
      <p className="font-display font-bold text-lg text-brand-forest">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const PALETTE = ["#007041", "#338D67", "#00AD6D", "#7F5237", "#2C4D46", "#D99A00", "#1E3D32", "#5B8C5A", "#A8763E", "#3C6E71"];
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export function ColorPicker({ value, onChange, allowNone }: { value: string | null; onChange: (c: string | null) => void; allowNone?: boolean }) {
  const [hex, setHex] = useState(value ?? "");
  const safe = value && HEX_RE.test(value) ? value : "#338D67";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {allowNone && (
          <button type="button" onClick={() => { onChange(null); setHex(""); }}
            title="No color"
            className={cn("size-8 rounded-lg border-2 grid place-items-center bg-white transition", !value ? "border-foreground scale-110" : "border-border")}>
            <span className="block w-5 h-0.5 bg-destructive rotate-45 rounded" />
          </button>
        )}
        {PALETTE.map((c) => (
          <button key={c} type="button" onClick={() => { onChange(c); setHex(c); }}
            className={cn("size-8 rounded-lg border-2 transition", (value ?? "").toLowerCase() === c.toLowerCase() ? "border-foreground scale-110" : "border-transparent")}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={safe} onChange={(e) => { onChange(e.target.value); setHex(e.target.value); }}
          className="size-9 rounded-lg border border-border cursor-pointer bg-white p-0.5" title="Pick a color" />
        <div className="flex items-center rounded-lg border border-border bg-white overflow-hidden">
          <span className="px-2 text-muted-foreground text-sm">#</span>
          <input value={hex.replace(/^#/, "")} placeholder="338D67"
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
              setHex("#" + raw);
              const next = "#" + raw;
              if (HEX_RE.test(next)) onChange(next);
              else if (raw === "" && allowNone) onChange(null);
            }}
            className="w-24 py-1.5 pr-2 text-sm font-mono outline-none bg-transparent" maxLength={6} />
        </div>
        {hex && !HEX_RE.test(hex) && hex !== "#" && <span className="text-xs text-destructive">Invalid hex</span>}
      </div>
    </div>
  );
}
