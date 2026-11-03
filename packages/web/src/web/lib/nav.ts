import { CalendarDays, SlidersHorizontal, Gauge, Users, CalendarClock, DoorOpen, UserCheck, ClipboardList, ChartColumn } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavMeta {
  key: string; // shared key — matches mobile TAB_META keys so order/visibility sync across devices
  to: string; // wouter route
  label: string;
  icon: LucideIcon;
}

// Source of truth for sidebar items, in their DEFAULT order.
// Keys are intentionally identical to the mobile tab keys so a single
// `tabConfig` (stored on settings) keeps order + visibility consistent
// across web and mobile.
export const NAV_META: NavMeta[] = [
  { key: "index", to: "/", label: "Class Schedule", icon: CalendarDays },
  { key: "teacher-schedule", to: "/teacher-schedule", label: "Teacher Schedule", icon: CalendarClock },
  { key: "rooms", to: "/rooms", label: "Room Schedule", icon: DoorOpen },
  { key: "substitutions", to: "/substitutions", label: "Substitutions", icon: UserCheck },
  { key: "loads", to: "/loads", label: "Teaching Loads", icon: ClipboardList },
  { key: "allocations", to: "/allocations", label: "Allocations", icon: Gauge },
  { key: "teachers", to: "/teachers", label: "Teachers", icon: Users },
  { key: "reports", to: "/reports", label: "Reports", icon: ChartColumn },
  { key: "setup", to: "/setup", label: "Setup", icon: SlidersHorizontal },
];

export interface TabConfigItem {
  key: string;
  visible: boolean;
}

export const DEFAULT_NAV_CONFIG: TabConfigItem[] = NAV_META.map((n) => ({ key: n.key, visible: true }));

/**
 * Merge a stored config with NAV_META so the result is always valid:
 * - keeps stored order
 * - drops keys this platform doesn't have (e.g. mobile-only "conflicts")
 * - appends any new items not in the stored config (visible by default)
 * - "index" (Schedule) is always visible — it's the home/fallback route
 */
export function resolveNavConfig(stored?: TabConfigItem[] | null): NavMeta[] {
  const metaByKey = new Map(NAV_META.map((n) => [n.key, n]));
  const seen = new Set<string>();
  const ordered: { meta: NavMeta; visible: boolean }[] = [];

  for (const item of stored ?? []) {
    const meta = metaByKey.get(item.key);
    if (meta && !seen.has(item.key)) {
      ordered.push({ meta, visible: item.visible !== false });
      seen.add(item.key);
    }
  }
  for (const n of NAV_META) {
    if (!seen.has(n.key)) ordered.push({ meta: n, visible: true });
  }

  return ordered.filter((o) => o.visible || o.meta.key === "index").map((o) => o.meta);
}

/**
 * Build a full editable config list (all known items, with current visibility),
 * preserving stored order and appending unknowns. Used by the arrange UI so
 * hidden items still appear (toggleable).
 */
export function resolveNavConfigFull(stored?: TabConfigItem[] | null): TabConfigItem[] {
  const known = new Set(NAV_META.map((n) => n.key));
  const seen = new Set<string>();
  const result: TabConfigItem[] = [];

  for (const item of stored ?? []) {
    if (known.has(item.key) && !seen.has(item.key)) {
      result.push({ key: item.key, visible: item.visible !== false });
      seen.add(item.key);
    }
  }
  for (const n of NAV_META) {
    if (!seen.has(n.key)) result.push({ key: n.key, visible: true });
  }
  const idx = result.find((r) => r.key === "index");
  if (idx) idx.visible = true;
  return result;
}

export function navMetaFor(key: string): NavMeta | undefined {
  return NAV_META.find((n) => n.key === key);
}

// Lets other pages open a specific Setup tab (e.g. the term badge -> "Terms").
let pendingSetupTab: string | null = null;
export function openSetupTab(tab: string) { pendingSetupTab = tab; }
export function takeSetupTab(): string | null { const t = pendingSetupTab; pendingSetupTab = null; return t; }
