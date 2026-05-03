// HarfBuzz-shaped text emission. Replaces pdf-lib's drawText for the
// Thaana save path: shape the run via harfbuzzjs (which knows GSUB/GPOS
// for Thaana), then write raw Tj operators with the shaped GIDs against
// a subset:false Type 0 / Identity-H font (CIDToGIDMap=Identity), so the
// CIDs we emit are the real GIDs in the embedded font.
//
// Why we don't go through page.drawText: it calls font.encodeText, which
// runs the text through fontkit's layout engine. fontkit's Thaana
// shaping is incomplete (no GPOS mark-to-base anchoring), which is the
// whole reason we're moving to HarfBuzz.
//
// Why the previous attempt at this was reverted (commit 1a8f23e): it
// passed pdfFont.name (the BaseFont string) as the Tf operand. But Tf
// takes a *page-resource* name (`/F1`, `/F2`...) — not the BaseFont.
// Acrobat / pdf.js then treated the unknown name as Latin fallback,
// producing garbage glyphs. The fix is to register the font on the page
// via PDFPageLeaf.newFontDictionary and use the returned PDFName as the
// Tf operand. That's what we do here.
//
// Per-glyph positioning uses Tm rather than relying on Tj's auto-advance.
// HarfBuzz can apply GPOS adjustments (kerning, mark anchoring) whose
// xOffset / yOffset don't match the font's natural advance widths, and
// emitting an explicit Tm before each glyph keeps the cursor unambiguous
// no matter what shaping does. Costs ~3 ops per glyph instead of ~1; for
// realistic Thaana runs (≤200 glyphs) the overhead is negligible.
//
// Stream order: HarfBuzz returns glyphs in *visual* order regardless of
// direction (leftmost-first for both LTR and RTL). For pdf.js text
// extraction to recover the original logical string, RTL runs need
// glyphs emitted in *logical* order (rightmost-first for Thaana / Hebrew
// / Arabic). We therefore iterate the HB output in reverse for RTL,
// walking the cursor right-to-left so each glyph still lands at its
// correct visual x. LTR runs emit straight through.

import {
  beginText,
  endText,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFPage,
  setFontAndSize,
  setTextMatrix,
  showText,
} from "pdf-lib";
import { shapeAuto, shapeRtlThaana, type ShapeResult } from "./shape";

export type ShapedTextOptions = {
  text: string;
  font: PDFFont;
  /** Raw TTF bytes — same buffer that was passed to PDFDocument.embedFont
   *  with `subset: false`. Required because HarfBuzz needs the font's
   *  actual byte stream to read GSUB / GPOS / cmap tables. */
  fontBytes: Uint8Array;
  /** Baseline x in PDF user space (left edge of the rendered text;
   *  for right-aligned RTL the caller passes `rightAnchor - width`). */
  x: number;
  /** Baseline y in PDF user space (y-up). */
  y: number;
  /** Font size in PDF points. */
  size: number;
  /** Direction. "rtl" forces RTL shaping, "ltr" forces LTR, undefined
   *  auto-detects from codepoints (Thaana / Hebrew / Arabic → RTL). */
  dir?: "rtl" | "ltr";
};

export type ShapedDrawResult = {
  /** Total advance of the rendered text in PDF points. Caller uses this
   *  for underline / strikethrough geometry and for RTL right-alignment
   *  math (the shaped width may differ from pdf-lib's
   *  widthOfTextAtSize, which goes through fontkit instead of HB). */
  width: number;
  shape: ShapeResult;
};

/** Shape `text` and append raw text-show operators to `page`'s content
 *  stream. Registers the font in the page's `/Resources/Font` dict and
 *  uses the returned PDFName as the Tf operand — callers don't need to
 *  call `page.setFont` first. */
export async function drawShapedText(
  page: PDFPage,
  opts: ShapedTextOptions,
): Promise<ShapedDrawResult> {
  const shape = await shapeText(opts.text, opts.fontBytes, opts.dir);
  const fontKey = page.node.newFontDictionary("RihaShaped", opts.font.ref);
  const widthPt = shapedAdvancePt(shape, opts.size);
  const ops = buildShapedTextOpsFromShape(shape, fontKey, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
  });
  page.pushOperators(...ops);
  return { width: widthPt, shape };
}

/** Shape `text` and return the raw text-show operators *without*
 *  pushing them anywhere — used by callers that need to splice the
 *  operators into something other than a page's primary content stream
 *  (e.g. a `/FreeText` `/AP /N` Form XObject's stream). The caller is
 *  responsible for registering the font under `fontKey` in whichever
 *  resource dict its target stream resolves through. */
export async function buildShapedTextOps(
  opts: ShapedTextOptions & { fontKey: PDFName | string },
): Promise<{ ops: PDFOperator[]; width: number; shape: ShapeResult }> {
  const shape = await shapeText(opts.text, opts.fontBytes, opts.dir);
  const widthPt = shapedAdvancePt(shape, opts.size);
  const ops = buildShapedTextOpsFromShape(shape, opts.fontKey, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
  });
  return { ops, width: widthPt, shape };
}

