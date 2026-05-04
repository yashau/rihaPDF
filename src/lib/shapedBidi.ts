// Bidi-aware mixed-script emitter.
//
// drawShapedText (shapedDraw.ts) handles single-direction text — it
// shapes the whole input with one HarfBuzz call in either RTL or LTR
// and emits one BT/ET block at one baseline x. That works for pure
// Thaana or pure Latin runs. For mixed text like "abc ދިވެހި 123" each
// span needs its own direction AND its own font: Thaana fonts (Faruma)
// cover the U+0780-U+07BF block but not ASCII; standard Latin fonts
// cover ASCII but not Thaana.
//
// This module:
//   1. Runs `bidi-js` to assign an embedding level per character.
//   2. Segments the text by level (each level-run is a single direction).
//   3. Picks a font per segment by parity (even = LTR = Latin font;
//      odd = RTL = Thaana font).
//   4. Shapes each segment via HarfBuzz when the chosen font has TTF
//      bytes; otherwise falls back to pdf-lib's drawText (standard-14
//      Helvetica/Times/Courier handle Latin without HarfBuzz).
//   5. Re-orders segments to visual order using UAX #9 rule L2.
//   6. Emits each segment at its cumulative visual x.
//
// Visual measurement uses HarfBuzz's totalAdvance for shaped segments
// and pdf-lib's widthOfTextAtSize for standard-14 segments — same
// dispatch as `measureTextWidth` in save.ts.

import bidiFactory from "bidi-js";
import { type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { buildShapedTextOpsFromShape, shapedAdvancePt, shapeText } from "./shapedDraw";

type Bidi = {
  getEmbeddingLevels(
    text: string,
    explicitDirection?: "ltr" | "rtl",
  ): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
};

let bidiInstance: Bidi | null = null;
function getBidi(): Bidi {
  if (!bidiInstance) {
    const factory = bidiFactory as () => Bidi;
    bidiInstance = factory();
  }
  return bidiInstance;
}

/** Coarse mixed-script detection. True iff the input has both an RTL
 *  strong character (Thaana / Hebrew / Arabic / etc.) AND a true LTR
 *  strong character (Latin / Greek / Cyrillic letter). Whitespace,
 *  digits, and punctuation aren't enough on their own to flip the
 *  classification — they're direction-neutral and would otherwise
 *  cause every "ދިވެހި 123" run to take the slow bidi path. */
export function isMixedScriptText(text: string): boolean {
  let hasRtl = false;
  let hasLtr = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x0590 && cp <= 0x08ff) ||
      (cp >= 0xfb1d && cp <= 0xfdff) ||
      (cp >= 0xfe70 && cp <= 0xfeff) ||
      (cp >= 0x10800 && cp <= 0x10fff)
    ) {
      hasRtl = true;
    } else if (
      (cp >= 0x41 && cp <= 0x5a) ||
      (cp >= 0x61 && cp <= 0x7a) ||
      (cp >= 0xc0 && cp <= 0x2af) ||
      (cp >= 0x370 && cp <= 0x3ff) ||
      (cp >= 0x400 && cp <= 0x4ff)
    ) {
      hasLtr = true;
    }
    if (hasRtl && hasLtr) return true;
  }
  return false;
}

export type MixedFont = {
  font: PDFFont;
  /** Raw TTF bytes when the font is a HarfBuzz-shapeable embedded font;
   *  null for pdf-lib StandardFonts (Helvetica/Times/Courier) which
   *  have no on-disk binary and need to go through `page.drawText`. */
  bytes: Uint8Array | null;
};

export type MixedShapedOptions = {
  text: string;
  /** Font used for LTR (even-level) segments. Typically Helvetica or
   *  the user's Latin pick when their primary is a Latin family. */
  latin: MixedFont;
  /** Font used for RTL (odd-level) segments. Typically Faruma. */
  thaana: MixedFont;
  /** Left edge of the rendered text in PDF user space. RTL right-
   *  alignment is the caller's responsibility — pass `rightAnchor -
   *  measureMixedWidth(...)` to grow leftward. */
  x: number;
  /** Baseline y in PDF user space (y-up). */
  y: number;
  /** Font size in PDF points. */
  size: number;
  /** Paragraph base direction. Undefined → bidi-js auto-detects from
   *  the first strong character. */
  baseDir?: "ltr" | "rtl";
  /** Fill color in 0..1 RGB. Applied to every emitted segment — both
   *  the HarfBuzz-shaped op blocks and the standard-14 `drawText`
   *  fallback. Undefined renders black (the default). */
  color?: [number, number, number];
};

type Segment = {
  text: string;
  level: number; // bidi level (even=LTR, odd=RTL)
};

type MeasuredSegment = Segment & {
  widthPt: number;
};

/** Append the operators for a bidi-aware mixed-script run to `page`'s
 *  content stream. Returns the total visual width — the caller uses it
 *  for underline geometry / RTL right-alignment / debug. */
