import type { RefObject } from "react";
import { useState } from "react";
import type { RenderedPage } from "@/pdf/render/pdf";
import type { ImageInstance } from "@/pdf/source/sourceImages";
import { useDragGesture } from "@/platform/hooks/useDragGesture";
import { cropCanvasToDataUrl, findPageAtPoint } from "./helpers";
import type { ImageMoveValue, ResizeCorner } from "./types";

/** Live state for an image drag in progress. Same body-portal preview
 *  pattern as the run drag state, plus a `corner` field that's null
 *  for translate gestures and one of "tl"/"tr"/"bl"/"br" during a
 *  corner-drag resize. Resize gestures skip the portal — the image
 *  stays on its origin page. */
export type ImageDragState = {
  imageId: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  corner: ResizeCorner | null;
  /** True once the user has actually moved during the gesture. Same
   *  rationale as the run drag's `moved` flag — keep the in-place
   *  overlay visible for a no-motion click so onSelect still fires. */
  moved: boolean;
  /** Cursor offset within the box at gesture start, in screen px. */
  cursorOffsetX: number;
  cursorOffsetY: number;
  /** Box dimensions in SCREEN pixels (= natural × originDisplayScale). */
  width: number;
  height: number;
  /** Latest cursor viewport coords for the portal positioning. */
  clientX: number;
  clientY: number;
  /** Source page's natural→displayed ratio captured at gesture start. */
  originDisplayScale: number;
  /** Cropped sprite (data URL) of the dragged image, painted on the
   *  body-portal clone so the user sees the actual pixels following
   *  the cursor across pages. Cached at gesture-start so we don't
   *  re-crop the source canvas on every pointermove. */
  sprite: string | null;
};

/** Image translate-and-resize gestures. Owns one state for both kinds
 *  (`corner` discriminates), and exposes two start functions:
 *
 *   - `startImageDrag`   begins a whole-image translate (corner=null).
 *   - `startImageResize` begins a corner-drag resize.
 *
 *  Both commit through `onImageMove`. Translate emits cross-page
 *  target coords when the cursor lands on a different page; resize
 *  stays on-page and clears any prior cross-page coords. */
