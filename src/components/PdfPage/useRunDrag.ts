import type { RefObject } from "react";
import { useRef, useState } from "react";
import type { RenderedPage } from "@/pdf/render/pdf";
import { clickSuppressMs, useDragGesture } from "@/platform/hooks/useDragGesture";
import { findPageAtPoint } from "./helpers";
import type { EditValue } from "./types";

/** Live state for a source-run drag in progress. The renderer reads
 *  `dx/dy` for the in-place position and the `cursorOffsetX/Y +
 *  width/height + clientX/Y + originDisplayScale` cluster for the
 *  body-portal preview that escapes the page wrapper's overflow:hidden
 *  during cross-page drags. `moved` distinguishes a real drag from a
 *  click — the in-place span only goes invisible (so the portal'd
 *  clone takes over) once the user has actually moved. */
export type RunDragState = {
  runId: string;
  dx: number;
  dy: number;
  /** True once the user has actually moved the cursor (any non-zero
   *  pointermove). Click without motion leaves this false so the
   *  in-place span stays interactive and `onClick` can open the
   *  editor. */
  moved: boolean;
  /** Screen-px offset from the box's top-left to the cursor at gesture
   *  start. Stays constant for the rest of the drag — the cursor
   *  always grabs the same point on the box. */
  cursorOffsetX: number;
  cursorOffsetY: number;
  /** Box dimensions in SCREEN pixels (= natural × originDisplayScale).
   *  The portal lives in document.body, where there's no CSS transform,
   *  so all of its measurements are in raw screen pixels. */
  width: number;
  height: number;
  /** Latest cursor viewport coords; the portal renders at
   *  `clientX - cursorOffsetX, clientY - cursorOffsetY`. */
  clientX: number;
  clientY: number;
  /** Source page's natural→displayed ratio captured at gesture start.
   *  Used by the portal to convert the run's natural-pixel font size
   *  to the on-screen size that matches the in-page rendering. */
  originDisplayScale: number;
};

/** Source-run drag gesture. Tracks an in-place dx/dy plus the screen-
 *  px cluster the body-portal preview needs, and on release commits
 *  via `onEdit` — including the cross-page target coords when the
 *  drop landed on a different page than the run's origin.
 *
 *  `originDisplayScale` is captured at start so screen-pixel deltas
 *  from the pointer get converted into NATURAL viewport pixels — the
 *  unit dx/dy is persisted in. With displayScale < 1 (mobile fit-to-
 *  width), a 100px finger swipe corresponds to ~240 natural pixels of
 *  run translation, matching the visual scale-up. */