export function shapedAdvancePt(shape: ShapeResult, sizePt: number): number {
  const upem = shape.unitsPerEm || 1000;
  return shape.totalAdvance * (sizePt / upem);
}

/** Build the BT/Tf/Tm.../Tj.../ET operator block for a *pre-computed*
 *  shape result. Used by the bidi-aware mixed-script emitter, which
 *  shapes each direction-segment separately and then concatenates the
 *  resulting op blocks at their respective visual positions. The
 *  primary callers from `drawShapedText` / `buildShapedTextOps` go
 *  through here too. */
export function buildShapedTextOpsFromShape(
  shape: ShapeResult,
  fontKey: PDFName | string,
  geom: { x: number; y: number; size: number },
): PDFOperator[] {
  const upem = shape.unitsPerEm || 1000;
  const scale = geom.size / upem;
  const ops: PDFOperator[] = [beginText(), setFontAndSize(fontKey, geom.size)];
  if (shape.direction === "rtl") {
    // HarfBuzz emits RTL output in *visual* order with cluster IDs
    // decreasing across glyphs. Within each cluster the buffer is in
    // visual stacking order — for Thaana that's mark-then-base.
    //
    // We emit one Tj per glyph (with its own Tm) so that pdf.js's
    // text-content extraction can place each glyph back into the
    // logical sequence via its ToUnicode CMap entry. Two important
    // ordering decisions:
    //
    //  1. Across clusters: emit in REVERSE buffer order so the
    //     rightmost-visual cluster (= first logical character) lands
    //     in the stream first. pdf.js's `sortItemsLogical` for RTL
    //     sorts by descending x, which then preserves logical order.
    //
    //  2. Within a cluster: emit BASE before MARK (i.e. reverse the
    //     buffer's mark-then-base ordering). All glyphs of the cluster
    //     share the same Tm — the cluster's leftmost visual x — so
    //     pdf.js sees tied positions and uses its width tiebreaker
    //     (wider first) to resolve order. With every Thaana base
    //     having non-zero hmtx width and fili having zero, base wins
    //     the tiebreaker. Skipping HB's GPOS xOffset / yOffset for
    //     marks doesn't change visual fidelity for Faruma and friends
    //     (whose fili glyphs are pre-positioned in their hmtx); fonts
    //     that rely on GPOS anchoring would render fili at the
    //     cluster's left edge instead of anchored to the base, which
    //     is a follow-up.
    const clusters: number[][] = [];
    let lastCluster = -1;
    for (let i = 0; i < shape.glyphs.length; i++) {
      if (shape.glyphs[i].cluster !== lastCluster) {
        clusters.push([i]);
        lastCluster = shape.glyphs[i].cluster;
      } else {
        clusters[clusters.length - 1].push(i);
      }
    }
    let cursor = shape.totalAdvance;
    for (let ci = clusters.length - 1; ci >= 0; ci--) {
      const indices = clusters[ci];
      let clusterAdv = 0;
      for (const gi of indices) clusterAdv += shape.glyphs[gi].xAdvance;
      cursor -= clusterAdv;
      const clusterX = geom.x + cursor * scale;
      // Walk the cluster's glyphs in REVERSE buffer order to swap HB's
      // mark-then-base into base-then-mark.
      for (const gi of indices.slice().reverse()) {
        const g = shape.glyphs[gi];
        ops.push(setTextMatrix(1, 0, 0, 1, clusterX, geom.y));
        const hex = g.glyphId.toString(16).padStart(4, "0");
        ops.push(showText(PDFHexString.of(hex)));
      }
    }
  } else {
    let cursor = 0;
    for (const g of shape.glyphs) {
      const glyphX = geom.x + (cursor + g.xOffset) * scale;
      const glyphY = geom.y + g.yOffset * scale;
      ops.push(setTextMatrix(1, 0, 0, 1, glyphX, glyphY));
      const hex = g.glyphId.toString(16).padStart(4, "0");
      ops.push(showText(PDFHexString.of(hex)));
      cursor += g.xAdvance;
    }
  }
  ops.push(endText());
  return ops;
}

/** Measure the width of `text` rendered with `fontBytes` at `size` via
 *  the shaped path. Mirrors pdf-lib's `widthOfTextAtSize` semantics but
 *  uses HarfBuzz's totalAdvance — required wherever we right-align RTL
 *  or draw decorations under shaped text. */
export async function measureShapedWidth(
  text: string,
  fontBytes: Uint8Array,
  size: number,
  dir: "rtl" | "ltr" | undefined,
): Promise<number> {
  const shape = await shapeText(text, fontBytes, dir);
  const upem = shape.unitsPerEm || 1000;
  return shape.totalAdvance * (size / upem);
}

export async function shapeText(
  text: string,
  fontBytes: Uint8Array,
  dir: "rtl" | "ltr" | undefined,
): Promise<ShapeResult> {
  if (dir === "rtl") return shapeRtlThaana(text, fontBytes);
  return shapeAuto(text, fontBytes);
}
