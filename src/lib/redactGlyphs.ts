// Per-glyph redaction strip pass.
//
// Given a parsed page content stream + the page's /Resources/Font dict
// + a list of redaction rects in PDF user space, this module walks
// every Tj/TJ text-show op, decodes the byte string into individual
// glyphs using the referenced font's metrics, computes each glyph's
// world bbox (via the running text matrix), and decides per-glyph
// whether it falls inside any redaction rect.
//
// Output: a list of "rewrite" decisions per op:
//   - all glyphs redacted        → drop the op entirely
//   - no glyphs redacted         → leave the op untouched
//   - some glyphs redacted       → replace the op with a new TJ that
//                                  emits only the kept glyphs, with
//                                  negative-spacer numbers in the
//                                  array to compensate for the gaps
//                                  (so trailing glyphs stay at their
//                                  original positions)
//
// Why this matters for redaction specifically: a Tj op like
// `(ABCDEFGHIJ) Tj` paints all 10 glyphs in one operation. If the
// redaction rect covers EFGH only, dropping the whole Tj (the
// previous strip approach) loses ABCD + IJ too. Per-glyph rewriting
// is the only way to redact a sub-span of a multi-glyph Tj while
// keeping the surrounding text intact and in its original position.
//
// Fallback safety: if a font's metrics can't be read (custom CMap
// composites, Type3, vertical writing, missing /Widths), we report
// the op as `unsupported` and the caller falls back to whole-op
// stripping. Over-stripping is the safe failure mode for redaction —
// under-stripping would leave glyphs in the file.

import { PDFArray, PDFContext, PDFDict, PDFName, PDFNumber, PDFRef } from "pdf-lib";
import type { ContentOp, ContentToken } from "./contentStream";
import { rectsOverlap, type PdfRect } from "./pdfGeometry";
import { walkTextShows, type PdfTextState, type TextShowSegment } from "./pdfTextWalker";

export type FontMetrics = {
  /** 1 for simple fonts (Type1/TrueType/MMType1); 2 for /Identity-H
   *  /Type0 composites (the case Office uses for Thaana). */
  bytesPerGlyph: number;
  /** Glyph code → horizontal advance in 1/1000 em (font units). */
  widthByGid: Map<number, number>;
  /** Fallback for codes not present in `widthByGid`. */
  defaultWidth: number;
  /** True for simple fonts (where /Tw word-spacing applies to
   *  byte-code 0x20). PDF spec §9.3.3 says Tw is ignored for
   *  composite fonts. */
  twAppliesToSpace: boolean;
};

export type Rect = PdfRect;

/** Per-op rewrite plan produced by `planRedactionStrip`. */
export type OpStripPlan =
  | { kind: "drop"; opIndex: number }
  | { kind: "rewrite"; opIndex: number; replacement: ContentOp }
  | { kind: "unsupported"; opIndex: number };

/** Resolve `/Resources/Font/<name>` → PDFDict, following indirect refs.
 *  Returns null if the resource is missing or malformed. */
export function resolveFontDict(
  resources: PDFDict,
  fontName: string,
  ctx: PDFContext,
): PDFDict | null {
  const fonts = resources.lookup(PDFName.of("Font"));
  if (!(fonts instanceof PDFDict)) return null;
  const fname = fontName.startsWith("/") ? fontName.slice(1) : fontName;
  const ref = fonts.get(PDFName.of(fname)) ?? fonts.lookup(PDFName.of(fname));
  const obj = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
  return obj instanceof PDFDict ? obj : null;
}

/** Read advance widths from a font dict. Supports:
 *    - Simple fonts (Type1/TrueType/MMType1): /Widths + /FirstChar.
 *    - Type0 composite with /Identity-H encoding: /DescendantFonts[0]/W.
 *  Returns null for everything else (custom CMap composites, Type3,
 *  vertical-mode fonts) so the caller can fall back to whole-op
 *  stripping rather than mis-decode and leak glyphs. */