export function useRunDrag({
  page,
  pageIndex,
  edits,
  onEdit,
  containerRef,
  displayScale,
}: {
  page: RenderedPage;
  pageIndex: number;
  edits: Map<string, EditValue>;
  onEdit: (runId: string, value: EditValue) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Fallback when containerRef hasn't mounted yet (first render). */
  displayScale: number;
}): {
  drag: RunDragState | null;
  startDrag: (runId: string, e: React.PointerEvent, base: { dx: number; dy: number }) => void;
  /** Set to the runId during a drag and cleared a tick after pointerup,
   *  used to suppress the click-to-edit that would otherwise fire after
   *  a drag (Playwright's synthesised events don't match the browser's
   *  native click-suppression on movement, so we guard explicitly). */
  justDraggedRef: RefObject<string | null>;
} {
  const [drag, setDrag] = useState<RunDragState | null>(null);
  const justDraggedRef = useRef<string | null>(null);

  // Stable through the gesture (we don't want a window resize mid-drag
  // to retarget the deltas). Caller-side state value is the fallback
  // for the moment containerRef hasn't laid out yet.
  const readDisplayScale = (): number => {
    const inner = containerRef.current;
    if (!inner) return displayScale;
    const r = inner.getBoundingClientRect();
    return page.viewWidth > 0 ? r.width / page.viewWidth : 1;
  };

  type RunDragCtx = {
    runId: string;
    base: { dx: number; dy: number };
    originRect: DOMRect | null;
    originDisplayScale: number;
  };
  const beginRunDrag = useDragGesture<RunDragCtx>({
    onStart: (ctx, e) => {
      const run = page.textRuns.find((r) => r.id === ctx.runId);
      const rect = ctx.originRect;
      const ds = ctx.originDisplayScale;
      // Box dimensions match the edited-branch render (which uses
      // padX/padY = 2 around the run's natural-pixel bounds). The
      // unedited branch renders without padding, but visually swapping
      // to the slightly-padded box during drag is fine and means the
      // portal clone matches the post-drop in-place rendering exactly.
      const padX = 2;
      const padY = 2;
      let cursorOffsetX = 0;
      let cursorOffsetY = 0;
      let width = 0;
      let height = 0;
      if (run && rect) {
        const boxNaturalW = Math.max(run.bounds.width, 12) + padX * 2;
        const boxNaturalH = run.bounds.height + padY * 2;
        const screenLeft = rect.left + (run.bounds.left - padX + ctx.base.dx) * ds;
        const screenTop = rect.top + (run.bounds.top - padY + ctx.base.dy) * ds;
        cursorOffsetX = e.clientX - screenLeft;
        cursorOffsetY = e.clientY - screenTop;
        width = boxNaturalW * ds;
        height = boxNaturalH * ds;
      }
      setDrag({
        runId: ctx.runId,
        dx: ctx.base.dx,
        dy: ctx.base.dy,
        moved: false,
        cursorOffsetX,
        cursorOffsetY,
        width,
        height,
        clientX: e.clientX,
        clientY: e.clientY,
        originDisplayScale: ds,
      });
    },
    onMove: (ctx, info) => {
      const dxNat = info.dxRaw / ctx.originDisplayScale;
      const dyNat = info.dyRaw / ctx.originDisplayScale;
      const newDx = ctx.base.dx + dxNat;
      const newDy = ctx.base.dy + dyNat;
      setDrag((prev) =>
        prev && prev.runId === ctx.runId
          ? {
              ...prev,
              dx: newDx,
              dy: newDy,
              clientX: info.clientX,
              clientY: info.clientY,
              moved: true,
            }
          : prev,
      );
    },
    onEnd: (ctx, info) => {
      const { runId, base, originRect, originDisplayScale } = ctx;
      const totalDx = base.dx + info.dxRaw / originDisplayScale;
      const totalDy = base.dy + info.dyRaw / originDisplayScale;
      setDrag(null);
      if (!info.moved) return; // treat as click — caller's onClick handles it
      // Suppress the click that fires immediately after pointerup so we
      // don't drop into the editor right after a drag. Touch pointers
      // get a longer window because iOS' synthesised click is delayed.
      justDraggedRef.current = runId;
      const suppressMs = clickSuppressMs(info.pointerType);
      setTimeout(() => {
        if (justDraggedRef.current === runId) justDraggedRef.current = null;
      }, suppressMs);
      const run = page.textRuns.find((r) => r.id === runId);
      if (!run) return;
      const existing = edits.get(runId) ?? { text: run.text };
      // Cross-page detection: if the cursor landed on a different page
      // than this run's origin, persist absolute target-page baseline
      // coords too. Save uses them to strip-on-origin + draw-on-target.
      const hit = originRect ? findPageAtPoint(info.clientX, info.clientY) : null;
      if (hit && originRect && hit.pageIndex !== pageIndex) {
        // Source-page natural-pixel positions (run.bounds.left, baselineY,
        // totalDx, totalDy) projected to screen coords via the source's
        // displayScale; then back to PDF user space on the TARGET page
        // via `effectiveScale = scale * displayScale`.
        const screenBaselineX = originRect.left + (run.bounds.left + totalDx) * originDisplayScale;
        const screenBaselineY = originRect.top + (run.baselineY + totalDy) * originDisplayScale;
        const targetViewX = screenBaselineX - hit.rect.left;
        const targetViewY = screenBaselineY - hit.rect.top;
        const targetPdfX = targetViewX / hit.effectiveScale;
        const targetPdfY = (hit.displayedHeight - targetViewY) / hit.effectiveScale;
        onEdit(runId, {
          ...existing,
          dx: totalDx,
          dy: totalDy,
          targetPageIndex: hit.pageIndex,
          targetSourceKey: hit.sourceKey,
          targetPdfX,
          targetPdfY,
        });
      } else {
        onEdit(runId, {
          ...existing,
          dx: totalDx,
          dy: totalDy,
          targetPageIndex: undefined,
          targetSourceKey: undefined,
          targetPdfX: undefined,
          targetPdfY: undefined,
        });
      }
    },
    onCancel: () => setDrag(null),
  });

  const startDrag = (runId: string, e: React.PointerEvent, base: { dx: number; dy: number }) => {
    beginRunDrag(e, {
      runId,
      base,
      originRect: containerRef.current?.getBoundingClientRect() ?? null,
      originDisplayScale: readDisplayScale(),
    });
  };

  return { drag, startDrag, justDraggedRef };
}
