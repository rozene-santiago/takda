import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Neutral fallback used when a subject has "No color" or a teacher has no subject.
export const NO_COLOR = "#9CA3AF";

// Teacher display color is derived from the first assigned subject's color.
// Falls back to neutral gray when no subject / no color.
export function teacherColor(
  subjectIds: number[] | undefined,
  subjects: { id: number; color: string | null }[] | undefined,
): string {
  const first = subjectIds?.[0];
  if (first == null) return NO_COLOR;
  const s = subjects?.find((x) => x.id === first);
  return s?.color || NO_COLOR;
}

/** Dropdown menus: anchored under their button on larger screens, a bottom sheet on phones. */
export const MENU_CLS = "fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom,0px))] sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-1 rounded-xl sm:rounded-lg border border-border bg-white shadow-2xl sm:shadow-lg z-50 overflow-hidden";