export async function drawMixedShapedText(
  page: PDFPage,
  opts: MixedShapedOptions,
): Promise<{ width: number }> {
  if (opts.text.length === 0) return { width: 0 };
  const bidi = getBidi();
  const result = bidi.getEmbeddingLevels(opts.text, opts.baseDir);
  const logicalSegments = segmentByLevel(opts.text, result.levels);

  // Measure each segment so we can compute the visual cursor before
  // emitting anything. Doing this in one pass means we shape twice for
  // HB segments (once for measure, once for draw); HarfBuzz caches the
  // font face so the per-segment cost is just the text-shape pass,
  // which is sub-millisecond for typical run lengths.
  const measured: MeasuredSegment[] = [];
  for (const seg of logicalSegments) {
    const { font: f } = pickFont(seg, opts);
    const widthPt = await measureSegmentWidth(seg, f, opts.size);
    measured.push({ ...seg, widthPt });
  }

  const visual = reorderToVisual(measured);
  let cursorPt = 0;
  for (const seg of visual) {
    const { font: f } = pickFont(seg, opts);
    const xPt = opts.x + cursorPt;
    if (f.bytes) {
      const dir: "rtl" | "ltr" = seg.level % 2 === 1 ? "rtl" : "ltr";
      const shape = await shapeText(seg.text, f.bytes, dir);
      const fontKey = page.node.newFontDictionary("RihaShaped", f.font.ref);
      const ops = buildShapedTextOpsFromShape(shape, fontKey, {
        x: xPt,
        y: opts.y,
        size: opts.size,
        color: opts.color,
      });
      page.pushOperators(...ops);
    } else {
      // Standard-14 fallback for Latin segments with no TTF bytes —
      // pdf-lib emits its own BT/Tj/ET via fontkit's layout. Latin
      // shaping is shallow enough that fontkit handles it correctly.
      const c = opts.color ?? [0, 0, 0];
      page.drawText(seg.text, {
        x: xPt,
        y: opts.y,
        size: opts.size,
        font: f.font,
        color: rgb(c[0], c[1], c[2]),
      });
    }
    cursorPt += seg.widthPt;
  }
  return { width: cursorPt };
}

/** Total visual width of `text` rendered with the same bidi/multi-font
 *  segmentation as `drawMixedShapedText`. Used by the save pipeline for
 *  RTL right-alignment math before the actual draw. */
export async function measureMixedWidth(
  text: string,
  fonts: { latin: MixedFont; thaana: MixedFont },
  size: number,
  baseDir?: "ltr" | "rtl",
): Promise<number> {
  if (text.length === 0) return 0;
  const bidi = getBidi();
  const result = bidi.getEmbeddingLevels(text, baseDir);
  const logicalSegments = segmentByLevel(text, result.levels);
  let total = 0;
  for (const seg of logicalSegments) {
    const f = seg.level % 2 === 1 ? fonts.thaana : fonts.latin;
    total += await measureSegmentWidth(seg, f, size);
  }
  return total;
}

async function measureSegmentWidth(seg: Segment, f: MixedFont, size: number): Promise<number> {
  if (f.bytes) {
    const dir: "rtl" | "ltr" = seg.level % 2 === 1 ? "rtl" : "ltr";
    const shape = await shapeText(seg.text, f.bytes, dir);
    return shapedAdvancePt(shape, size);
  }
  return f.font.widthOfTextAtSize(seg.text, size);
}

function pickFont(seg: Segment, opts: MixedShapedOptions): { font: MixedFont } {
  return seg.level % 2 === 1 ? { font: opts.thaana } : { font: opts.latin };
}

/** Split `text` into maximal runs of consecutive characters with the
 *  same embedding level. Each run becomes one shape() call. */
function segmentByLevel(text: string, levels: Uint8Array): Segment[] {
  const segments: Segment[] = [];
  if (text.length === 0) return segments;
  let curStart = 0;
  let curLevel = levels[0];
  for (let i = 1; i < text.length; i++) {
    if (levels[i] !== curLevel) {
      segments.push({ text: text.slice(curStart, i), level: curLevel });
      curStart = i;
      curLevel = levels[i];
    }
  }
  segments.push({ text: text.slice(curStart), level: curLevel });
  return segments;
}

/** UAX #9 rule L2: from the highest level down to the lowest odd level,
 *  reverse all consecutive runs at that level or higher. This is the
 *  standard line-reordering algorithm — segments come out in visual
 *  order (left-to-right on screen) regardless of base direction. */
function reorderToVisual<T extends { level: number }>(segments: T[]): T[] {
  let maxLevel = 0;
  let minOddLevel = Infinity;
  for (const s of segments) {
    if (s.level > maxLevel) maxLevel = s.level;
    if (s.level % 2 === 1 && s.level < minOddLevel) minOddLevel = s.level;
  }
  if (minOddLevel === Infinity) return segments.slice();

  const ordered = segments.slice();
  for (let lev = maxLevel; lev >= minOddLevel; lev--) {
    let runStart = -1;
    for (let i = 0; i <= ordered.length; i++) {
      const inRun = i < ordered.length && ordered[i].level >= lev;
      if (inRun && runStart === -1) {
        runStart = i;
      } else if (!inRun && runStart !== -1) {
        const sub = ordered.slice(runStart, i).reverse();
        ordered.splice(runStart, i - runStart, ...sub);
        runStart = -1;
      }
    }
  }
  return ordered;
}
