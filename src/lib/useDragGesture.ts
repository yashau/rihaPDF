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
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerType = e.pointerType || "mouse";
    const threshold = thresholdFor(pointerType);
    let moved = false;

    callbacksRef.current.onStart?.(ctx, e);

    const handleMove = (ev: PointerEvent) => {
      const dxRaw = ev.clientX - startX;
      const dyRaw = ev.clientY - startY;
      if (!moved && (Math.abs(dxRaw) > threshold || Math.abs(dyRaw) > threshold)) {
        moved = true;
      }
      callbacksRef.current.onMove(ctx, {
        dxRaw,
        dyRaw,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
    };
    const handleUp = (ev: PointerEvent) => {
      cleanup();
      callbacksRef.current.onEnd?.(ctx, {
        dxRaw: ev.clientX - startX,
        dyRaw: ev.clientY - startY,
        clientX: ev.clientX,
        clientY: ev.clientY,
        moved,
        pointerType,
      });
    };
    const handleCancel = () => {
      cleanup();
      callbacksRef.current.onCancel?.(ctx);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
  };
}

/** Click-suppression duration after a drag, by pointer type. Pass to
 *  `setTimeout` when populating a `justDragged` ref so the trailing
 *  click that fires on touch release after a drag is ignored. */
export function clickSuppressMs(pointerType: string): number {
  return pointerType === "touch" ? 400 : 200;
}
