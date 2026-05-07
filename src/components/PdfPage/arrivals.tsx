import { useMemo } from "react";
import { colorToCss } from "@/domain/color";
import type { RenderedPage } from "@/pdf/render/pdf";
import { cropCanvasToDataUrl, cssTextDecoration, findPageAtPoint } from "./helpers";
import type { CrossPageArrival, CrossPageImageArrival, EditValue, ImageMoveValue } from "./types";
import { useCrossPageDragPreview } from "./useCrossPageDragPreview";

/** Re-draggable text overlay for a cross-page-arrived source run.
 *  The arrival's underlying state lives in the SOURCE slot's `edits`
 *  map (where the cross-page-move pipeline expects it). Dragging this
 *  overlay updates that entry's `targetPageIndex / targetPdfX/Y` so
 *  App's onEdit can re-resolve `targetSlotId` — that means a user can
 *  fine-tune position on the current target, hop to a third page, or
 *  drop back on the source page (in which case targetSlotId ends up
 *  matching sourceSlotId and the arrival simply re-renders there).
 *
 *  Same body-portal pattern as the source-run drag: the in-place span
 *  goes invisible once the user has actually moved so the portal'd
 *  clone can escape the page wrapper's overflow:hidden across page
 *  boundaries.  */
export function CrossPageTextArrivalOverlay({
  arr,
  page,
  displayScale,
  onSourceEdit,
}: {
  arr: CrossPageArrival;
  page: RenderedPage;
  displayScale: number;
  onSourceEdit: (sourceSlotId: string, runId: string, value: EditValue) => void;
}) {
  const fontSizeNat = arr.fontSizePdfPoints * page.scale;
  const lineHeightNat = arr.fontSizePdfPoints * 1.4 * page.scale;
  const left = arr.targetPdfX * page.scale;
  const top = page.viewHeight - arr.targetPdfY * page.scale - fontSizeNat;
  type Ctx = { startTargetPdfX: number; startTargetPdfY: number };
  const { overlayRef, dragLive, beginDrag, renderPortal } = useCrossPageDragPreview<Ctx>({
    onEnd: (_ctx, info, live) => {
      if (!info.moved || !live) return;
      const hit = findPageAtPoint(info.clientX, info.clientY);
      if (!hit) return;
      // Convert cursor + offset → top-left in target-natural px → PDF
      // baseline. Use the HIT page's scale (target-page scale) — for
      // a back-to-source drop that's the source page's scale, since
      // hit IS the source slot at that point.
      const newScreenLeft = info.clientX - live.cursorOffsetX;
      const newScreenTop = info.clientY - live.cursorOffsetY;
      const newBoxLeftNat = (newScreenLeft - hit.rect.left) / hit.displayScale;
      const newBoxTopNat = (newScreenTop - hit.rect.top) / hit.displayScale;
      const fontSizeNatHit = arr.fontSizePdfPoints * hit.scale;
      const newPdfX = newBoxLeftNat / hit.scale;
      const newPdfY = (hit.viewHeight - newBoxTopNat - fontSizeNatHit) / hit.scale;
      onSourceEdit(arr.sourceSlotId, arr.runId, {
        ...arr.edit,
        targetPageIndex: hit.pageIndex,
        targetSourceKey: hit.sourceKey,
        targetPdfX: newPdfX,
        targetPdfY: newPdfY,
      });
    },
  });
  return (
    <>
      <div
        ref={overlayRef}
        data-cross-page-arrival-key={arr.key}
        role="button"
        tabIndex={0}
        aria-label={`Moved text — drag to relocate`}
        title={arr.text}
        style={{
          position: "absolute",
          left,
          top,
          height: lineHeightNat,
          display: "flex",
          alignItems: "center",
          pointerEvents: "auto",
          cursor: dragLive?.moved ? "grabbing" : "text",
          whiteSpace: "pre",
          zIndex: 15,
          // Hide the in-place version once the user actually moves —
          // the body-portal clone is what they see across pages.
          visibility: dragLive?.moved ? "hidden" : "visible",
          touchAction: "pan-y pinch-zoom",
        }}
        onPointerDown={(e) =>
          beginDrag(e, { startTargetPdfX: arr.targetPdfX, startTargetPdfY: arr.targetPdfY })
        }
      >
        <span
          dir={arr.dir ?? "auto"}
          style={{
            fontFamily: `"${arr.fontFamily}"`,
            fontSize: `${fontSizeNat}px`,
            lineHeight: `${lineHeightNat}px`,
            fontWeight: arr.bold ? 700 : 400,
            fontStyle: arr.italic ? "italic" : "normal",
            textDecoration: cssTextDecoration(arr.underline, arr.strikethrough),
            color: colorToCss(arr.color) ?? "black",
            whiteSpace: "pre",
            pointerEvents: "none",
          }}
        >
          {arr.text}
        </span>
      </div>
      {renderPortal(
        {
          outline: "1px dashed rgba(255, 180, 30, 0.9)",
          background: "transparent",
          display: "flex",
          alignItems: "center",
          overflow: "visible",
        },
        <span
          dir={arr.dir ?? "auto"}
          style={{
            fontFamily: `"${arr.fontFamily}"`,
            fontSize: `${fontSizeNat * displayScale}px`,
            lineHeight: `${lineHeightNat * displayScale}px`,
            fontWeight: arr.bold ? 700 : 400,
            fontStyle: arr.italic ? "italic" : "normal",
            textDecoration: cssTextDecoration(arr.underline, arr.strikethrough),
            color: colorToCss(arr.color) ?? "black",
            whiteSpace: "pre",
          }}
        >
          {arr.text}
        </span>,
      )}
    </>
  );
}

