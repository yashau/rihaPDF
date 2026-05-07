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
import { parseContentStream, findTextShows, type ContentOp } from "./contentStream";
import { getPageContentBytes } from "./pageContent";
import { readFontMetrics, type FontMetrics } from "./redactGlyphs";

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

type SpanState = {
  tm: [number, number, number, number, number, number];
  tlm: [number, number, number, number, number, number];
  fontName: string | null;
  fontSize: number;
  Tc: number;
  Tw: number;
  Th: number;
  TL: number;
};

function freshSpanState(): SpanState {
  return {
    tm: [1, 0, 0, 1, 0, 0],
    tlm: [1, 0, 0, 1, 0, 0],
    fontName: null,
    fontSize: 0,
    Tc: 0,
    Tw: 0,
    Th: 1,
    TL: 0,
  };
}

function cloneSpanState(s: SpanState): SpanState {
  return {
    tm: [...s.tm] as SpanState["tm"],
    tlm: [...s.tlm] as SpanState["tlm"],
    fontName: s.fontName,
    fontSize: s.fontSize,
    Tc: s.Tc,
    Tw: s.Tw,
    Th: s.Th,
    TL: s.TL,
  };
}

function applySpanTd(s: SpanState, tx: number, ty: number): void {
  const [a, b, c, d, e, f] = s.tlm;
  s.tlm = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
  s.tm = [...s.tlm];
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
  let s = freshSpanState();
  const stack: SpanState[] = [];

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    switch (o.op) {
      case "q":
        stack.push(cloneSpanState(s));
        break;
      case "Q": {
        const popped = stack.pop();
        if (popped) s = popped;
        break;
      }
      case "BT":
        s.tm = [1, 0, 0, 1, 0, 0];
        s.tlm = [1, 0, 0, 1, 0, 0];
        break;
      case "Tf": {
        const [name, size] = o.operands;
        if (name?.kind === "name") s.fontName = name.value;
        if (size?.kind === "number") s.fontSize = size.value;
        break;
      }
      case "Tc":
        if (o.operands[0]?.kind === "number") s.Tc = o.operands[0].value;
        break;
      case "Tw":
        if (o.operands[0]?.kind === "number") s.Tw = o.operands[0].value;
        break;
      case "Tz":
        if (o.operands[0]?.kind === "number") s.Th = o.operands[0].value / 100;
        break;
      case "TL":
        if (o.operands[0]?.kind === "number") s.TL = o.operands[0].value;
        break;
      case "Tm":
        if (o.operands.length === 6 && o.operands.every((x) => x.kind === "number")) {
          s.tm = o.operands.map((x) => (x as { value: number }).value) as SpanState["tm"];
          s.tlm = [...s.tm];
        }
        break;
      case "Td":
      case "TD":
        if (
          o.operands.length === 2 &&
          o.operands[0].kind === "number" &&
          o.operands[1].kind === "number"
        ) {
          const tx = o.operands[0].value;
          const ty = o.operands[1].value;
          if (o.op === "TD") s.TL = -ty;
          applySpanTd(s, tx, ty);
        }
        break;
      case "T*":
        applySpanTd(s, 0, -s.TL);
        break;
      case "'":
      case '"':
      case "Tj":
      case "TJ": {
        let stringOperandIndex = 0;
        if (o.op === "'") {
          applySpanTd(s, 0, -s.TL);
        } else if (o.op === '"') {
          if (o.operands[0]?.kind === "number") s.Tw = o.operands[0].value;
          if (o.operands[1]?.kind === "number") s.Tc = o.operands[1].value;
          applySpanTd(s, 0, -s.TL);
          stringOperandIndex = 2;
        }
        const spans = processShowSpans(o, s, metricsByFont, stringOperandIndex);
        if (spans) out.set(i, spans);
        break;
      }
    }
  }
  return out;
}

function processShowSpans(
  op: ContentOp,
  s: SpanState,
  metricsByFont: Map<string, FontMetrics | null>,
  stringOperandIndex: number,
): FontShowGlyphSpan[] | null {
  if (!s.fontName || s.fontSize <= 0) return null;
  const metrics = metricsByFont.get(s.fontName);
  if (!metrics) return null;

  type Seg = { kind: "string"; bytes: Uint8Array } | { kind: "spacer"; value: number };
  const segments: Seg[] = [];
  if (op.op === "TJ") {
    const arr = op.operands[0];
    if (arr?.kind !== "array") return null;
    for (const item of arr.items) {
      if (item.kind === "literal-string" || item.kind === "hex-string") {
        segments.push({ kind: "string", bytes: item.bytes });
      } else if (item.kind === "number") {
        segments.push({ kind: "spacer", value: item.value });
      } else {
        return null;
      }
    }
  } else {
    const str = op.operands[stringOperandIndex];
    if (!str || (str.kind !== "literal-string" && str.kind !== "hex-string")) return null;
    segments.push({ kind: "string", bytes: str.bytes });
  }

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