export function useImageDrag({
  page,
  pageIndex,
  onImageMove,
  containerRef,
  displayScale,
}: {
  page: RenderedPage;
  pageIndex: number;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Fallback when containerRef hasn't mounted yet (first render). */
  displayScale: number;
}): {
  imageDrag: ImageDragState | null;
  startImageDrag: (
    imageId: string,
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => void;
  startImageResize: (
    imageId: string,
    img: ImageInstance,
    corner: ResizeCorner,
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => void;
} {
  const [imageDrag, setImageDrag] = useState<ImageDragState | null>(null);

  const readDisplayScale = (): number => {
    const inner = containerRef.current;
    if (!inner) return displayScale;
    const r = inner.getBoundingClientRect();
    return page.viewWidth > 0 ? r.width / page.viewWidth : 1;
  };

  /** Whole-image translate. Mirrors the run drag — commits to the
   *  parent's onImageMove rather than onEdit. Width/height deltas
   *  (dw/dh) are passed through unchanged so the user's earlier
   *  resize survives a subsequent move. */
  type ImageDragCtx = {
    imageId: string;
    base: { dx: number; dy: number; dw: number; dh: number };
    originRect: DOMRect | null;
    originDisplayScale: number;
  };
  const beginImageDrag = useDragGesture<ImageDragCtx>({
    onStart: (ctx, e) => {
      // Capture body-portal preview metadata: cursor offset within the
      // box, screen-px box dimensions, and a one-time crop of the
      // image's pixels from the source canvas. The crop becomes the
      // sprite painted on the position:fixed clone so the user sees
      // the actual image follow the cursor across page boundaries.
      const img = page.images.find((i) => i.id === ctx.imageId);
      const rect = ctx.originRect;
      const ds = ctx.originDisplayScale;
      let cursorOffsetX = 0;
      let cursorOffsetY = 0;
      let width = 0;
      let height = 0;
      let sprite: string | null = null;
      if (img && rect) {
        // Match ImageOverlay's natural-pixel box: top-left at
        // (left + dx, top + dy - dh), size (w + dw, h + dh).
        const left = img.pdfX * page.scale;
        const top = page.viewHeight - (img.pdfY + img.pdfHeight) * page.scale;
        const w = img.pdfWidth * page.scale;
        const h = img.pdfHeight * page.scale;
        const boxLeftNat = left + ctx.base.dx;
        const boxTopNat = top + ctx.base.dy - ctx.base.dh;
        const boxWNat = w + ctx.base.dw;
        const boxHNat = h + ctx.base.dh;
        const screenLeft = rect.left + boxLeftNat * ds;
        const screenTop = rect.top + boxTopNat * ds;
        cursorOffsetX = e.clientX - screenLeft;
        cursorOffsetY = e.clientY - screenTop;
        width = boxWNat * ds;
        height = boxHNat * ds;
        // Crop the IMAGE's pixels (not the post-resize box) from the
        // ORIGINAL canvas — preview canvas may have stripped them
        // already. Sized to original w×h; the portal stretches via
        // background-size so a mid-resize drag still looks right.
        sprite = cropCanvasToDataUrl(page.canvas, left, top, w, h);
      }
      setImageDrag({
        imageId: ctx.imageId,
        dx: ctx.base.dx,
        dy: ctx.base.dy,
        dw: ctx.base.dw,
        dh: ctx.base.dh,
        corner: null,
        moved: false,
        cursorOffsetX,
        cursorOffsetY,
        width,
        height,
        clientX: e.clientX,
        clientY: e.clientY,
        originDisplayScale: ds,
        sprite,
      });
    },
    onMove: (ctx, info) => {
      const dxNat = info.dxRaw / ctx.originDisplayScale;
      const dyNat = info.dyRaw / ctx.originDisplayScale;
      const newDx = ctx.base.dx + dxNat;
      const newDy = ctx.base.dy + dyNat;
      setImageDrag((prev) =>
        prev && prev.imageId === ctx.imageId
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
      const { imageId, base, originRect, originDisplayScale } = ctx;
      const totalDx = base.dx + info.dxRaw / originDisplayScale;
      const totalDy = base.dy + info.dyRaw / originDisplayScale;
      setImageDrag(null);
      if (!info.moved) return;
      const img = page.images.find((i) => i.id === imageId);
      const hit = originRect && img ? findPageAtPoint(info.clientX, info.clientY) : null;
      if (hit && originRect && img && hit.pageIndex !== pageIndex) {
        const origLeft = img.pdfX * page.scale;
        const origTopView = page.viewHeight - (img.pdfY + img.pdfHeight) * page.scale;
        const dwPdf = base.dw / page.scale;
        const dhPdf = base.dh / page.scale;
        const newW = img.pdfWidth + dwPdf;
        const newH = img.pdfHeight + dhPdf;
        // Effective box top on origin page after move + resize (matches
        // ImageOverlay's boxTop = top + dy - dh). Natural→screen via
        // origin's displayScale; screen→target-PDF via hit.effectiveScale.
        const screenLeft = originRect.left + (origLeft + totalDx) * originDisplayScale;
        const screenTopBox =
          originRect.top + (origTopView + totalDy - base.dh) * originDisplayScale;
        const targetViewLeft = screenLeft - hit.rect.left;
        const targetViewTopBox = screenTopBox - hit.rect.top;
        // newH is in PDF units; on target page that's `newH * hit.effectiveScale`
        // displayed-screen pixels.
        const newHScreen = newH * hit.effectiveScale;
        const targetPdfX = targetViewLeft / hit.effectiveScale;
        const targetViewBottom = targetViewTopBox + newHScreen;
        const targetPdfY = (hit.displayedHeight - targetViewBottom) / hit.effectiveScale;
        // Width / height in PDF units are simply newW / newH.
        const targetPdfWidth = newW;
        const targetPdfHeight = newH;
        onImageMove(imageId, {
          dx: totalDx,
          dy: totalDy,
          dw: base.dw,
          dh: base.dh,
          targetPageIndex: hit.pageIndex,
          targetSourceKey: hit.sourceKey,
          targetPdfX,
          targetPdfY,
          targetPdfWidth,
          targetPdfHeight,
        });
      } else {
        onImageMove(imageId, {
          dx: totalDx,
          dy: totalDy,
          dw: base.dw,
          dh: base.dh,
          targetPageIndex: undefined,
          targetSourceKey: undefined,
          targetPdfX: undefined,
          targetPdfY: undefined,
          targetPdfWidth: undefined,
          targetPdfHeight: undefined,
        });
      }
    },
    onCancel: () => setImageDrag(null),
  });

  const startImageDrag = (
    imageId: string,
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => {
    beginImageDrag(e, {
      imageId,
      base,
      originRect: containerRef.current?.getBoundingClientRect() ?? null,
      originDisplayScale: readDisplayScale(),
    });
  };

  /** Resize from one of the 4 image corners. Anchors the opposite
   *  corner so the box grows/shrinks toward the cursor. dx/dy are
   *  viewport-pixel translations of the bottom-left (same convention
   *  as the move drag); dw/dh are viewport-pixel growth deltas — dh
   *  > 0 means image is taller. App.tsx converts to PDF units when
   *  emitting the cm op. */
  type ImageResizeCtx = {
    imageId: string;
    corner: ResizeCorner;
    base: { dx: number; dy: number; dw: number; dh: number };
    origW: number;
    origH: number;
    minView: number;
    /** Source page's natural→displayed ratio. Captured at start so
     *  every screen delta gets converted to natural pixels (the unit
     *  base.dw / dh / dx / dy live in). */
    originDisplayScale: number;
    /** Mutated inside onMove so onEnd has the latest computed deltas
     *  without depending on the (async) imageDrag setState having
     *  flushed. Initialised from `base` on start. */
    latest: { dx: number; dy: number; dw: number; dh: number };
  };
  const beginImageResize = useDragGesture<ImageResizeCtx>({
    touchActivation: "immediate",
    onStart: (ctx) => {
      // Resize gestures don't trigger the body-portal preview — the
      // image stays on its origin page while a corner is dragged. The
      // portal-related fields stay at neutral defaults so the renderer
      // can short-circuit when corner !== null.
      setImageDrag({
        imageId: ctx.imageId,
        dx: ctx.base.dx,
        dy: ctx.base.dy,
        dw: ctx.base.dw,
        dh: ctx.base.dh,
        corner: ctx.corner,
        moved: false,
        cursorOffsetX: 0,
        cursorOffsetY: 0,
        width: 0,
        height: 0,
        clientX: 0,
        clientY: 0,
        originDisplayScale: 1,
        sprite: null,
      });
    },
    onMove: (ctx, info) => {
      const { base, corner, origW, origH, minView, originDisplayScale } = ctx;
      // Convert screen-pixel deltas to NATURAL viewport pixels — base.*
      // and origW / origH all live in natural CSS px.
      const dxNat = info.dxRaw / originDisplayScale;
      const dyNat = info.dyRaw / originDisplayScale;
      // Step 1: unclamped width/height growth.
      let nDw = base.dw;
      let nDh = base.dh;
      switch (corner) {
        case "br":
          nDw = base.dw + dxNat;
          nDh = base.dh + dyNat;
          break;
        case "tr":
          nDw = base.dw + dxNat;
          nDh = base.dh - dyNat;
          break;
        case "tl":
          nDw = base.dw - dxNat;
          nDh = base.dh - dyNat;
          break;
        case "bl":
          nDw = base.dw - dxNat;
          nDh = base.dh + dyNat;
          break;
      }
      // Step 2: clamp size so the viewport bbox stays ≥ MIN_VIEW.
      if (origW + nDw < minView) nDw = minView - origW;
      if (origH + nDh < minView) nDh = minView - origH;
      // Step 3: derive translation from the clamped size to keep the
      // anchored corner pinned. The relations come from
      //   anchor.left_x   stays → nDx = base.dx                (br, tr)
      //   anchor.right_x  stays → nDx = base.dx + (base.dw - nDw) (tl, bl)
      //   anchor.bottom_y stays → nDy = base.dy                  (tr, tl)
      //   anchor.top_y    stays → nDy = base.dy + (nDh - base.dh) (br, bl)
      let nDx = base.dx;
      let nDy = base.dy;
      if (corner === "tl" || corner === "bl") {
        nDx = base.dx + (base.dw - nDw);
      }
      if (corner === "br" || corner === "bl") {
        nDy = base.dy + (nDh - base.dh);
      }
      ctx.latest = { dx: nDx, dy: nDy, dw: nDw, dh: nDh };
      setImageDrag((prev) =>
        prev && prev.imageId === ctx.imageId
          ? { ...prev, dx: nDx, dy: nDy, dw: nDw, dh: nDh }
          : prev,
      );
    },
    onEnd: (ctx) => {
      const { imageId, latest } = ctx;
      setImageDrag(null);
      onImageMove(imageId, {
        dx: latest.dx,
        dy: latest.dy,
        dw: latest.dw,
        dh: latest.dh,
      });
    },
    onCancel: () => setImageDrag(null),
  });

  const startImageResize = (
    imageId: string,
    img: ImageInstance,
    corner: ResizeCorner,
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => {
    beginImageResize(e, {
      imageId,
      corner,
      base,
      origW: img.pdfWidth * page.scale,
      origH: img.pdfHeight * page.scale,
      minView: 10 * page.scale,
      originDisplayScale: readDisplayScale(),
      latest: { dx: base.dx, dy: base.dy, dw: base.dw, dh: base.dh },
    });
  };

  return { imageDrag, startImageDrag, startImageResize };
}
