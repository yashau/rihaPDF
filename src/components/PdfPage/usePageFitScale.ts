import { useLayoutEffect, useRef, useState } from "react";

export function usePageFitScale(pageViewWidth: number): {
  fitRef: React.RefObject<HTMLDivElement | null>;
  fitScale: number;
} {
  /** Outer layout wrapper. Reserves display-pixel space for the page
   *  (= natural × displayScale) so the document scroll container can
   *  size itself correctly. */
  const fitRef = useRef<HTMLDivElement | null>(null);
  /** Fit-to-width scale applied before the user-controlled mobile
   *  document zoom. 1 on desktop where the page already fits; <1 on
   *  mobile where it doesn't. */
  const [fitScale, setFitScale] = useState(1);

  // Compute displayScale synchronously before paint so the first frame
  // already shows the page at the correct mobile fit.
  useLayoutEffect(() => {
    const outer = fitRef.current;
    if (!outer) return;
    // Find the nearest scroll container — App's <main> with
    // `overflow: auto`. The immediate parent of `outer` is a flex
    // item that shrinks to fit its content, so observing it would
    // create a feedback loop where displayScale stays at 1 forever.
    let scrollHost: HTMLElement | null = outer.parentElement;
    while (scrollHost && scrollHost !== document.body) {
      const cs = window.getComputedStyle(scrollHost);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll" || scrollHost.tagName === "MAIN") {
        break;
      }
      scrollHost = scrollHost.parentElement;
    }
    if (!scrollHost || scrollHost === document.body) {
      scrollHost = document.documentElement;
    }
    const host = scrollHost;
    const compute = () => {
      const cs = window.getComputedStyle(host);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const available = host.clientWidth - padX;
      if (available <= 0 || !pageViewWidth) return;
      const next = Math.min(1, available / pageViewWidth);
      setFitScale((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(host);
    return () => ro.disconnect();
  }, [pageViewWidth]);

  return { fitRef, fitScale };
}
