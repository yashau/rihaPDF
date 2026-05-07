import type { RenderedPage } from "@/pdf/render/pdf";
import type { Redaction } from "@/domain/redactions";
import { useDragGesture } from "@/platform/hooks/useDragGesture";
import {
  pdfRectToViewportRect,
  resizePdfRectFromCorner,
  screenDeltaToPdf,
  type ResizeCorner,
} from "../geometry";
import { OverlayDeleteButton } from "./OverlayDeleteButton";
import { ResizeHandles } from "./ResizeHandle";

/** Opaque black rectangle over a redacted region. In-editor preview
 *  ONLY — the underlying glyphs are still in the content stream of
 *  the live page canvas (we don't preview-strip for redactions; that
 *  would needlessly re-render every page on each click). At save
 *  time the pipeline both strips the underlying Tj/TJ ops AND paints
 *  this same rect into the content stream, so the saved PDF has no
 *  recoverable text under the box and renders an opaque block in
 *  every reader.
 *
 *  Drag to move; corners to resize; click to select; Del to delete.
 *  Same interaction model as InsertedImageOverlay — no cross-page
 *  drop target (a redaction belongs to one page, and "redact this
 *  text on another page" is just another click on that page). */
export function RedactionOverlay({
  redaction,
  page,
  displayScale,
  isSelected,
  onChange,
  onSelect,
  onDelete,
}: {
  redaction: Redaction;
  page: RenderedPage;
  /** Source page's natural→displayed ratio. Drag deltas in screen px
   *  divide by `displayScale * page.scale` to land in PDF user space. */
  displayScale: number;
  isSelected: boolean;
  onChange: (patch: Partial<Redaction>) => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const {
    left,
    top,
    width: w,
    height: h,
  } = pdfRectToViewportRect(redaction, page.scale, page.viewHeight);

  const effectivePdfScale = page.scale * displayScale;

  type RedactDragCtx = { baseX: number; baseY: number };
  const beginDrag = useDragGesture<RedactDragCtx>({
    onMove: (ctx, info) => {
      onChange({
        pdfX: ctx.baseX + info.dxRaw / effectivePdfScale,
        pdfY: ctx.baseY - info.dyRaw / effectivePdfScale,
      });
    },
  });
  const startDrag = (e: React.PointerEvent) => {
    beginDrag(e, { baseX: redaction.pdfX, baseY: redaction.pdfY });
  };

  type RedactResizeCtx = {
    corner: ResizeCorner;
    base: { x: number; y: number; w: number; h: number };
  };
  const MIN_PDF = 4;
  const beginResize = useDragGesture<RedactResizeCtx>({
    touchActivation: "immediate",
    onMove: (ctx, info) => {
      const { corner, base } = ctx;
      const { dxPdf, dyPdf } = screenDeltaToPdf(info.dxRaw, info.dyRaw, effectivePdfScale);
      const next = resizePdfRectFromCorner(base, corner, dxPdf, dyPdf, MIN_PDF);
      onChange({ pdfX: next.x, pdfY: next.y, pdfWidth: next.w, pdfHeight: next.h });
    },
  });
  const startResize = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    beginResize(e, {
      corner,
      base: { x: redaction.pdfX, y: redaction.pdfY, w: redaction.pdfWidth, h: redaction.pdfHeight },
    });
  };

  return (
    <div
      data-redaction-id={redaction.id}
      role="button"
      tabIndex={0}
      aria-label="Redaction — drag to move, corners to resize, Del to delete"
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        height: h,
        background: "black",
        // Selected outline color matches other overlays (inserted image,
        // shape) so the user reads the same selection cue everywhere.
        outline: isSelected ? "2px solid rgba(220, 50, 50, 0.85)" : undefined,
        cursor: "grab",
        pointerEvents: "auto",
        zIndex: 55,
        touchAction: "pan-y pinch-zoom",
      }}
      title="Redaction (drag corners to resize, click to select then Del to delete)"
      onPointerDown={startDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      {isSelected ? (
        <>
          <OverlayDeleteButton
            aria-label="Delete redaction"
            positionClassName="-top-7 -right-2"
            onDelete={onDelete}
          />
          <ResizeHandles parentW={w} parentH={h} onPointerDown={startResize} />
        </>
      ) : null}
    </div>
  );
}
