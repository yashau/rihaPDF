// User-added PDF annotations: text-markup highlights, sticky-note
// comments, and freehand ink. Saved as native PDF /Annot dicts so any
// reader displays them as real annotations and other tools can edit
// them later (vs flattening into the content stream, which freezes them).
//
// Coordinates: every position is in PDF USER SPACE (y-up), matching
// insertions.ts and ImageInstance. PdfPage converts to viewport
// pixels when rendering overlays.

/** RGB triple in 0..1 — the on-disk shape of an annotation's /C array.
 *  Picked over hex strings so the save path can hand it to pdf-lib's
 *  PDFArray.of(...) without any parsing in between. */
export type AnnotationColor = [number, number, number];

export const DEFAULT_HIGHLIGHT_COLOR: AnnotationColor = [1, 0.92, 0.23];
/** Background fill for the comment box. The text inside renders black
 *  on top of this; saved as /C on the /FreeText annotation. */
export const DEFAULT_COMMENT_COLOR: AnnotationColor = [1, 0.96, 0.62];
export const DEFAULT_INK_COLOR: AnnotationColor = [0.93, 0.27, 0.27];

/** One quadrilateral over a text run, in PDF user-space (y-up). The
 *  PDF spec's /QuadPoints expects 8 numbers per quad in the order
 *  TL, TR, BL, BR — we keep them named here and serialize in spec
 *  order in saveAnnotations.ts so the field names can't drift. */
export type Quad = {
  x1: number;
  y1: number; // top-left
  x2: number;
  y2: number; // top-right
  x3: number;
  y3: number; // bottom-left
  x4: number;
  y4: number; // bottom-right
};

/** Translucent fill over a run or selection. One annotation can carry
 *  N quads (multi-line selection). Saved as /Subtype /Highlight. */
export type HighlightAnnotation = {
  kind: "highlight";
  id: string;
  sourceKey: string;
  pageIndex: number;
  quads: Quad[];
  color: AnnotationColor;
  /** Optional comment body — appears in the popup pane on click. */
  comment?: string;
};

/** FreeText comment: a visible text box drawn on the annotation layer
 *  (not the content stream). The text shows inline on the page in
 *  every PDF reader without needing to hover or click. Distinct from
 *  the existing `+ Text` insertion, which writes real PDF text into
 *  the content stream — this one stays as an annotation, so other
 *  PDF tools recognize it as markup that can be hidden, exported, or
 *  edited as an annotation. Saved as /Subtype /FreeText. */
export type CommentAnnotation = {
  kind: "comment";
  id: string;
  sourceKey: string;
  pageIndex: number;
  /** Bottom-left of the comment box in PDF user space (y-up). */
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  /** Background fill color. Text inside is rendered black. */
  color: AnnotationColor;
  /** Body text shown inside the comment. */
  text: string;
  /** Font size in PDF points. */
  fontSize: number;
};

/** Freehand stroke. `strokes` is a list of polylines so a single ink
 *  annotation can cover a multi-stroke gesture (pen-down, pen-up,
 *  pen-down again before committing). Saved as /Subtype /Ink with one
 *  /InkList entry per stroke. */
export type InkAnnotation = {
  kind: "ink";
  id: string;
  sourceKey: string;
  pageIndex: number;
  strokes: Array<Array<{ x: number; y: number }>>;
  color: AnnotationColor;
  /** Border thickness in PDF points. */
  thickness: number;
};

export type Annotation = HighlightAnnotation | CommentAnnotation | InkAnnotation;

/** Default size for a freshly-dropped comment box, in PDF points.
 *  Wide enough for ~25 characters of 12pt text on one line plus a bit
 *  of breathing room — the user resizes / re-types as needed. */
export const COMMENT_DEFAULT_WIDTH = 160;
export const COMMENT_DEFAULT_HEIGHT = 40;
export const COMMENT_DEFAULT_FONT_SIZE = 12;

/** Padding around the bbox of an ink annotation. PDF readers won't
 *  render an /Ink whose /Rect is degenerate, and a strict bbox of the
 *  stroke points is degenerate when the user drew a horizontal or
 *  vertical line. Padding by ~half the stroke width avoids that. */
export const INK_BBOX_PAD = 1;

let counter = 0;
export function newAnnotationId(kind: Annotation["kind"]): string {
  counter += 1;
  return `${kind}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Bounding box for an annotation in PDF user space, returned in the
 *  PDF /Rect convention `[llx, lly, urx, ury]` (y-up). Used by the
 *  save path and by overlays that need a containing rectangle. */
export function annotationBBox(a: Annotation): [number, number, number, number] {
  if (a.kind === "highlight") {
    let llx = Infinity;
    let lly = Infinity;
    let urx = -Infinity;
    let ury = -Infinity;
    for (const q of a.quads) {
      const xs = [q.x1, q.x2, q.x3, q.x4];
      const ys = [q.y1, q.y2, q.y3, q.y4];
      for (const x of xs) {
        if (x < llx) llx = x;
        if (x > urx) urx = x;
      }
      for (const y of ys) {
        if (y < lly) lly = y;
        if (y > ury) ury = y;
      }
    }
    return [llx, lly, urx, ury];
  }
  if (a.kind === "comment") {
    return [a.pdfX, a.pdfY, a.pdfX + a.pdfWidth, a.pdfY + a.pdfHeight];
  }
  // ink
  let llx = Infinity;
  let lly = Infinity;
  let urx = -Infinity;
  let ury = -Infinity;
  for (const stroke of a.strokes) {
    for (const p of stroke) {
      if (p.x < llx) llx = p.x;
      if (p.x > urx) urx = p.x;
      if (p.y < lly) lly = p.y;
      if (p.y > ury) ury = p.y;
    }
  }
  if (!Number.isFinite(llx)) return [0, 0, 0, 0];
  return [llx - INK_BBOX_PAD, lly - INK_BBOX_PAD, urx + INK_BBOX_PAD, ury + INK_BBOX_PAD];
}
