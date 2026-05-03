// Single drag-gesture hook used by every drag/resize closure in
// PdfPage. Owns the window-level pointer listener registration,
// per-pointer-type threshold, and `pointercancel` wiring (iOS palm
// rejection + system-gesture takeovers fire `pointercancel` instead of
// `pointerup`; without that branch a finger-drag interrupted by the
// system would leave the drag state stuck forever).
//
// Pointer events on `window` (not `setPointerCapture` on the target)
// continue firing across element boundaries without redirection — a
// run-overlay can hand off a drag to the page beneath it for a
// cross-page drop without the original element needing to stay under
// the finger.
//
// The hook is intentionally generic: it carries a caller-supplied
// `ctx` value through `onStart` → `onMove` → `onEnd`/`onCancel` so
// each call site can stash its own per-gesture closure data
// (originRect, effectiveScale, baseline coords) without the hook
// needing to know what they are.

import { useEffect, useRef } from "react";

export type DragGestureInfo = {
  /** Cursor delta in CSS pixels relative to the gesture's start. */
  dxRaw: number;
  dyRaw: number;
  /** Absolute viewport coords of the latest event. Useful for
   *  cross-page hit-tests at end-of-drag. */
  clientX: number;
  clientY: number;
};

export type DragGestureEndInfo = DragGestureInfo & {
  /** True when the cursor moved past the per-pointer-type threshold
   *  before release — callers use this to distinguish a click from a
   *  drag (and to suppress the trailing click that would otherwise
   *  pop the editor open after a drag-to-move). */
  moved: boolean;
  pointerType: string;
};

export type DragGestureCallbacks<C> = {
  /** Fires on `pointerdown` after stopPropagation/preventDefault.
   *  Useful for capturing snapshot data (originRect, effectiveScale)
   *  that the rest of the gesture needs. */
  onStart?: (ctx: C, e: React.PointerEvent) => void;
  /** Fires on every `pointermove` until the gesture ends. */
  onMove: (ctx: C, info: DragGestureInfo) => void;
  /** Fires on `pointerup`. Receives `moved` so callers can choose
   *  between commit-and-suppress-click vs pass-through-to-click. */
  onEnd?: (ctx: C, info: DragGestureEndInfo) => void;
  /** Fires on `pointercancel` (iOS palm rejection / OS gesture
   *  takeover). The drag did NOT complete normally — usually means
   *  reset live state without committing. */
  onCancel?: (ctx: C) => void;
};

/** Per-pointer-type movement thresholds. Touch needs more slack than
 *  mouse because finger jitter on tap is significantly larger than a
 *  mouse click. Numbers picked to match Material / iOS UIKit defaults. */
function thresholdFor(pointerType: string): number {
  return pointerType === "touch" ? 10 : 3;
}

/** Touch-only hold-to-drag gate. A finger that lands on a draggable
 *  doesn't claim the gesture immediately — it has to stay put for this
 *  many ms before `onStart` fires. Until then, the browser is free to
 *  treat the touch as a pan (so the user can scroll the page or sidebar
 *  by dragging on a draggable). Mouse / pen pointers skip this gate
 *  entirely so desktop drags stay snappy. */
const TOUCH_HOLD_MS = 400;
/** Movement (in CSS px) during the pending hold that aborts the
 *  gesture. Smaller than the activated drag threshold because here we
 *  only care about distinguishing "still" from "panning". */
const TOUCH_HOLD_TOLERANCE = 8;

/** Auto-scroll edge band: when the cursor sits within this many CSS
 *  pixels of the scroll container's top or bottom edge during an
 *  active drag, the container starts scrolling on its own. */
const AUTO_SCROLL_EDGE_PX = 60;
/** Maximum scroll velocity at the deepest point of the edge band, in
 *  CSS pixels per animation frame. Linear ramp from 0 at the band's
 *  outer boundary to this value at the very edge — about 840 px/sec
 *  at 60 fps, which feels brisk without being uncontrollable. */
