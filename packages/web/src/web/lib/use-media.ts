import { useSyncExternalStore } from "react";

/** True while the CSS media query matches (e.g. "(min-width: 1536px)"). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind breakpoints, for layout decisions made in code. */
export const BP = { sm: "(min-width: 640px)", md: "(min-width: 768px)", lg: "(min-width: 1024px)", xl: "(min-width: 1280px)", "2xl": "(min-width: 1536px)", wide: "(min-width: 1700px)" } as const;
