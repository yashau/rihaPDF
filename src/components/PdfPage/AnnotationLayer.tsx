// Per-page overlay for user-added annotations.
//
// Fans out to three sub-layers, each owning one annotation kind:
//   - HighlightLayer : SVG <rect> per quad, click-to-delete in select.
//   - InkLayer       : SVG <path> per stroke + the pointer-event
//                      capture surface for drawing new strokes.
//   - CommentLayer   : HTML comment boxes with inline editor + the
//                      cross-page drag (body-portal preview escapes
//                      the page wrapper's overflow:hidden).
//
// Coordinate convention: every Annotation field is in PDF user space
// (y-up). Sub-layers convert to NATURAL viewport pixels (y-down) for
// layout, matching the rest of PdfPage's overlays.

import type { Annotation } from "../../lib/annotations";
import type { ToolMode } from "../../App";
import { CommentLayer } from "./annotations/CommentLayer";
import { HighlightLayer } from "./annotations/HighlightLayer";
import { InkLayer } from "./annotations/InkLayer";

type Props = {
  annotations: Annotation[];
  pageScale: number;
  viewHeight: number;
  /** Source page's natural→displayed ratio. Drag pointer deltas in
   *  screen pixels divide by `pageScale * displayScale` to land in PDF
   *  user space — same convention as the InsertedTextOverlay drag. */
  displayScale: number;
  /** Page index within slots — written into the new annotation so save
   *  can re-address it to the slot's source page. App rewrites
   *  sourceKey/pageIndex at flatten time, but we still need a value. */
  pageIndex: number;
  sourceKey: string;
  tool: ToolMode;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
};

export function AnnotationLayer({
  annotations,
  pageScale,
  viewHeight,
  displayScale,
  pageIndex,
  sourceKey,
  tool,
  onAnnotationAdd,
  onAnnotationChange,
  onAnnotationDelete,
}: Props) {
  return (
    <>
      <HighlightLayer
        annotations={annotations}
        pageScale={pageScale}
        viewHeight={viewHeight}
        tool={tool}
        onAnnotationDelete={onAnnotationDelete}
      />
      <InkLayer
        annotations={annotations}
        pageScale={pageScale}
        viewHeight={viewHeight}
        pageIndex={pageIndex}
        sourceKey={sourceKey}
        tool={tool}
        onAnnotationAdd={onAnnotationAdd}
        onAnnotationDelete={onAnnotationDelete}
      />
      <CommentLayer
        annotations={annotations}
        pageScale={pageScale}
        viewHeight={viewHeight}
        displayScale={displayScale}
        pageIndex={pageIndex}
        tool={tool}
        onAnnotationChange={onAnnotationChange}
        onAnnotationDelete={onAnnotationDelete}
      />
    </>
  );
}
