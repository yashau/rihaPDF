import { useRef, useState } from "react";
import {
  annotationBBox,
  type Annotation,
  type AnnotationColor,
  type InkAnnotation,
  newAnnotationId,
} from "@/domain/annotations";
import type { ToolMode } from "@/domain/toolMode";
import { OverlayDeleteButton } from "../overlays/OverlayDeleteButton";
import { useCrossPageDragPreview } from "../useCrossPageDragPreview";
import { findPageAtPoint } from "../helpers";
import { rgba, vpY } from "./helpers";

/** SVG layer for ink polylines + the pointer-event capture surface
 *  for drawing new strokes. When `tool === "ink"` the wrapping div
 *  raises its z-index and claims pointer events so pointerdown/move/up
 *  build a fresh stroke; on pointerup the stroke commits as a new
 *  InkAnnotation via `onAnnotationAdd`. */
export function InkLayer({
  annotations,
  pageScale,
  viewHeight,
  pageIndex,
  sourceKey,
  tool,
  color,
  thickness,
  selectedInkId,
  onAnnotationAdd,
  onAnnotationChange,
  onAnnotationDelete,
  onSelectInk,
  onDeleteSelection,
}: {
  annotations: Annotation[];
  pageScale: number;
  viewHeight: number;
  /** Page index within slots — written into the new annotation so save
   *  can re-address it to the slot's source page. App rewrites
   *  sourceKey/pageIndex at flatten time, but we still need a value. */
  pageIndex: number;
  sourceKey: string;
  tool: ToolMode;
  /** Stroke color + width for the IN-PROGRESS preview and the
   *  committed annotation. Owned by App via the InkToolbar; the
   *  InkLayer is otherwise stateless about ink settings. */
  color: AnnotationColor;
  thickness: number;
  onAnnotationAdd: (annotation: Annotation) => void;
  selectedInkId: string | null;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
  onSelectInk: (id: string) => void;
  onDeleteSelection: () => void;
}) {
  /** Stroke being captured by the ink tool. null when not drawing. The
   *  layer commits this as a fresh InkAnnotation on pointerup. */
  const [drawing, setDrawing] = useState<Array<{ x: number; y: number }> | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const isInkActive = tool === "ink";

  return (
    <div
      ref={captureRef}
      className="absolute inset-0"
      // The capture layer sits ABOVE existing overlays (zIndex high) so
      // it can intercept pointer events for ink. For other tools (and
      // for "select") it's pointer-events-none so highlights / notes /
      // ink polylines underneath stay clickable through the descendants
      // that opt in with `pointerEvents: "auto"`.
      style={{
        zIndex: isInkActive ? 60 : 5,
        pointerEvents: isInkActive ? "auto" : "none",
        cursor: isInkActive ? "crosshair" : "default",
        touchAction: isInkActive ? "none" : undefined,
      }}
      onPointerDown={(e) => {
        if (!isInkActive) return;
        const host = captureRef.current;
        if (!host) return;
        e.preventDefault();
        host.setPointerCapture(e.pointerId);
        const r = host.getBoundingClientRect();
        // r is the DISPLAYED rect (post-CSS-transform). `ds` is the
        // displayed-pixel-per-natural-pixel ratio, used to undo
        // fit-to-width before we convert to PDF user space below.
        const ds = r.width > 0 ? r.width / (host.clientWidth || 1) : 1;
        const xView = (e.clientX - r.left) / ds;
        const yView = (e.clientY - r.top) / ds;
        setDrawing([{ x: xView / pageScale, y: (viewHeight - yView) / pageScale }]);
      }}
      onPointerMove={(e) => {
        if (!isInkActive || !drawing) return;
        const host = captureRef.current;
        if (!host) return;
        const r = host.getBoundingClientRect();
        const ds = r.width > 0 ? r.width / (host.clientWidth || 1) : 1;
        const xView = (e.clientX - r.left) / ds;
        const yView = (e.clientY - r.top) / ds;
        const nextPoint = { x: xView / pageScale, y: (viewHeight - yView) / pageScale };
        setDrawing((prev) => {
          if (!prev) return prev;
          const last = prev[prev.length - 1];
          // Drop adjacent samples that are <0.5pt apart — pointer events
          // fire faster than ink files need to record, and the polyline
          // simplification keeps file size sane on long strokes.
          const dx = nextPoint.x - last.x;
          const dy = nextPoint.y - last.y;
          if (dx * dx + dy * dy < 0.25) return prev;
          return [...prev, nextPoint];
        });
      }}
      onPointerUp={() => {
        if (!isInkActive || !drawing) return;
        if (drawing.length >= 2) {
          onAnnotationAdd({
            kind: "ink",
            id: newAnnotationId("ink"),
            sourceKey,
            pageIndex,
            strokes: [drawing],
            color,
            thickness,
          });
        }
        setDrawing(null);
      }}
      onPointerCancel={() => setDrawing(null)}
    >
      {annotations.map((a) =>
        a.kind === "ink" ? (
          <InkOverlay
            key={a.id}
            annotation={a}
            pageScale={pageScale}
            viewHeight={viewHeight}
            tool={tool}
            isSelected={selectedInkId === a.id}
            onAnnotationChange={onAnnotationChange}
            onAnnotationDelete={onAnnotationDelete}
            onSelectInk={onSelectInk}
            onDeleteSelection={onDeleteSelection}
          />
        ) : null,
      )}
      <svg
        className="absolute inset-0"
        width="100%"
        height="100%"
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        {/* Live ink preview while the user is drawing -- not yet
            committed. */}
        {drawing && drawing.length >= 2 ? (
          <path
            d={drawing
              .map((p, i) => {
                const x = p.x * pageScale;
                const y = vpY(p.y, pageScale, viewHeight);
                return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
              })
              .join(" ")}
            stroke={rgba(color, 1)}
            strokeWidth={thickness * pageScale}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
      </svg>
    </div>
  );
}

function InkOverlay({
  annotation,
  pageScale,
  viewHeight,
  tool,
  isSelected,
  onAnnotationChange,
  onAnnotationDelete,
  onSelectInk,
  onDeleteSelection,
}: {
  annotation: InkAnnotation;
  pageScale: number;
  viewHeight: number;
  tool: ToolMode;
  isSelected: boolean;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
  onSelectInk: (id: string) => void;
  onDeleteSelection: () => void;
}) {
  const [llx, lly, urx, ury] = annotationBBox(annotation);
  const bboxLeft = llx * pageScale;
  const bboxTop = vpY(ury, pageScale, viewHeight);
  const bboxWidth = Math.max(0, (urx - llx) * pageScale);
  const bboxHeight = Math.max(0, (ury - lly) * pageScale);
  const hitPad = Math.max(6, annotation.thickness * pageScale + 4);
  const hitLeft = bboxLeft - hitPad;
  const hitTop = bboxTop - hitPad;
  const hitWidth = bboxWidth + hitPad * 2;
  const hitHeight = bboxHeight + hitPad * 2;
  const paths = annotation.strokes
    .filter((stroke) => stroke.length >= 2)
    .map((stroke) => strokeToPath(stroke, pageScale, viewHeight, hitLeft, hitTop));

  type InkDragCtx = { llx: number; ury: number; strokes: InkAnnotation["strokes"] };
  const { overlayRef, dragLive, beginDrag, renderPortal } = useCrossPageDragPreview<InkDragCtx>({
    onEnd: (ctx, info, live) => {
      if (!info.moved || !live) return;
      const hit = findPageAtPoint(info.clientX, info.clientY);
      if (!hit) return;
      const newScreenLeft = info.clientX - live.cursorOffsetX + hitPad * hit.displayScale;
      const newScreenTop = info.clientY - live.cursorOffsetY + hitPad * hit.displayScale;
      const newBoxLeftNat = (newScreenLeft - hit.rect.left) / hit.displayScale;
      const newBoxTopNat = (newScreenTop - hit.rect.top) / hit.displayScale;
      const newLlx = newBoxLeftNat / hit.scale;
      const newUry = (hit.viewHeight - newBoxTopNat) / hit.scale;
      const dxPdf = newLlx - ctx.llx;
      const dyPdf = newUry - ctx.ury;
      onAnnotationChange(annotation.id, {
        sourceKey: hit.sourceKey,
        pageIndex: hit.pageIndex,
        strokes: ctx.strokes.map((stroke) =>
          stroke.map((p) => ({ x: p.x + dxPdf, y: p.y + dyPdf })),
        ),
      });
    },
  });

  if (paths.length === 0) return null;

  const svg = (
    <svg width="100%" height="100%" viewBox={`0 0 ${hitWidth} ${hitHeight}`}>
      {isSelected ? (
        <rect
          x={hitPad}
          y={hitPad}
          width={bboxWidth}
          height={bboxHeight}
          fill="none"
          stroke="rgba(220, 50, 50, 0.85)"
          strokeWidth={2}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {paths.map((d, i) => (
        <path
          key={`${annotation.id}-${i}`}
          d={d}
          stroke={rgba(annotation.color, 1)}
          strokeWidth={annotation.thickness * pageScale}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );

  return (
    <>
      <div
        ref={overlayRef}
        data-ink-id={annotation.id}
        role="button"
        tabIndex={0}
        aria-label="Ink annotation -- drag to move, Del to delete"
        title="Ink annotation (click to select, drag to move, Del to delete)"
        style={{
          position: "absolute",
          left: hitLeft,
          top: hitTop,
          width: hitWidth,
          height: hitHeight,
          zIndex: 15,
          pointerEvents: tool === "select" ? "auto" : "none",
          cursor: dragLive?.moved ? "grabbing" : "grab",
          touchAction: "pan-y pinch-zoom",
          visibility: dragLive?.moved ? "hidden" : "visible",
        }}
        onPointerDown={(e) => {
          if (tool !== "select") return;
          e.currentTarget.focus();
          onSelectInk(annotation.id);
          beginDrag(e, { llx, ury, strokes: annotation.strokes });
        }}
        onClick={(e) => {
          if (tool !== "select") return;
          e.stopPropagation();
          e.currentTarget.focus();
          onSelectInk(annotation.id);
        }}
        onFocus={() => {
          if (tool === "select") onSelectInk(annotation.id);
        }}
        onKeyDown={(e) => {
          if (tool !== "select") return;
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            e.stopPropagation();
            onAnnotationDelete(annotation.id);
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onSelectInk(annotation.id);
          }
        }}
      >
        {svg}
        {isSelected ? (
          <OverlayDeleteButton
            aria-label="Delete ink annotation"
            positionClassName="-top-7 -right-2"
            onDelete={onDeleteSelection}
          />
        ) : null}
      </div>
      {renderPortal({ pointerEvents: "none" }, svg)}
    </>
  );
}

function strokeToPath(
  stroke: Array<{ x: number; y: number }>,
  pageScale: number,
  viewHeight: number,
  offsetX = 0,
  offsetY = 0,
): string {
  return stroke
    .map((p, i) => {
      const x = p.x * pageScale - offsetX;
      const y = vpY(p.y, pageScale, viewHeight) - offsetY;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}
