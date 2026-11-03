export const C = {
  brand: "#007041",
  mid: "#338D67",
  bright: "#00AD6D",
  sage: "#ADD1C2",
  forest: "#1E3D32",
  lime: "#BDF261",
  cream: "#EAE6DA",
  wood: "#7F5237",
  warning: "#D99A00",
  danger: "#C0392B",
  bg: "#F4F2EA",
  card: "#FFFFFF",
  text: "#1A1A1A",
  muted: "#5B6660",
  border: "#E3E1D8",
};

export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const NO_COLOR = "#9CA3AF";

// Teacher display color derived from first assigned subject (gray fallback).
export function teacherColor(
  subjectIds: number[] | undefined,
  subjects: { id: number; color: string | null }[] | undefined,
): string {
  const first = subjectIds?.[0];
  if (first == null) return NO_COLOR;
  const s = subjects?.find((x) => x.id === first);
  return s?.color || NO_COLOR;
}
