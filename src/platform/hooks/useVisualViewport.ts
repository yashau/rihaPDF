// Hooks that anchor `position: fixed` chrome to the visual viewport
// rather than the layout viewport, so the toolbar / header:
//
//   - Stay visible above the soft keyboard (Chromium-based mobile
//     browsers don't shrink `100dvh` for the keyboard, only iOS
//     Safari does — so dvh is unreliable cross-browser).
//   - Stay at constant *visual* size when the user pinch-zooms the
//     page. By default `position: fixed` is layout-anchored, so a
//     pinched layout makes the chrome appear zoomed-in. Counter-
//     scaling by `1/visualViewport.scale` cancels that out.
//
// Both behaviours fall out of the same recipe: read
// `window.visualViewport.{offsetLeft, offsetTop, height, scale}` and
// drive a `transform: translate(...) scale(1/scale)` on the element,
// pinned to either the top or the bottom of the visual viewport.

import { useEffect, type RefObject } from "react";

/** Apply a visualViewport-driven transform to `ref` so it stays
 *  anchored to the visual viewport's top (or bottom) edge at constant
 *  visual size, surviving pinch-zoom and keyboard show/hide.
 *
 *  The element must already have `position: fixed`, `left: 0`,
 *  `right: 0`, and the matching `top: 0` / `bottom: 0` for `anchor`
 *  applied via CSS — the hook only writes `transform` and
 *  `transform-origin`. */
export function useVisualViewportFollow(
  ref: RefObject<HTMLElement | null>,
  anchor: "top" | "bottom",
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const applyTransform = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      // For an anchor at `top: 0`, translate(0, vv.offsetTop) lands the
      // element's top at the visual viewport's top edge. For `bottom: 0`
      // we compensate for the gap between layout-bottom (where the
      // element naturally sits) and the visual-viewport bottom (where
      // we want it) — that gap is negative when the keyboard is open
      // or the user has pinch-scrolled away from the page edge.
      const tx = vv.offsetLeft;
      const ty = anchor === "top" ? vv.offsetTop : vv.offsetTop + vv.height - window.innerHeight;
      const s = 1 / vv.scale;
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      // Pivot from the anchored corner so the inverse-scale doesn't
      // pull the element off its anchor edge.
      el.style.transformOrigin = anchor === "top" ? "0 0" : "0 100%";
    };
    // The visualViewport `resize` / `scroll` events fire several frames
    // behind the actual pinch gesture, so applying the counter-scale
    // transform live makes the chrome look like it's "playing catch-
    // up" with the user — visibly jittering. Mask that by fading the
    // chrome out while a scale change is in flight, snapping the new
    // transform on once the gesture settles (no events for ~150 ms),
    // then fading back in. Keyboard show/hide goes through the same
    // listener but doesn't change scale, so it bypasses the fade and
    // updates live.
    el.style.transition = "opacity 90ms linear";
    let lastScale = window.visualViewport?.scale ?? 1;
    let settleHandle: number | null = null;
    let hidden = false;
    const onChange = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const scaleChanged = Math.abs(vv.scale - lastScale) > 0.001;
      lastScale = vv.scale;
      if (!scaleChanged) {
        applyTransform();
        return;
      }
      if (!hidden) {
        hidden = true;
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
      }
      if (settleHandle !== null) window.clearTimeout(settleHandle);
      settleHandle = window.setTimeout(() => {
        settleHandle = null;
        hidden = false;
        applyTransform();
        el.style.opacity = "1";
        el.style.pointerEvents = "";
      }, 150);
    };
    applyTransform();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onChange);
    vv?.addEventListener("scroll", onChange);
    return () => {
      vv?.removeEventListener("resize", onChange);
      vv?.removeEventListener("scroll", onChange);
      if (settleHandle !== null) window.clearTimeout(settleHandle);
      el.style.opacity = "";
      el.style.transition = "";
      el.style.pointerEvents = "";
    };
  }, [ref, anchor, enabled]);
}

/** Walk up the DOM until we find an ancestor with a scrollable
 *  overflow. The page list scrolls inside `<main className="overflow-
 *  auto">` rather than the document, so `window.scrollBy` is a no-op. */
function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const cs = getComputedStyle(cur);
    if (cs.overflowY === "auto" || cs.overflowY === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** Scroll so `inputRef` sits at the vertical centre of the *visible*
 *  viewport (the area not covered by the soft keyboard or the bottom-
 *  pinned edit toolbar). Re-runs on visualViewport resize so it
 *  re-centres when the keyboard animates open / closed.
 *
 *  The toolbar height is read from `[data-edit-toolbar]` at run time so
 *  callers don't need to thread a measurement through. */
export function useCenterInVisibleViewport(
  inputRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = inputRef.current;
    if (!el) return;
    let cancelled = false;
    const center = () => {
      if (cancelled || !el.isConnected) return;
      const vv = window.visualViewport;
      const vvHeight = vv?.height ?? window.innerHeight;
      const vvTop = vv?.offsetTop ?? 0;
      const toolbar = document.querySelector<HTMLElement>("[data-edit-toolbar]");
      // `getBoundingClientRect()` includes any visualViewport-driven
      // transform applied to the toolbar, so the height we subtract is
      // the toolbar's *post-transform* layout height — which is what
      // matters when computing visible-viewport occupation in layout
      // coords. (offsetHeight is the natural / pre-transform height
      // and would be wrong while pinch-zoomed.)
      const toolbarH = toolbar?.getBoundingClientRect().height ?? 0;
      // Visible region for the input: from the top of the visual
      // viewport down to the top of the toolbar. Centre of that range
      // is where we want the input's vertical midpoint to land.
      const visibleCenter = vvTop + (vvHeight - toolbarH) / 2;
      const rect = el.getBoundingClientRect();
      const inputCenter = rect.top + rect.height / 2;
      const delta = inputCenter - visibleCenter;
      if (Math.abs(delta) <= 1) return;
      // The page list scrolls inside <main>, not the document — so
      // `window.scrollBy` would be a no-op. Find the actual scroller.
      const scroller = findScrollContainer(el);
      if (scroller) scroller.scrollBy({ top: delta, behavior: "auto" });
      else window.scrollBy({ top: delta, behavior: "auto" });
    };
    // First pass after the keyboard animation typically finishes.
    // Without the delay we'd centre against the pre-keyboard viewport
    // and end up scrolled too far down.
    const handle = window.setTimeout(center, 350);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", center);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      vv?.removeEventListener("resize", center);
    };
  }, [enabled, inputRef]);
}
