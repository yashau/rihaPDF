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

import type { LineMarkupExtents } from "./annotations";

export type Redaction = {
  id: string;
  sourceKey: string;
  pageIndex: number;
  /** Bottom-left in PDF user space (y-up). */
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
};

/** Generous-by-design extents for a click-to-redact rect over a text
 *  run. Larger than HIGHLIGHT_LINE_PAD because once the underlying
 *  glyphs are stripped, ANY uncovered pixel reveals the page
 *  background — there's no "transparent black" to fall back on. The
 *  user can resize after the click to tighten or expand as needed. */
export const REDACTION_LINE_PAD: LineMarkupExtents = { aboveBaseline: 1.0, belowBaseline: 0.5 };

let counter = 0;
export function newRedactionId(): string {
  counter += 1;
  return `redact-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Axis-aligned overlap test in PDF user space. Used at save time to
 *  decide which runs a redaction strips. Any non-zero overlap counts
 *  — partial-overlap stripping is the only safe option since you
 *  can't render half a Tj op (and leaving the un-overlapped half
 *  visible would defeat the redaction). */
export function rectsOverlap(
  a: { pdfX: number; pdfY: number; pdfWidth: number; pdfHeight: number },
  b: { pdfX: number; pdfY: number; pdfWidth: number; pdfHeight: number },
): boolean {
  const ax2 = a.pdfX + a.pdfWidth;
  const ay2 = a.pdfY + a.pdfHeight;
  const bx2 = b.pdfX + b.pdfWidth;
  const by2 = b.pdfY + b.pdfHeight;
  return a.pdfX < bx2 && ax2 > b.pdfX && a.pdfY < by2 && ay2 > b.pdfY;
}