export function readFontMetrics(fontDict: PDFDict, ctx: PDFContext): FontMetrics | null {
  const subtypeObj = fontDict.lookup(PDFName.of("Subtype"));
  if (!(subtypeObj instanceof PDFName)) return null;
  const subtype = subtypeObj.asString().replace(/^\//, "");

  if (subtype === "Type0") {
    const encoding = fontDict.lookup(PDFName.of("Encoding"));
    const encName = encoding instanceof PDFName ? encoding.asString().replace(/^\//, "") : null;
    // Bail on anything but Identity-H. Identity-V (vertical) and
    // custom CMaps would need their own decode + position logic;
    // safer to over-strip via the caller's whole-op fallback.
    if (encName !== "Identity-H") return null;

    const descendants = fontDict.lookup(PDFName.of("DescendantFonts"));
    if (!(descendants instanceof PDFArray)) return null;
    const cidFontObj = descendants.get(0);
    const cidFont = cidFontObj instanceof PDFRef ? ctx.lookup(cidFontObj) : cidFontObj;
    if (!(cidFont instanceof PDFDict)) return null;

    const dw = cidFont.lookup(PDFName.of("DW"));
    const defaultWidth = dw instanceof PDFNumber ? dw.asNumber() : 1000;

    const widthByGid = new Map<number, number>();
    const w = cidFont.lookup(PDFName.of("W"));
    if (w instanceof PDFArray) {
      // /W has two element shapes (PDF spec §9.7.4.3):
      //   c [w1 w2 …]  → CIDs c, c+1, … get widths w1, w2, …
      //   c1 c2 w      → CIDs c1..c2 (inclusive) all get width w
      // The two shapes can interleave inside one array; we stay one
      // pass so a single malformed entry can't desync subsequent
      // ones. On any unexpected token we stop.
      let i = 0;
      while (i < w.size()) {
        const a = w.get(i);
        if (!(a instanceof PDFNumber)) break;
        const cFirst = a.asNumber();
        const b = w.get(i + 1);
        if (b instanceof PDFArray) {
          for (let j = 0; j < b.size(); j++) {
            const wv = b.get(j);
            if (wv instanceof PDFNumber) widthByGid.set(cFirst + j, wv.asNumber());
          }
          i += 2;
        } else if (b instanceof PDFNumber) {
          const cLast = b.asNumber();
          const wv = w.get(i + 2);
          if (!(wv instanceof PDFNumber)) break;
          const wval = wv.asNumber();
          for (let c = cFirst; c <= cLast; c++) widthByGid.set(c, wval);
          i += 3;
        } else {
          break;
        }
      }
    }
    return { bytesPerGlyph: 2, widthByGid, defaultWidth, twAppliesToSpace: false };
  }

  if (subtype === "Type1" || subtype === "TrueType" || subtype === "MMType1") {
    const widthsObj = fontDict.lookup(PDFName.of("Widths"));
    const firstCharObj = fontDict.lookup(PDFName.of("FirstChar"));
    if (!(widthsObj instanceof PDFArray) || !(firstCharObj instanceof PDFNumber)) {
      // Standard 14 fonts (Helvetica etc.) historically omit /Widths
      // and the reader picks them from a built-in table. We can't
      // resolve those without shipping the table; punt to whole-op
      // strip. Real-world docs almost always embed widths, so this
      // branch rarely fires on actual user content.
      return null;
    }
    const firstChar = firstCharObj.asNumber();
    const widthByGid = new Map<number, number>();
    for (let i = 0; i < widthsObj.size(); i++) {
      const w = widthsObj.get(i);
      if (w instanceof PDFNumber) widthByGid.set(firstChar + i, w.asNumber());
    }
    let defaultWidth = 0;
    const fd = fontDict.lookup(PDFName.of("FontDescriptor"));
    if (fd instanceof PDFDict) {
      const mw = fd.lookup(PDFName.of("MissingWidth"));
      if (mw instanceof PDFNumber) defaultWidth = mw.asNumber();
    }
    return { bytesPerGlyph: 1, widthByGid, defaultWidth, twAppliesToSpace: true };
  }

  return null;
}

/** Single glyph extracted from a Tj/TJ string operand. */
type DecodedGlyph = {
  gid: number;
  bytes: Uint8Array;
  widthFontUnits: number;
};

function decodeGlyphs(bytes: Uint8Array, m: FontMetrics): DecodedGlyph[] {
  const out: DecodedGlyph[] = [];
  const bpg = m.bytesPerGlyph;
  // Truncate any trailing partial-glyph bytes (encoder bug or stray
  // padding) — better to under-emit than to emit a bogus glyph from
  // half a CID.
  const usable = bytes.length - (bytes.length % bpg);
  for (let i = 0; i < usable; i += bpg) {
    let gid = 0;
    for (let k = 0; k < bpg; k++) gid = (gid << 8) | bytes[i + k];
    const widthFontUnits = m.widthByGid.get(gid) ?? m.defaultWidth;
    out.push({ gid, bytes: bytes.slice(i, i + bpg), widthFontUnits });
  }
  return out;
}

/** Compute the AABB of the four world-space corners of a text-space
 *  rect (x0..x1) × (0..fontSize) under text matrix Tm. The text-space
 *  height is the font size — a conservative envelope (the actual
 *  ascent + descent extents fit inside this for any sensibly-sized
 *  glyph). For redaction we *want* a conservative envelope: an
 *  underestimated bbox could leave a glyph un-redacted that's
 *  visually under the rect. */
function bboxFromTextSpaceRect(
  tm: PdfTextState["tm"],
  x0: number,
  x1: number,
  fontSize: number,
): Rect {
  const [a, b, c, d, e, f] = tm;
  const corners: Array<[number, number]> = [
    [x0, 0],
    [x1, 0],
    [x1, fontSize],
    [x0, fontSize],
  ];
  let llx = Infinity;
  let lly = Infinity;
  let urx = -Infinity;
  let ury = -Infinity;
  for (const [tx, ty] of corners) {
    const wx = a * tx + c * ty + e;
    const wy = b * tx + d * ty + f;
    if (wx < llx) llx = wx;
    if (wx > urx) urx = wx;
    if (wy < lly) lly = wy;
    if (wy > ury) ury = wy;
  }
  return { pdfX: llx, pdfY: lly, pdfWidth: urx - llx, pdfHeight: ury - lly };
}

/** Plan a per-glyph redaction strip across every text-show in `ops`.
 *  Returns one entry per *touched* op (the caller assumes anything
 *  not in the result is left untouched, so an empty list means "no
 *  redactions hit any text — paint rects, nothing else to do"). */
export function planRedactionStrip(
  ops: ContentOp[],
  pageResources: PDFDict,
  ctx: PDFContext,
  redactions: Rect[],
): OpStripPlan[] {
  if (redactions.length === 0) return [];

  // Resolved-font cache. The same /Tf can appear hundreds of times in
  // one stream; resolving the dict + reading /Widths is the expensive
  // part. Re-look-up per op would be quadratic on large pages.
  const metricsCache = new Map<string, FontMetrics | null>();
  const getMetrics = (name: string): FontMetrics | null => {
    if (metricsCache.has(name)) return metricsCache.get(name)!;
    const dict = resolveFontDict(pageResources, name, ctx);
    const m = dict ? readFontMetrics(dict, ctx) : null;
    metricsCache.set(name, m);
    return m;
  };

  const plans: OpStripPlan[] = [];
  walkTextShows(ops, ({ opIndex, state, segments }) => {
    const plan = processShowOp(opIndex, state, getMetrics, redactions, segments);
    if (plan) plans.push(plan);
  });
  return plans;
}

/** Walk a single Tj/TJ op's glyphs against the redactions. Returns
 *  null if the op was completely untouched (so the caller can leave
 *  it alone). Otherwise returns a `drop` / `rewrite` / `unsupported`
 *  plan. State `s` is treated as snapshot-at-start-of-op; we don't
 *  update Tm here (the surrounding loop doesn't need post-show Tm
 *  for redaction planning). */
function processShowOp(
  opIndex: number,
  s: PdfTextState,
  getMetrics: (name: string) => FontMetrics | null,
  redactions: Rect[],
  segments: TextShowSegment[] | null,
): OpStripPlan | null {
  if (!s.fontName || s.fontSize <= 0) return { kind: "unsupported", opIndex };
  const metrics = getMetrics(s.fontName);
  if (!metrics) return { kind: "unsupported", opIndex };
  if (!segments) return { kind: "unsupported", opIndex };

  // Walk every glyph; track text-space x; AABB-test against each
  // redaction rect.
  type Marked =
    | { kind: "string"; glyphs: Array<{ bytes: Uint8Array; redacted: boolean; advance: number }> }
    | { kind: "spacer"; value: number };
  const marked: Marked[] = [];
  let tx = 0; // text-space x accumulator
  let anyRedacted = false;
  let anyKept = false;

  for (const seg of segments) {
    if (seg.kind === "spacer") {
      // TJ spacer: tx -= n/1000 * fontSize * Th
      tx -= (seg.value / 1000) * s.fontSize * s.Th;
      marked.push({ kind: "spacer", value: seg.value });
      continue;
    }
    const glyphs = decodeGlyphs(seg.bytes, metrics);
    const segMarked: Array<{ bytes: Uint8Array; redacted: boolean; advance: number }> = [];
    for (const g of glyphs) {
      // Glyph horizontal advance in text-space: (w/1000) * Tfs * Th.
      // Char + word spacing apply AFTER the glyph advance, scaled by Th.
      const glyphAdvanceTextSpace = (g.widthFontUnits / 1000) * s.fontSize * s.Th;
      const isSpaceChar = metrics.twAppliesToSpace && g.bytes.length === 1 && g.bytes[0] === 0x20;
      const spacingTextSpace = (s.Tc + (isSpaceChar ? s.Tw : 0)) * s.Th;

      const bbox = bboxFromTextSpaceRect(s.tm, tx, tx + glyphAdvanceTextSpace, s.fontSize);
      let redacted = false;
      for (const r of redactions) {
        if (rectsOverlap(bbox, r)) {
          redacted = true;
          break;
        }
      }
      segMarked.push({
        bytes: g.bytes,
        redacted,
        advance: glyphAdvanceTextSpace + spacingTextSpace,
      });
      if (redacted) anyRedacted = true;
      else anyKept = true;
      tx += glyphAdvanceTextSpace + spacingTextSpace;
    }
    marked.push({ kind: "string", glyphs: segMarked });
  }

  if (!anyRedacted) return null; // op fully kept
  if (!anyKept) return { kind: "drop", opIndex }; // every glyph hit

  // Build a TJ that emits the kept glyphs and inserts compensation
  // spacers for every contiguous redacted span. The spacer value is
  // in 1/1000 of font size; we want to advance text by `gap` text-
  // space units, which corresponds to a TJ number of -gap/Tfs * 1000
  // (the negation because TJ spec subtracts the number from tx).
  const arrayItems: ContentToken[] = [];
  let pendingBytes: number[] = [];
  let pendingGap = 0; // accumulated text-space units of redacted glyph + spacer pairs awaiting flush

  const flushString = () => {
    if (pendingBytes.length === 0) return;
    arrayItems.push({ kind: "hex-string", bytes: new Uint8Array(pendingBytes) });
    pendingBytes = [];
  };
  const flushGap = () => {
    if (pendingGap === 0) return;
    // -tx*1000/Tfs in TJ units; rounded for compactness, sign flipped
    // because TJ subtracts.
    const tjUnits = -(pendingGap / s.fontSize) * 1000;
    arrayItems.push({ kind: "number", value: tjUnits, raw: tjUnits.toFixed(3) });
    pendingGap = 0;
  };

  for (const m of marked) {
    if (m.kind === "spacer") {
      // Existing TJ spacer: emit AFTER any pending kept-glyph string,
      // before any pending compensation. If we're mid-redacted-run,
      // fold its translation into the gap (it would otherwise shift
      // the kept glyphs off-position).
      flushString();
      // Spacer translates text by -value/1000 * Tfs * Th in text space.
      const spacerTextSpace = -(m.value / 1000) * s.fontSize * s.Th;
      pendingGap += spacerTextSpace;
      continue;
    }
    for (const g of m.glyphs) {
      if (g.redacted) {
        flushString();
        pendingGap += g.advance;
      } else {
        flushGap();
        for (const b of g.bytes) pendingBytes.push(b);
      }
    }
  }
  flushString();
  flushGap();

  const replacement: ContentOp = {
    op: "TJ",
    operands: [{ kind: "array", items: arrayItems }],
  };
  return { kind: "rewrite", opIndex, replacement };
}
