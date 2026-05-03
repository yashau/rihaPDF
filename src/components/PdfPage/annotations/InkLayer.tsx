import { useRef, useState } from "react";
import { type Annotation, DEFAULT_INK_COLOR, newAnnotationId } from "../../../lib/annotations";
import type { ToolMode } from "../../../App";
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
  onAnnotationAdd,
  onAnnotationDelete,
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
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationDelete: (id: string) => void;
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
            color: DEFAULT_INK_COLOR,
            thickness: 1.5,
          });
        }
        setDrawing(null);
      }}
      onPointerCancel={() => setDrawing(null)}
    >
      <svg
        className="absolute inset-0"
        width="100%"
        height="100%"
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        {annotations.map((a) => {
          if (a.kind !== "ink") return null;
          return a.strokes.map((stroke, i) => {
            if (stroke.length < 2) return null;
            const d = stroke
              .map((p, j) => {
                const x = p.x * pageScale;
                const y = vpY(p.y, pageScale, viewHeight);
                return `${j === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
              })
              .join(" ");
            return (
              <path
                key={`${a.id}-${i}`}
                d={d}
                stroke={rgba(a.color, 1)}
                strokeWidth={a.thickness * pageScale}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                style={{ pointerEvents: tool === "select" ? "auto" : "none" }}
                onClick={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  if (window.confirm("Delete ink stroke?")) onAnnotationDelete(a.id);
                }}
              />
            );
          });
        })}
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
            stroke={rgba(DEFAULT_INK_COLOR, 1)}
            strokeWidth={1.5 * pageScale}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
      </svg>
    </div>
  );
}
