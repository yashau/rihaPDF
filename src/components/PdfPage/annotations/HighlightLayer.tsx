import type { Annotation, HighlightAnnotation } from "@/domain/annotations";
import { HighlightOverlay } from "./HighlightOverlay";

/** Fan-out: one HighlightOverlay per quad. Each overlay handles its
 *  own select / drag / resize / delete UX (mirrors the redact tool).
 *  Resize handles are restricted to the FIRST quad of a multi-quad
 *  highlight — multi-line highlights aren't a product feature yet, but
 *  if they show up later, single-quad-resize-only is an obvious
 *  default until the multi-quad UX is designed. */
export function HighlightLayer({
  annotations,
  pageScale,
  viewHeight,
  displayScale,
  selectedHighlightId,
  onAnnotationChange,
  onSelectHighlight,
}: {
  annotations: Annotation[];
  pageScale: number;
  viewHeight: number;
  displayScale: number;
  selectedHighlightId: string | null;
  onAnnotationChange: (id: string, patch: Partial<HighlightAnnotation>) => void;
  onSelectHighlight: (id: string) => void;
}) {
  return (
    <>
      {annotations.map((a) => {
        if (a.kind !== "highlight") return null;
        return a.quads.map((q, i) => (
          <HighlightOverlay
            key={`${a.id}-${i}`}
            annotation={a}
            quad={q}
            quadIndex={i}
            pageScale={pageScale}
            viewHeight={viewHeight}
            displayScale={displayScale}
            isSelected={selectedHighlightId === a.id}
            resizable={i === 0}
            onChange={(patch) => onAnnotationChange(a.id, patch)}
            onSelect={() => onSelectHighlight(a.id)}
          />
        ));
      })}
    </>
  );
}
