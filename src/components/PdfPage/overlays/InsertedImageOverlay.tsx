import { useMemo } from "react";
import type { RenderedPage } from "../../../lib/pdf";
import type { ImageInsertion } from "../../../lib/insertions";
import { useDragGesture } from "../../../lib/useDragGesture";
import { findPageAtPoint } from "../helpers";
import { useCrossPageDragPreview } from "../useCrossPageDragPreview";
import { ResizeHandle } from "./ResizeHandle";

/** Net-new image the user dropped onto the page. Drag to move; double-
 *  click to delete. The bytes ride along in state until save embeds
 *  them. We render a CSS background-image from a data URL so the
 *  preview matches what the saved PDF will show. */
export function InsertedImageOverlay({
  ins,
  page,
  slotIndex,
  displayScale,
  isSelected,
  onChange,
  onDelete,
  onSelect,
}: {
  ins: ImageInsertion;
  page: RenderedPage;
  /** Slot index this insertion is currently rendered in. Used to detect
   *  cross-page drops and to look up the origin page's screen rect.
   *  `ins.pageIndex` is the SOURCE page index — different number space. */
  slotIndex: number;
  /** Source page's natural→displayed ratio. Drag deltas in screen px
   *  divide by `displayScale * page.scale` to land in PDF user space. */
  displayScale: number;
  isSelected: boolean;
  onChange: (patch: Partial<ImageInsertion>) => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
  // Encode the chosen image as a base64 data URL once. We deliberately
  // avoid `URL.createObjectURL` here — its companion revoke needs to
  // run on a true unmount, but React 19 StrictMode does a synthetic
  // mount→unmount→mount in dev that fires the revoke before the
  // browser ever paints the background-image, leaving an empty
  // placeholder. data: URLs have no lifecycle to manage.
  const dataUrl = useMemo(() => {
    let s = "";
    for (let i = 0; i < ins.bytes.length; i++) {
      s += String.fromCharCode(ins.bytes[i]);
    }
    return `data:image/${ins.format};base64,${btoa(s)}`;
  }, [ins.bytes, ins.format]);

  const left = ins.pdfX * page.scale;
  const top = page.viewHeight - (ins.pdfY + ins.pdfHeight) * page.scale;
  const w = ins.pdfWidth * page.scale;
  const h = ins.pdfHeight * page.scale;

  // Drag-pixel → PDF-unit conversion factor: a screen-pixel delta
  // divided by `effectivePdfScale` lands in PDF user space.
  const effectivePdfScale = page.scale * displayScale;
  type InsImageDragCtx = { baseX: number; baseY: number };
  const { overlayRef, dragLive, beginDrag, renderPortal } =
    useCrossPageDragPreview<InsImageDragCtx>({
      onMove: (ctx, info) => {
        onChange({
          pdfX: ctx.baseX + info.dxRaw / effectivePdfScale,
          pdfY: ctx.baseY - info.dyRaw / effectivePdfScale,
        });
      },
      onEnd: (ctx, info) => {
        // hit.pageIndex is the SLOT index of the dropped-on page; compare
        // against the origin slot, not ins.pageIndex (source-page offset).
        const hit = findPageAtPoint(info.clientX, info.clientY);
        if (!hit || hit.pageIndex === slotIndex) return;
        const originRect = document
          .querySelector<HTMLElement>(`[data-page-index="${slotIndex}"]`)
          ?.getBoundingClientRect();
        if (!originRect) return;
        const pdfXOrigin = ctx.baseX + info.dxRaw / effectivePdfScale;
        const pdfYOrigin = ctx.baseY - info.dyRaw / effectivePdfScale;
        const overlayScreenLeft = originRect.left + pdfXOrigin * effectivePdfScale;
        const overlayScreenTopBox =
          originRect.top +
          (page.viewHeight - (pdfYOrigin + ins.pdfHeight) * page.scale) * displayScale;
        const targetPdfX = (overlayScreenLeft - hit.rect.left) / hit.effectiveScale;
        const heightScreenOnTarget = ins.pdfHeight * hit.effectiveScale;
        const targetViewBottom = overlayScreenTopBox - hit.rect.top + heightScreenOnTarget;
        const targetPdfY = (hit.displayedHeight - targetViewBottom) / hit.effectiveScale;
        onChange({
          sourceKey: hit.sourceKey,
          pageIndex: hit.pageIndex,
          pdfX: targetPdfX,
          pdfY: targetPdfY,
        });
      },
    });
  const startDrag = (e: React.PointerEvent) => {
    beginDrag(e, { baseX: ins.pdfX, baseY: ins.pdfY });
  };

  // Resize from any of the 4 corners. Math is in PDF user space (y-up):
  // ins.pdfY is the BOTTOM of the box, ins.pdfY+pdfHeight is the top.
  // Each handle anchors the OPPOSITE corner so the box grows/shrinks
  // toward the dragged corner.
  type InsImageResizeCtx = {
    corner: "tl" | "tr" | "bl" | "br";
    base: { x: number; y: number; w: number; h: number };
  };
  const MIN_PDF = 10;
  const beginInsImageResize = useDragGesture<InsImageResizeCtx>({
    touchActivation: "immediate",
    onMove: (ctx, info) => {
      const { corner, base } = ctx;
      const dxPdf = info.dxRaw / effectivePdfScale;
      // Viewport y is y-down, PDF is y-up — drag DOWN means -dyPdf.
      const dyPdf = -info.dyRaw / effectivePdfScale;
      let { x, y } = base;
      let nw = base.w;
      let nh = base.h;
      switch (corner) {
        case "br": // anchor TL: x stays, y+h stays
          nw = Math.max(MIN_PDF, base.w + dxPdf);
          nh = Math.max(MIN_PDF, base.h - dyPdf);
          y = base.y + base.h - nh;
          break;
        case "tr": // anchor BL: x stays, y stays
          nw = Math.max(MIN_PDF, base.w + dxPdf);
          nh = Math.max(MIN_PDF, base.h + dyPdf);
          break;
        case "tl": // anchor BR: x+w stays, y stays
          nw = Math.max(MIN_PDF, base.w - dxPdf);
          nh = Math.max(MIN_PDF, base.h + dyPdf);
          x = base.x + base.w - nw;
          break;
        case "bl": // anchor TR: x+w stays, y+h stays
          nw = Math.max(MIN_PDF, base.w - dxPdf);
          nh = Math.max(MIN_PDF, base.h - dyPdf);
          x = base.x + base.w - nw;
          y = base.y + base.h - nh;
          break;
      }
      onChange({ pdfX: x, pdfY: y, pdfWidth: nw, pdfHeight: nh });
    },
  });
  const startResize = (corner: "tl" | "tr" | "bl" | "br") => (e: React.PointerEvent) => {
    beginInsImageResize(e, {
      corner,
      base: { x: ins.pdfX, y: ins.pdfY, w: ins.pdfWidth, h: ins.pdfHeight },
    });
  };

  return (
    <>
      <div
        ref={overlayRef}
        data-image-insert-id={ins.id}
        role="button"
        tabIndex={0}
        aria-label="Inserted image — drag to move, corners to resize, Del to delete"
        style={{
          position: "absolute",
          left,
          top,
          width: w,
          height: h,
          backgroundImage: `url(${dataUrl})`,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          outline: isSelected
            ? "2px solid rgba(220, 50, 50, 0.85)"
            : "1px dashed rgba(40, 130, 255, 0.6)",
          cursor: "grab",
          pointerEvents: "auto",
          zIndex: 20,
          // Once the user actually moves, the in-parent copy stays
          // mounted but invisible — the body-portal clone below is
          // what the user sees. We DON'T hide on gesture-start alone:
          // mouse pointers activate the gesture eagerly on
          // pointerdown, and a no-motion click would otherwise hit a
          // hidden overlay and skip the select handoff (the click
          // would dispatch on whatever sits underneath).
          visibility: dragLive?.moved ? "hidden" : "visible",
          touchAction: "pan-y pinch-zoom",
        }}
        title={`Inserted image (drag corners to resize, click to select then Del to delete)`}
        onPointerDown={startDrag}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
          }
        }}
      >
        <ResizeHandle position="tl" parentW={w} parentH={h} onPointerDown={startResize("tl")} />
        <ResizeHandle position="tr" parentW={w} parentH={h} onPointerDown={startResize("tr")} />
        <ResizeHandle position="bl" parentW={w} parentH={h} onPointerDown={startResize("bl")} />
        <ResizeHandle position="br" parentW={w} parentH={h} onPointerDown={startResize("br")} />
      </div>
      {renderPortal({
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        outline: "1px dashed rgba(40, 130, 255, 0.85)",
      })}
    </>
  );
}
