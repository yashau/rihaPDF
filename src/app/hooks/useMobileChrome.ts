import { useEffect, useRef, useState } from "react";
import { useVisualViewportFollow } from "@/platform/hooks/useVisualViewport";

/** State for the mobile-only header + sidebar drawer chrome. The
 *  mobile header is `position: fixed` (so it survives pinch-zoom via
 *  `useVisualViewportFollow`) — that takes it out of the flex flow,
 *  so we measure its height and the consumer pads <main> by the same
 *  amount to keep page content from sliding under it on first paint.
 *  The sidebar drawer auto-closes when the viewport flips back to
 *  desktop so reopening on mobile starts in a clean state. */
export function useMobileChrome(isMobile: boolean) {
  const mobileHeaderRef = useRef<HTMLElement | null>(null);
  const [mobileHeaderH, setMobileHeaderH] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) return;
    const el = mobileHeaderRef.current;
    if (!el) return;
    // ResizeObserver fires once on observe with the current size, then
    // again on each layout change (theme tweaks, font swap, etc.). We
    // round to avoid sub-pixel state churn.
    const ro = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setMobileHeaderH(Math.round(last.contentRect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

  // Counter pinch-zoom: keep the header visually fixed-size at the top
  // of the visual viewport even when the user pinches the page.
  useVisualViewportFollow(mobileHeaderRef, "top", isMobile);

  // Close the mobile drawer if the viewport widens past sm or the
  // document is closed — both states make the toggle invisible/disabled
  // and a stuck-open drawer would be unrecoverable.
  useEffect(() => {
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  return { mobileHeaderRef, mobileHeaderH, mobileSidebarOpen, setMobileSidebarOpen };
}
