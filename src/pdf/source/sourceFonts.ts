// Extract font information from the source PDF that pdf.js doesn't expose
// reliably. We walk the page's content stream looking for `Tf` operators
// (set font name + size), pair each subsequent `Tj/TJ` text-show with the
// active font, and resolve `/F1` style resource names to the actual
// BaseFont string by reading the page's Resources Font dict.
//
// The result is a list of "font shows" — one entry per text-show op —
// that the run-builder uses to attach a fontFamily / bold / italic to
// each TextRun.

import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef } from "pdf-lib";
import { parseContentStream, findTextShows, type ContentOp } from "@/pdf/content/contentStream";
import { getPageContentBytes } from "@/pdf/content/pageContent";
import {
  walkTextShows,
  type PdfTextState,
  type TextShowSegment,
} from "@/pdf/content/pdfTextWalker";
import { readFontMetrics, type FontMetrics } from "@/lib/redactGlyphs";

export type FontShowGlyphSpan = {
  gid: number;
  /** Glyph edge positions in PDF user space. */
  x0: number;
  x1: number;
};

export type FontShow = {
  /** Baseline x in PDF user space (= text matrix m[4]). */
  x: number;
  /** Baseline y in PDF user space (= text matrix m[5]). */
  y: number;
  /** Resolved BaseFont string, e.g. "ABCDEF+Faruma" or "Helvetica". */
  baseFont: string | null;
  /** Best-effort flags from the FontDescriptor.Flags or the BaseFont name. */
  bold: boolean;
  italic: boolean;
  /** PDF resource name (`F1`, `F2`, …) — keyed for cross-referencing
   *  with the per-page glyph reverse cmap from glyphMap.ts. */
  fontResource: string | null;
  /** Raw operand bytes from the Tj/TJ operator. For Tj this is the
   *  full literal/hex string. For TJ we collapse all string operands
   *  into one buffer (the numeric kerning adjustments are dropped —
   *  they don't change which glyphs are drawn). Decoded via the font's
   *  reverse cmap when pdf.js fails to extract a character. */
  bytes: Uint8Array;
  /** Per-glyph source positions computed from the PDF font widths and
   *  TJ spacers. Used for exact caret hit-testing in source text runs. */
  glyphSpans?: FontShowGlyphSpan[];
  /** Index of the Tj/TJ op in the parsed content-stream ops array.
   *  Used by preview.ts + save.ts to know exactly which ops to strip
   *  when the user edits or drags a run that this show contributed
   *  to — far more reliable than the old position-matching. */
  opIndex: number;
};

/**
 * Build a FontShow[] for every page in the document. Index of the array
 * matches PDF page index (0-based).
 */
export async function extractPageFontShows(pdfBytes: ArrayBuffer): Promise<FontShow[][]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const result: FontShow[][] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageDict = page.node;
    const fontDict = resolveFontDict(pageDict, doc);
    const fontInfoByResource = new Map<
      string,
      { baseFont: string | null; bold: boolean; italic: boolean; metrics: FontMetrics | null }
    >();
    if (fontDict) {
      for (const [name] of fontDict.entries()) {
        const fontEntryRaw = fontDict.lookup(name);
        if (!(fontEntryRaw instanceof PDFDict)) continue;
        const fontEntry = fontEntryRaw;
        const baseFontObj = fontEntry.lookup(PDFName.of("BaseFont"));
        const baseFont = baseFontObj ? String(baseFontObj).replace(/^\//, "") : null;
        let bold = false;
        let italic = false;
        const descriptorRaw = fontEntry.lookup(PDFName.of("FontDescriptor"));
        if (descriptorRaw instanceof PDFDict) {
          const descriptor = descriptorRaw;
          const flagsObj = descriptor.lookup(PDFName.of("Flags"));
          // FontDescriptor.Flags bit 7 (0x40) = Italic. Bold is encoded
          // via the FontWeight key (when present) and the BaseFont name
          // suffix; sniff both.
          if (flagsObj && "asNumber" in flagsObj) {
            const flags = (flagsObj as { asNumber(): number }).asNumber();
            if (flags & 0x40) italic = true; // Italic flag (bit 7)
            if (flags & 0x40000) bold = true; // ForceBold flag (bit 19)
          }
          const weightObj = descriptor.lookup(PDFName.of("FontWeight"));
          if (weightObj && "asNumber" in weightObj) {
            const w = (weightObj as { asNumber(): number }).asNumber();
            if (w >= 600) bold = true;
          }
        }
        if (baseFont) {
          const lower = baseFont.toLowerCase();
          if (/(^|[-_\s,])bold(\b|$)|black|heavy/.test(lower)) bold = true;
          if (/italic|oblique/.test(lower)) italic = true;
        }
        fontInfoByResource.set(name.toString().replace(/^\//, ""), {
          baseFont,
          bold,
          italic,
          metrics: readFontMetrics(fontEntry, doc.context),
        });
      }
    }

    const bytes = getPageContentBytes(doc.context, pageDict);
    const ops = parseContentStream(bytes);
    const shows = findTextShows(ops);
    const glyphSpansByOpIndex = glyphSpansForTextShows(
      ops,
      new Map(Array.from(fontInfoByResource, ([name, info]) => [name, info.metrics])),
    );
    const fontShows: FontShow[] = shows.map((s) => {
      const info = s.fontName ? fontInfoByResource.get(s.fontName) : null;
      const trBold = s.textRenderingMode === 2;
      // Pull the raw bytes out of the Tj/TJ operand. For Tj it's the
      // single string token; for TJ it's an array of strings interleaved
      // with kerning numbers — concatenate the string portions only.
      const operandBytes: number[] = [];
      const collect = (bytes: Uint8Array) => {
        for (const b of bytes) operandBytes.push(b);
      };
      for (const operand of s.op.operands) {
        if (operand.kind === "literal-string" || operand.kind === "hex-string") {
          collect(operand.bytes);
        } else if (operand.kind === "array") {
          for (const item of operand.items) {
            if (item.kind === "literal-string" || item.kind === "hex-string") {
              collect(item.bytes);
            }
          }
        }
      }
      return {
        x: s.textMatrix[4],
        y: s.textMatrix[5],
        baseFont: info?.baseFont ?? null,
        bold: (info?.bold ?? false) || trBold,
        italic: info?.italic ?? false,
        fontResource: s.fontName ?? null,
        bytes: new Uint8Array(operandBytes),
        glyphSpans: glyphSpansByOpIndex.get(s.index),
        opIndex: s.index,
      };
    });
    result.push(fontShows);
  }
  return result;
}

