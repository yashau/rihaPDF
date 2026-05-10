import type { HighlightAnnotation, Quad } from "@/domain/annotations";
import { useDragGesture } from "@/platform/hooks/useDragGesture";
import { OverlayDeleteButton } from "../overlays/OverlayDeleteButton";
import { ResizeHandle } from "../overlays/ResizeHandle";
import { rgba } from "./helpers";

/** Translucent fill over a single highlight quad. Mirrors the
 *  redact-tool interaction model: click in `select` to select; drag
 *  the body to move; drag a corner handle to resize; Del to remove.
 *  Resize edits the underlying Quad in place — saved /QuadPoints
 *  reflect whatever the user dragged the rect to.
 *
 *  Multi-quad highlights (e.g. a future multi-line text-selection
 *  highlight) render one overlay per quad with the same selection +
 *  delete behaviour, but only the FIRST quad gets resize handles —
 *  resizing N quads coherently has no obvious UX, and the use case
 *  doesn't exist in the product yet. */
export function HighlightOverlay({
  annotation,
  quad,
  quadIndex,
  pageScale,
  viewHeight,
  displayScale,
  isSelected,
  resizable,
  onChange,
  onSelect,
  onDelete,
}: {
  annotation: HighlightAnnotation;
  quad: Quad;
  quadIndex: number;
  pageScale: number;
  viewHeight: number;
  displayScale: number;
  isSelected: boolean;
  /** Only the first quad gets resize handles for multi-quad highlights;
   *  passed in so the layer can decide centrally. */
  resizable: boolean;
  /** Patch the parent annotation. Resize emits a new `quads` array;
   *  caller is App's onAnnotationChange. */
  onChange: (patch: Partial<HighlightAnnotation>) => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  // Quad → screen-space rect. Quads in PDF user space (y-up) carry the
  // four corners as (TL, TR, BL, BR); the spec also allows arbitrary
  // 4-pointers but our save path only emits axis-aligned rects, so
  // taking min/max here is exact for our own output and a tight AABB
  // for any (rare) imported rotated quads.
  const llx = Math.min(quad.x1, quad.x3);
  const urx = Math.max(quad.x2, quad.x4);
  const lly = Math.min(quad.y3, quad.y4);
  const ury = Math.max(quad.y1, quad.y2);
  const left = llx * pageScale;
  const top = viewHeight - ury * pageScale;
  const w = (urx - llx) * pageScale;
  const h = (ury - lly) * pageScale;

  const effectivePdfScale = pageScale * displayScale;

  type DragCtx = { baseLlx: number; baseLly: number };
  const beginDrag = useDragGesture<DragCtx>({
    onMove: (ctx, info) => {
      const dxPdf = info.dxRaw / effectivePdfScale;
      const dyPdf = -info.dyRaw / effectivePdfScale;
      const newLlx = ctx.baseLlx + dxPdf;
      const newLly = ctx.baseLly + dyPdf;
      onChange({
        quads: rebuildQuads(annotation.quads, quadIndex, newLlx, newLly, urx - llx, ury - lly),
      });
    },
  });

  type ResizeCtx = {
    corner: "tl" | "tr" | "bl" | "br";
    base: { llx: number; lly: number; w: number; h: number };
  };
  const MIN_PDF = 4;
  const beginResize = useDragGesture<ResizeCtx>({
    touchActivation: "immediate",
    onMove: (ctx, info) => {
      const { corner, base } = ctx;
      const dxPdf = info.dxRaw / effectivePdfScale;
      const dyPdf = -info.dyRaw / effectivePdfScale;
      let nLlx = base.llx;
      let nLly = base.lly;
      let nW = base.w;
      let nH = base.h;
      switch (corner) {
        case "br":
          nW = Math.max(MIN_PDF, base.w + dxPdf);
          nH = Math.max(MIN_PDF, base.h - dyPdf);
          nLly = base.lly + base.h - nH;
          break;
        case "tr":
          nW = Math.max(MIN_PDF, base.w + dxPdf);
          nH = Math.max(MIN_PDF, base.h + dyPdf);
          break;
        case "tl":
          nW = Math.max(MIN_PDF, base.w - dxPdf);
          nH = Math.max(MIN_PDF, base.h + dyPdf);
          nLlx = base.llx + base.w - nW;
          break;
        case "bl":
          nW = Math.max(MIN_PDF, base.w - dxPdf);
          nH = Math.max(MIN_PDF, base.h - dyPdf);
          nLlx = base.llx + base.w - nW;
          nLly = base.lly + base.h - nH;
          break;
      }
      onChange({ quads: rebuildQuads(annotation.quads, quadIndex, nLlx, nLly, nW, nH) });
    },
  });

  const startDrag = (e: React.PointerEvent) => {
    beginDrag(e, { baseLlx: llx, baseLly: lly });
  };
  const startResize = (corner: "tl" | "tr" | "bl" | "br") => (e: React.PointerEvent) => {
    beginResize(e, {
      corner,
      base: { llx, lly, w: urx - llx, h: ury - lly },
    });
  };

  return (
    <div
      data-highlight-id={annotation.id}
      data-highlight-quad={quadIndex}
      role="button"
      tabIndex={0}
      aria-label="Highlight — drag to move, corners to resize, Del to delete"
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        height: h,
        background: rgba(annotation.color, 0.4),
        outline: isSelected ? "2px solid rgba(220, 50, 50, 0.85)" : undefined,
        cursor: "grab",
        pointerEvents: "auto",
        zIndex: 15,
        // Quick swipes over highlights should scroll/pan the document
        // in either axis; touch-hold still promotes to drag.
        touchAction: "pan-x pan-y pinch-zoom",
      }}
      title="Highlight (click to select, drag corners to resize, Del to delete)"
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
      {isSelected && resizable ? (
        <>
          <OverlayDeleteButton aria-label="Delete highlight" onDelete={onDelete} />
          <ResizeHandle position="tl" parentW={w} parentH={h} onPointerDown={startResize("tl")} />
          <ResizeHandle position="tr" parentW={w} parentH={h} onPointerDown={startResize("tr")} />
          <ResizeHandle position="bl" parentW={w} parentH={h} onPointerDown={startResize("bl")} />
          <ResizeHandle position="br" parentW={w} parentH={h} onPointerDown={startResize("br")} />
        </>
      ) : null}
    </div>
  );
}

/** Replace `quads[i]` with a single axis-aligned quad built from
 *  (llx, lly, w, h) in PDF user space. Other quads in the array are
 *  copied through unchanged so multi-quad highlights survive a single-
 *  quad edit. */
function rebuildQuads(
  quads: Quad[],
  i: number,
  llx: number,
  lly: number,
  w: number,
  h: number,
): Quad[] {
  const urx = llx + w;
  const ury = lly + h;
  const next: Quad = {
    x1: llx,
    y1: ury,
    x2: urx,
    y2: ury,
    x3: llx,
    y3: lly,
    x4: urx,
    y4: lly,
  };
  return quads.map((q, idx) => (idx === i ? next : q));
}
