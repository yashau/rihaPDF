// Tiny `window.matchMedia` wrapper hook. Used by App + PdfPage to pick
// mobile-vs-desktop layout / behaviour at render time. Built on
// `useSyncExternalStore` so the subscribe path is free of effects —
// React reads `matches` synchronously on first render and re-reads
// whenever the media query flips, with no setState-in-effect churn.
//
// The breakpoint convention follows Tailwind's `sm:` (640px) so a
// `useIsMobile()` consumer is in lockstep with the JSX-side
// `hidden sm:flex` / `flex sm:hidden` gating.

import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    // SSR fallback — rihaPDF is client-only but vitest's JSDOM env
    // is satisfied by returning the same default the browser would
    // hit before hydration.
    () => false,
  );
}

/** True when the viewport is below Tailwind's `sm` breakpoint. Drives
 *  mobile-vs-desktop layout decisions in App + PdfPage. */
export function useIsMobile(): boolean {
  return !useMediaQuery("(min-width: 640px)");
}
