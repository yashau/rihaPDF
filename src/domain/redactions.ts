// User-added redaction rectangles. Distinct from /Annot-based markup
// (highlight, comment, ink) because a redaction MUST permanently
// remove the underlying glyphs from the saved PDF — an annotation
// sits on top of the content stream and leaves the text selectable /
// extractable underneath, which is the opposite of what redaction is
// for. The save pipeline therefore handles redactions in two passes:
//
//   1. intersect the redaction's PDF-space rect against every text
//      run on the same page; strip the Tj/TJ ops of any run whose
//      bounds overlap the rect (re-uses the existing run-strip path).
//   2. paint a solid black filled rectangle into the page content
//      stream so the cleared area renders as an opaque block in every
//      reader, regardless of whether annotations are honored.
//
// Coordinates: PDF user space (y-up), matching insertions and
// annotations. (pdfX, pdfY) is the BOTTOM-LEFT of the rect.

import type { LineMarkupExtents } from "@/domain/annotations";
import type { PdfRect } from "@/domain/geometry";
export { rectsOverlap } from "@/domain/geometry";

export type Redaction = PdfRect & {
  id: string;
  sourceKey: string;
  pageIndex: number;
};

/** Generous-by-design extents for a click-to-redact rect over a text
 *  run. Larger than HIGHLIGHT_LINE_PAD because once the underlying
 *  glyphs are stripped, ANY uncovered pixel reveals the page
 *  background — there's no "transparent black" to fall back on. The
 *  user can resize after the click to tighten or expand as needed. */
export const REDACTION_LINE_PAD: LineMarkupExtents = { aboveBaseline: 1.0, belowBaseline: 0.5 };

/** Default size for a freshly-dropped redaction rectangle, in PDF
 *  points. The user can drag or resize it immediately after placement. */
export const REDACTION_DEFAULT_WIDTH = 160;
export const REDACTION_DEFAULT_HEIGHT = 40;

let counter = 0;
export function newRedactionId(): string {
  counter += 1;
  return `redact-${Date.now().toString(36)}-${counter.toString(36)}`;
}