/** Re-draggable image overlay for a cross-page-arrived source image.
 *  Same model as the text arrival — the underlying state lives in the
 *  SOURCE slot's `imageMoves` map; dragging here updates the entry's
 *  `targetPageIndex / targetPdfX/Y/Width/Height` via `onSourceImageMove`.
 *  Sprite is cropped from the source canvas at construction time and
 *  cached for the lifetime of this overlay. */
export function CrossPageImageArrivalOverlay({
  arr,
  page,
  onSourceImageMove,
}: {
  arr: CrossPageImageArrival;
  page: RenderedPage;
  onSourceImageMove: (sourceSlotId: string, imageId: string, value: ImageMoveValue) => void;
}) {
  const sprite = useMemo(
    () =>
      cropCanvasToDataUrl(
        arr.sourceCanvas,
        arr.sourceLeft,
        arr.sourceTop,
        arr.sourceWidth,
        arr.sourceHeight,
      ),
    [arr.sourceCanvas, arr.sourceLeft, arr.sourceTop, arr.sourceWidth, arr.sourceHeight],
  );
  const left = arr.targetPdfX * page.scale;
  const w = arr.targetPdfWidth * page.scale;
  const h = arr.targetPdfHeight * page.scale;
  const top = page.viewHeight - (arr.targetPdfY + arr.targetPdfHeight) * page.scale;
  type Ctx = Record<string, never>;
  const { overlayRef, dragLive, beginDrag, renderPortal } = useCrossPageDragPreview<Ctx>({
    onEnd: (_ctx, info, live) => {
      if (!info.moved || !live) return;
      const hit = findPageAtPoint(info.clientX, info.clientY);
      if (!hit) return;
      // PDF (pdfX, pdfY) for an image is the BOTTOM-LEFT (y-up). Box
      // top in viewport y-down is `page.viewHeight - (pdfY + pdfH) × scale`.
      // Reverse on the hit page: bottom-y = top + h, then convert.
      const newScreenLeft = info.clientX - live.cursorOffsetX;
      const newScreenTop = info.clientY - live.cursorOffsetY;
      const newBoxLeftNat = (newScreenLeft - hit.rect.left) / hit.displayScale;
      const newBoxTopNat = (newScreenTop - hit.rect.top) / hit.displayScale;
      const newPdfX = newBoxLeftNat / hit.scale;
      const heightOnHitNat = arr.targetPdfHeight * hit.scale;
      const newPdfY = (hit.viewHeight - newBoxTopNat - heightOnHitNat) / hit.scale;
      onSourceImageMove(arr.sourceSlotId, arr.imageId, {
        ...arr.move,
        targetPageIndex: hit.pageIndex,
        targetSourceKey: hit.sourceKey,
        targetPdfX: newPdfX,
        targetPdfY: newPdfY,
        targetPdfWidth: arr.targetPdfWidth,
        targetPdfHeight: arr.targetPdfHeight,
      });
    },
  });
  return (
    <>
      <div
        ref={overlayRef}
        data-cross-page-image-arrival-key={arr.key}
        role="button"
        tabIndex={0}
        aria-label="Moved image — drag to relocate"
        style={{
          position: "absolute",
          left,
          top,
          width: w,
          height: h,
          backgroundImage: sprite ? `url(${sprite})` : undefined,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          outline: dragLive?.moved
            ? "1px dashed rgba(60, 130, 255, 0.85)"
            : "1px solid rgba(60, 130, 255, 0.45)",
          cursor: dragLive?.moved ? "grabbing" : "grab",
          pointerEvents: "auto",
          zIndex: 15,
          visibility: dragLive?.moved ? "hidden" : "visible",
          touchAction: "pan-y pinch-zoom",
        }}
        onPointerDown={(e) => beginDrag(e, {})}
      />
      {renderPortal({
        backgroundImage: sprite ? `url(${sprite})` : undefined,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        outline: "1px dashed rgba(60, 130, 255, 0.85)",
      })}
    </>
  );
}
