import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export interface TabMeta {
  key: string; // route name in app/(tabs)
  title: string; // tab bar label
  header: string; // header title text
  icon: IoniconName;
}

// Source of truth for all bottom tabs, in their DEFAULT order.
export const TAB_META: TabMeta[] = [
  { key: "index", title: "Class Sched", header: "Class Schedule", icon: "grid-outline" },
  { key: "allocations", title: "Allocations", header: "Allocations", icon: "speedometer-outline" },
  { key: "teachers", title: "Teachers", header: "Teachers", icon: "people-outline" },
  { key: "teacher-schedule", title: "Tch. Sched", header: "Teacher Schedule", icon: "calendar-number-outline" },
  { key: "conflicts", title: "Conflicts", header: "Conflicts", icon: "warning-outline" },
  { key: "setup", title: "Setup", header: "Setup", icon: "construct-outline" },
];

// The Tabs settings screen itself is always reachable from Setup, so it is
// never part of the reorderable bottom-bar list.
export const SETTINGS_TAB_KEY = "tab-settings";

export interface TabConfigItem {
  key: string;
  visible: boolean;
}

export const DEFAULT_TAB_CONFIG: TabConfigItem[] = TAB_META.map((t) => ({
  key: t.key,
  visible: true,
}));

/**
 * Merge a stored config with TAB_META so the result is always valid:
 * - keeps stored order
 * - drops unknown keys
 * - appends any new tabs that aren't in the stored config (visible by default)
 */
export function resolveTabConfig(stored?: TabConfigItem[] | null): TabConfigItem[] {
  const known = new Set(TAB_META.map((t) => t.key));
  const seen = new Set<string>();
  const result: TabConfigItem[] = [];

  for (const item of stored ?? []) {
    if (known.has(item.key) && !seen.has(item.key)) {
      result.push({ key: item.key, visible: item.visible !== false });
      seen.add(item.key);
    }
  }
  for (const t of TAB_META) {
    if (!seen.has(t.key)) result.push({ key: t.key, visible: true });
  }
  // index must always remain visible (it's the initial route / fallback)
  const idx = result.find((r) => r.key === "index");
  if (idx) idx.visible = true;
  return result;
}

export function metaFor(key: string): TabMeta | undefined {
  return TAB_META.find((t) => t.key === key);
}
