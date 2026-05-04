import type { RenderedPage } from "../../../lib/pdf";
import type { Redaction } from "../../../lib/redactions";
import { useDragGesture } from "../../../lib/useDragGesture";
import { ResizeHandle } from "./ResizeHandle";

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
}: {
  redaction: Redaction;
  page: RenderedPage;
  /** Source page's natural→displayed ratio. Drag deltas in screen px
   *  divide by `displayScale * page.scale` to land in PDF user space. */
  displayScale: number;
  isSelected: boolean;
  onChange: (patch: Partial<Redaction>) => void;
  onSelect: () => void;
}) {
  const left = redaction.pdfX * page.scale;
  const top = page.viewHeight - (redaction.pdfY + redaction.pdfHeight) * page.scale;
  const w = redaction.pdfWidth * page.scale;
  const h = redaction.pdfHeight * page.scale;

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
    corner: "tl" | "tr" | "bl" | "br";
    base: { x: number; y: number; w: number; h: number };
  };
  const MIN_PDF = 4;
  const beginResize = useDragGesture<RedactResizeCtx>({
    onMove: (ctx, info) => {
      const { corner, base } = ctx;
      const dxPdf = info.dxRaw / effectivePdfScale;
      const dyPdf = -info.dyRaw / effectivePdfScale;
      let { x, y } = base;
      let nw = base.w;
      let nh = base.h;
      switch (corner) {
        case "br":
          nw = Math.max(MIN_PDF, base.w + dxPdf);
          nh = Math.max(MIN_PDF, base.h - dyPdf);
          y = base.y + base.h - nh;
          break;
        case "tr":
          nw = Math.max(MIN_PDF, base.w + dxPdf);
          nh = Math.max(MIN_PDF, base.h + dyPdf);
          break;
        case "tl":
          nw = Math.max(MIN_PDF, base.w - dxPdf);
          nh = Math.max(MIN_PDF, base.h + dyPdf);
          x = base.x + base.w - nw;
          break;
        case "bl":
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
        zIndex: 25,
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
          <ResizeHandle position="tl" parentW={w} parentH={h} onPointerDown={startResize("tl")} />
          <ResizeHandle position="tr" parentW={w} parentH={h} onPointerDown={startResize("tr")} />
          <ResizeHandle position="bl" parentW={w} parentH={h} onPointerDown={startResize("bl")} />
          <ResizeHandle position="br" parentW={w} parentH={h} onPointerDown={startResize("br")} />
        </>
      ) : null}
    </div>
  );
}