function decodeGlyphIds(bytes: Uint8Array, metrics: FontMetrics): number[] {
  const out: number[] = [];
  const bpg = metrics.bytesPerGlyph;
  const usable = bytes.length - (bytes.length % bpg);
  for (let i = 0; i < usable; i += bpg) {
    let gid = 0;
    for (let k = 0; k < bpg; k++) gid = (gid << 8) | bytes[i + k];
    out.push(gid);
  }
  return out;
}

function glyphSpansForTextShows(
  ops: ContentOp[],
  metricsByFont: Map<string, FontMetrics | null>,
): Map<number, FontShowGlyphSpan[]> {
  const out = new Map<number, FontShowGlyphSpan[]>();
  walkTextShows(ops, ({ opIndex, state, segments }) => {
    const spans = processShowSpans(state, metricsByFont, segments);
    if (spans) out.set(opIndex, spans);
  });
  return out;
}

function processShowSpans(
  s: PdfTextState,
  metricsByFont: Map<string, FontMetrics | null>,
  segments: TextShowSegment[] | null,
): FontShowGlyphSpan[] | null {
  if (!s.fontName || s.fontSize <= 0) return null;
  const metrics = metricsByFont.get(s.fontName);
  if (!metrics) return null;
  if (!segments) return null;

  const spans: FontShowGlyphSpan[] = [];
  let tx = 0;
  for (const seg of segments) {
    if (seg.kind === "spacer") {
      tx -= (seg.value / 1000) * s.fontSize * s.Th;
      continue;
    }
    for (const gid of decodeGlyphIds(seg.bytes, metrics)) {
      const widthFontUnits = metrics.widthByGid.get(gid) ?? metrics.defaultWidth;
      const glyphAdvanceTextSpace = (widthFontUnits / 1000) * s.fontSize * s.Th;
      const isSpaceChar = metrics.twAppliesToSpace && metrics.bytesPerGlyph === 1 && gid === 0x20;
      const spacingTextSpace = (s.Tc + (isSpaceChar ? s.Tw : 0)) * s.Th;
      const [a, , , , e] = s.tm;
      spans.push({
        gid,
        x0: a * tx + e,
        x1: a * (tx + glyphAdvanceTextSpace) + e,
      });
      tx += glyphAdvanceTextSpace + spacingTextSpace;
    }
  }
  return spans;
}

/** Resources / Font for the given page, resolved through the page tree
 *  so an inherited Resources entry on a parent Pages node also works. */
function resolveFontDict(pageNode: PDFDict, doc: PDFDocument): PDFDict | null {
  let node: PDFDict | null = pageNode;
  while (node) {
    const resourcesRaw = node.lookup(PDFName.of("Resources"));
    if (resourcesRaw instanceof PDFDict) {
      const fontsRaw = resourcesRaw.lookup(PDFName.of("Font"));
      if (fontsRaw instanceof PDFDict) return fontsRaw;
    }
    const parent: unknown = node.lookup(PDFName.of("Parent"));
    if (parent instanceof PDFDict) {
      node = parent;
    } else if (parent instanceof PDFRef) {
      const resolved = doc.context.lookup(parent);
      node = resolved instanceof PDFDict ? resolved : null;
    } else {
      node = null;
    }
  }
  return null;
}

// Suppress unused-import warning for PDFArray (kept for future use when
// Contents is an array of refs — pageContent already handles that, but
// we may want direct array access for nested resources).
void PDFArray;
