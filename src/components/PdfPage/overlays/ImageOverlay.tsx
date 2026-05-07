import { useMemo } from "react";
import type { RenderedPage } from "@/pdf/render/pdf";
import { pdfRectToViewportRect } from "../geometry";
import { cropCanvasToDataUrl } from "../helpers";
import type { ImageMoveValue, ResizeCorner } from "../types";
import { ResizeHandles, type ResizeHandlePosition } from "./ResizeHandle";

/** Drag-movable image overlay. Two visual layers when moved:
 *
 *   - cover  : a white box at the image's ORIGINAL position so the
 *              source pixels on the rendered canvas are masked.
 *   - sprite : the image's pixels (cropped from the page canvas one
 *              time and cached as a data URL) painted at the moved
 *              position via `background-image`.
 *
 * At rest (dx == 0 && dy == 0) we don't render the cover or sprite —
 * the original canvas pixels are visible directly and the overlay is
 * a transparent click target. */
export function ImageOverlay({
  img,
  page,
  persisted,
  isDragging,
  hideInPlace,
  isSelected,
  liveDx,
  liveDy,
  liveDw,
  liveDh,
  onPointerDown,
  onResizeStart,
  onSelect,
}: {
  img: import("@/pdf/source/sourceImages").ImageInstance;
  page: RenderedPage;
  persisted: ImageMoveValue | undefined;
  isDragging: boolean;
  /** Hide the in-place overlay (visibility:hidden) so PdfPage's body-
   *  portal clone can show the dragged image escaping the page
   *  wrapper's overflow:hidden. Only set during translate drags
   *  AFTER the user has actually moved — a no-motion click keeps
   *  the overlay visible so onSelect still fires. */
  hideInPlace: boolean;
  isSelected: boolean;
  liveDx: number | null;
  liveDy: number | null;
  liveDw: number | null;
  liveDh: number | null;
  onPointerDown: (
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => void;
  onResizeStart: (
    corner: ResizeCorner,
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => void;
  onSelect: () => void;
}) {
  // PDF user-space → viewport: x scales directly; y flips around the
  // page bottom. CTM origin (pdfX, pdfY) is the bottom-left corner in
  // PDF y-up so the viewport top is page.viewHeight - (pdfY + pdfH) × s.
  const {
    left,
    top,
    width: w,
    height: h,
  } = pdfRectToViewportRect(img, page.scale, page.viewHeight);
  const dx = liveDx ?? persisted?.dx ?? 0;
  const dy = liveDy ?? persisted?.dy ?? 0;
  const dw = liveDw ?? persisted?.dw ?? 0;
  const dh = liveDh ?? persisted?.dh ?? 0;
  const isMoved = dx !== 0 || dy !== 0 || dw !== 0 || dh !== 0;
  const movable = img.qOpIndex != null;

  // Crop the image's pixels from the ORIGINAL page canvas (not the
  // preview, which has the image stripped) so we can paint them at the
  // moved position. Done lazily — only when first moved. Sprite source
  // is always the original size; we stretch via background-size.
  const sprite = useMemo(() => {
    if (!isMoved) return null;
    return cropCanvasToDataUrl(page.canvas, left, top, w, h);
  }, [isMoved, page.canvas, left, top, w, h]);

  // Effective viewport box after move + resize. dx/dy translate the
  // bottom-left; dh shifts the top-edge upward so the box grows toward
  // the user's cursor regardless of corner direction.
  const boxLeft = left + dx;
  const boxTop = top + dy - dh;
  const boxW = w + dw;
  const boxH = h + dh;

  const baseFor = () => ({ dx, dy, dw, dh });
  const startResize = (corner: ResizeHandlePosition) => (e: React.PointerEvent) => {
    onResizeStart(corner, e, baseFor());
  };

  return (
    <div
      data-image-id={img.id}
      role={movable ? "button" : undefined}
      tabIndex={movable ? 0 : undefined}
      aria-label={
        movable
          ? `Image ${img.resourceName} — drag to move, corners to resize`
          : `Image ${img.resourceName}`
      }
      style={{
        position: "absolute",
        left: boxLeft,
        top: boxTop,
        width: boxW,
        height: boxH,
        outline: isSelected
          ? "1.5px dotted rgba(24, 24, 27, 0.78)"
          : movable
            ? isDragging
              ? "1px dashed rgba(60, 130, 255, 0.85)"
              : isMoved
                ? "1px solid rgba(60, 130, 255, 0.45)"
                : "1px dashed rgba(60, 130, 255, 0)"
            : "1px dashed rgba(160, 160, 160, 0.55)",
        backgroundImage: sprite ? `url(${sprite})` : undefined,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        cursor: movable ? (isDragging ? "grabbing" : "grab") : "not-allowed",
        pointerEvents: "auto",
        // Hidden during a translate-drag-with-motion so PdfPage's
        // body-portal clone is what the user sees — the in-place box
        // would otherwise be clipped by the page wrapper's
        // overflow:hidden the moment the cursor crosses pages.
        visibility: hideInPlace ? "hidden" : "visible",
        // Movable images: `pan-y pinch-zoom` lets the page scroll on
        // a quick finger swipe; the 400ms touch-hold gate in
        // useDragGesture is what actually claims the image as a drag.
        // Un-movable images keep default behaviour.
        touchAction: movable ? "pan-y pinch-zoom" : undefined,
      }}
      title={
        movable
          ? `Image ${img.resourceName} (drag to move, corners to resize, Del to delete)`
          : `Image ${img.resourceName} (un-movable)`
      }
      onPointerDown={(e) => {
        if (!movable) return;
        onPointerDown(e, baseFor());
      }}
      onClick={(e) => {
        // Stop propagation so the window-level click-outside handler
        // in App doesn't immediately deselect what we just selected.
        e.stopPropagation();
        if (movable) onSelect();
      }}
      onKeyDown={(e) => {
        if (!movable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      {movable && isSelected ? (
        <ResizeHandles parentW={boxW} parentH={boxH} onPointerDown={startResize} />
      ) : null}
    </div>
  );
}
