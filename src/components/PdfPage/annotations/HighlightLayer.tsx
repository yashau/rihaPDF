import type { Annotation } from "../../../lib/annotations";
import type { ToolMode } from "../../../App";
import { rgba, vpY } from "./helpers";

/** SVG layer for highlight quads. One `<rect>` per quad, translucent
 *  fill in the annotation's chosen colour. Click-to-delete is gated
 *  on `tool === "select"` so highlight mode itself doesn't accidentally
 *  delete what the user just made. */
export function HighlightLayer({
  annotations,
  pageScale,
  viewHeight,
  tool,
  onAnnotationDelete,
}: {
  annotations: Annotation[];
  pageScale: number;
  viewHeight: number;
  tool: ToolMode;
  onAnnotationDelete: (id: string) => void;
}) {
  return (
    <svg
      className="absolute inset-0"
      width="100%"
      height="100%"
      // Layer itself doesn't capture; individual rects opt-in via
      // `pointerEvents: "auto"` when the select tool is active.
      style={{ overflow: "visible", pointerEvents: "none" }}
    >
      {annotations.map((a) => {
        if (a.kind !== "highlight") return null;
        return a.quads.map((q, i) => {
          const x = Math.min(q.x1, q.x3) * pageScale;
          const y = vpY(Math.max(q.y1, q.y2), pageScale, viewHeight);
          const w = (Math.max(q.x2, q.x4) - Math.min(q.x1, q.x3)) * pageScale;
          const h = (Math.max(q.y1, q.y2) - Math.min(q.y3, q.y4)) * pageScale;
          return (
            <rect
              key={`${a.id}-${i}`}
              x={x}
              y={y}
              width={w}
              height={h}
              fill={rgba(a.color, 0.4)}
              style={{ pointerEvents: tool === "select" ? "auto" : "none" }}
              onClick={(e) => {
                if (tool !== "select") return;
                e.stopPropagation();
                if (window.confirm("Delete highlight?")) onAnnotationDelete(a.id);
              }}
            />
          );
        });
      })}
    </svg>
  );
}