const AUTO_SCROLL_MAX_PX_PER_FRAME = 14;

/** Walks up the DOM looking for the nearest ancestor whose computed
 *  `overflow-y` is `auto` or `scroll` AND whose content actually
 *  overflows. Falls back to `null` (no auto-scroll) for elements that
 *  don't live inside a scrollable region. */
function findScrollableAncestorY(el: Element | null): Element | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const cs = window.getComputedStyle(cur);
    const oy = cs.overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

export function useDragGesture<C>({
  onStart,
  onMove,
  onEnd,
  onCancel,
}: DragGestureCallbacks<C>): (e: React.PointerEvent, ctx: C) => void {
  // Stash the latest callbacks in refs so the closure that runs the
  // gesture isn't dependent on render-stable identities. Call sites
  // can pass inline arrow functions without breaking the listener
  // contract. We update the refs in a post-render effect (per React's
  // "no ref writes during render" rule) — this runs before any user
  // pointerdown can fire because user input is processed strictly
  // after render commits.
  const callbacksRef = useRef<DragGestureCallbacks<C>>({ onStart, onMove, onEnd, onCancel });
  useEffect(() => {
    callbacksRef.current = { onStart, onMove, onEnd, onCancel };
  });

  return (e: React.PointerEvent, ctx: C): void => {
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerType = e.pointerType || "mouse";
    const isTouch = pointerType === "touch";
    const threshold = thresholdFor(pointerType);
    let moved = false;
    // Mouse / pen activate immediately; touch waits for the hold timer.
    let active = !isTouch;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    // Resolved at activation time so the lookup happens once, not every
    // animation frame.
    const scrollEl = findScrollableAncestorY(e.currentTarget);
    // Latest pointer viewport coords; updated by handleMove. Used by
    // the auto-scroll loop to decide when the cursor sits in an edge
    // band, and to reissue onMove when the container scrolls under a
    // stationary pointer.
    let latestX = startX;
    let latestY = startY;
    // Total auto-scroll distance applied since the gesture started.
    // Folded into the dyRaw exposed to callers so a callback sees one
    // cumulative drag delta regardless of whether the user's finger
    // moved or the container scrolled. Vertical only — no horizontal
    // scroll containers in the app today.
    let autoScrollAccumY = 0;
    let rafId: number | null = null;

    if (!isTouch) {
      // Same eager behaviour as before for desktop pointers — claim the
      // gesture, suppress focus stealing, fire onStart.
      e.stopPropagation();
      e.preventDefault();
      callbacksRef.current.onStart?.(ctx, e);
      startAutoScrollLoop();
    }

    const activate = (e0: React.PointerEvent) => {
      if (active) return;
      active = true;
      callbacksRef.current.onStart?.(ctx, e0);
      startAutoScrollLoop();
    };

    function fireMove(clientX: number, clientY: number): void {
      const dxRaw = clientX - startX;
      const dyRaw = clientY - startY + autoScrollAccumY;
      if (!moved && (Math.abs(dxRaw) > threshold || Math.abs(dyRaw) > threshold)) {
        moved = true;
      }
      callbacksRef.current.onMove(ctx, { dxRaw, dyRaw, clientX, clientY });
    }

    // Per-edge "armed" flag: auto-scroll only fires once the cursor
    // has been seen OUTSIDE that edge's band at least once. A drag
    // that starts inside the band (e.g. grabbing a run that's already
    // close to the viewport edge) shouldn't immediately yank the
    // page — the user has to drag out of the band first to arm the
    // edge, then back into it to trigger scrolling.
    let armedTop = false;
    let armedBot = false;

    function startAutoScrollLoop(): void {
      if (!scrollEl || rafId !== null) return;
      const tick = () => {
        rafId = null;
        if (!active || !scrollEl) return;
        const rect = scrollEl.getBoundingClientRect();
        const inTopBand = latestY < rect.top + AUTO_SCROLL_EDGE_PX;
        const inBotBand = latestY > rect.bottom - AUTO_SCROLL_EDGE_PX;
        if (!inTopBand) armedTop = true;
        if (!inBotBand) armedBot = true;
        // Negative dy = scroll up, positive = scroll down. Velocity
        // ramps linearly from the band edge inward, capped at the
        // per-frame max.
        let dy = 0;
        if (armedTop && inTopBand) {
          const intensity = Math.min(
            1,
            (rect.top + AUTO_SCROLL_EDGE_PX - latestY) / AUTO_SCROLL_EDGE_PX,
          );
          dy = -Math.ceil(intensity * AUTO_SCROLL_MAX_PX_PER_FRAME);
        } else if (armedBot && inBotBand) {
          const intensity = Math.min(
            1,
            (latestY - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX,
          );
          dy = Math.ceil(intensity * AUTO_SCROLL_MAX_PX_PER_FRAME);
        }
        if (dy !== 0) {
          const before = scrollEl.scrollTop;
          scrollEl.scrollTop = before + dy;
          const actualDy = scrollEl.scrollTop - before;
          if (actualDy !== 0) {
            autoScrollAccumY += actualDy;
            // Reissue onMove so the live drag preview tracks the new
            // content under the still-stationary cursor.
            fireMove(latestX, latestY);
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    const handleMove = (ev: PointerEvent) => {
      const dxRawViewport = ev.clientX - startX;
      const dyRawViewport = ev.clientY - startY;
      if (!active) {
        // Pending touch-hold: any meaningful movement means the user is
        // trying to scroll, not drag. Abort silently so the browser's
        // pan handles the gesture.
        if (
          Math.abs(dxRawViewport) > TOUCH_HOLD_TOLERANCE ||
          Math.abs(dyRawViewport) > TOUCH_HOLD_TOLERANCE
        ) {
          if (holdTimer !== null) clearTimeout(holdTimer);
          holdTimer = null;
          cleanup();
        }
        return;
      }
      latestX = ev.clientX;
      latestY = ev.clientY;
      fireMove(ev.clientX, ev.clientY);
    };
    const handleUp = (ev: PointerEvent) => {
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = null;
      cleanup();
      // Released before the hold timer fired — this was a tap, not a
      // drag. No callbacks; the React onClick handler will run.
      if (!active) return;
      callbacksRef.current.onEnd?.(ctx, {
        dxRaw: ev.clientX - startX,
        dyRaw: ev.clientY - startY + autoScrollAccumY,
        clientX: ev.clientX,
        clientY: ev.clientY,
        moved,
        pointerType,
      });
    };
    const handleCancel = () => {
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = null;
      cleanup();
      // Browser took over the touch (e.g. started scrolling) before
      // we activated — drop the gesture without calling onCancel,
      // since onStart never fired and there's no live state to clear.
      if (!active) return;
      callbacksRef.current.onCancel?.(ctx);
    };
    // touchmove with passive:false lets us stop the browser from
    // hijacking an active drag for native scroll. We only preventDefault
    // *after* activation — during the pending hold the browser must be
    // free to scroll if the user pans.
    const handleTouchMove = (ev: TouchEvent) => {
      if (active) ev.preventDefault();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      if (isTouch) window.removeEventListener("touchmove", handleTouchMove);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    if (isTouch) {
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      holdTimer = setTimeout(() => {
        holdTimer = null;
        activate(e);
      }, TOUCH_HOLD_MS);
    }
  };
}

/** Click-suppression duration after a drag, by pointer type. Pass to
 *  `setTimeout` when populating a `justDragged` ref so the trailing
 *  click that fires on touch release after a drag is ignored. */
export function clickSuppressMs(pointerType: string): number {
  return pointerType === "touch" ? 400 : 200;
}
