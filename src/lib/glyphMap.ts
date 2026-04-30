// Per-font reverse cmap: glyph ID → Unicode codepoint.
//
// pdf.js uses the PDF's `ToUnicode` CMap to extract characters from a
// text-show. Plenty of Office-exported PDFs (the Maldivian gov't ones we
// target) ship a ToUnicode that omits some entries — most painfully the
// long-vowel Thaana fili (aabaafili U+07A7 etc.). The font's binary
// (FontFile2) still contains a real `cmap` table with full Unicode →
// glyph mappings, so we can recover the missing characters by reversing
// that table and looking up the glyph ID we see in the content stream.
//
// Identity-H is by far the most common encoding for Type 0 fonts in
// Office output: the bytes in a Tj operand are 2-byte big-endian glyph
// IDs (CID == GID). For other encodings we fall back to single-byte
// CIDs and hope the reverse map covers them; a general decoder would
// also need to honour the font's Encoding.Differences table.

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";

export type GlyphMap = {
  /** `glyphId` → first Unicode codepoint that maps to it (lowest one wins
   *  when multiple codepoints share a glyph). */
  toUnicode: Map<number, number>;
  /** Encoding hint pulled from the PDF font dict — "Identity-H" / "Identity-V"
   *  / "WinAnsiEncoding" / etc. We treat anything starting with "Identity"
   *  as 2-byte CID; everything else as 1-byte. */
  encoding: string;
};

/** Resolve the dict that holds the actual TrueType binary stream for a
 *  PDF font. For Type 0 (composite) fonts the FontDescriptor lives one
 *  level deeper, on the descendant font. */
function fontDescriptorOf(
  fontDict: PDFDict,
  doc: PDFDocument,
): PDFDict | null {
  const subtype = String(fontDict.lookup(PDFName.of("Subtype")) ?? "");
  if (subtype === "/Type0") {
    const desc = fontDict.lookup(PDFName.of("DescendantFonts"));
    const arr =
      desc && "asArray" in desc
        ? (desc as { asArray(): unknown[] }).asArray()
        : null;
    const first = arr?.[0];
    let descendant: PDFDict | null = null;
    if (first instanceof PDFRef) {
      const r = doc.context.lookup(first);
      if (r instanceof PDFDict) descendant = r;
    } else if (first instanceof PDFDict) {
      descendant = first;
    }
    if (!descendant) return null;
    const d = descendant.lookup(PDFName.of("FontDescriptor"));
    return d instanceof PDFDict ? d : null;
  }
  const d = fontDict.lookup(PDFName.of("FontDescriptor"));
  return d instanceof PDFDict ? d : null;
}

function fontFileBytesOf(
  descriptor: PDFDict,
): Uint8Array | null {
  // FontFile2 = TrueType, FontFile3 = OpenType/CFF, FontFile = Type1.
  const file =
    descriptor.lookup(PDFName.of("FontFile2")) ??
    descriptor.lookup(PDFName.of("FontFile3")) ??
    descriptor.lookup(PDFName.of("FontFile"));
  if (!(file instanceof PDFRawStream)) return null;
  return decodePDFRawStream(file).decode();
}

function encodingOf(fontDict: PDFDict): string {
  const enc = fontDict.lookup(PDFName.of("Encoding"));
  if (!enc) return "WinAnsiEncoding";
  // Encoding can be a name OR a dict with BaseEncoding + Differences.
  const s = String(enc);
  if (s.startsWith("/")) return s.slice(1);
  return s;
}

/** Build a reverse cmap for a single font dict. Fontkit's
 *  `characterSet` gives every Unicode the font's `cmap` table claims to
 *  render; we map each → its glyph and invert. */
function buildReverseCmap(fontBytes: Uint8Array): Map<number, number> {
  const reverse = new Map<number, number>();
  try {
    const f = (
      fontkit as unknown as {
        create(b: Uint8Array): {
          characterSet?: number[];
          glyphForCodePoint?(cp: number): { id: number };
        };
      }
    ).create(fontBytes);
    const cs = f.characterSet ?? [];
    for (const cp of cs) {
      let glyphId: number | null = null;
      try {
        const g = f.glyphForCodePoint?.(cp);
        if (g && typeof g.id === "number") glyphId = g.id;
      } catch {
        /* unmappable codepoint — skip */
      }
      if (glyphId == null || glyphId === 0) continue;
      // First write wins so basic Latin codepoints don't get clobbered
      // by ligature / variant codepoints sharing the same glyph.
      if (!reverse.has(glyphId)) reverse.set(glyphId, cp);
    }
  } catch {
    /* font isn't a TTF fontkit understands — return an empty map */
  }
  return reverse;
}

/**
 * Extract a per-page reverse cmap keyed by the page's font resource name
 * (the `/F<n>` you see in `Tf` operators).
 */
export function extractPageGlyphMaps(
  doc: PDFDocument,
  pageIndex: number,
): Map<string, GlyphMap> {
  const result = new Map<string, GlyphMap>();
  const page = doc.getPages()[pageIndex];
  if (!page) return result;
  // Walk the page tree for inherited Resources (some PDFs only set
  // Resources on the catalog or a parent Pages dict).
  let node: PDFDict | null = page.node;
  let fontDict: PDFDict | null = null;
  while (node && !fontDict) {
    const resourcesRaw = node.lookup(PDFName.of("Resources"));
    if (resourcesRaw instanceof PDFDict) {
      const fontsRaw = resourcesRaw.lookup(PDFName.of("Font"));
      if (fontsRaw instanceof PDFDict) fontDict = fontsRaw;
    }
    if (fontDict) break;
    const parent: unknown = node.lookup(PDFName.of("Parent"));
    if (parent instanceof PDFDict) node = parent;
    else if (parent instanceof PDFRef) {
      const r = doc.context.lookup(parent);
      node = r instanceof PDFDict ? r : null;
    } else node = null;
  }
  if (!fontDict) return result;
  for (const [name] of fontDict.entries()) {
    const fontEntryRaw = fontDict.lookup(name);
    if (!(fontEntryRaw instanceof PDFDict)) continue;
    const desc = fontDescriptorOf(fontEntryRaw, doc);
    if (!desc) continue;
    const bytes = fontFileBytesOf(desc);
    if (!bytes) continue;
    const toUnicode = buildReverseCmap(bytes);
    if (toUnicode.size === 0) continue;
    result.set(name.toString().replace(/^\//, ""), {
      toUnicode,
      encoding: encodingOf(fontEntryRaw),
    });
  }
  return result;
}

/** Decode a Tj operand's bytes into Unicode using the font's reverse
 *  cmap. Bytes is the raw operand bytes (after un-escaping for literal
 *  strings, or hex-decoded for `< ... >`). For Identity-H we read 2-byte
 *  big-endian CIDs; otherwise 1-byte. */
export function decodeShowBytes(bytes: Uint8Array, map: GlyphMap): string {
  const isIdentity = map.encoding.startsWith("Identity");
  let out = "";
  if (isIdentity) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const cid = (bytes[i] << 8) | bytes[i + 1];
      const cp = map.toUnicode.get(cid);
      if (cp != null) out += String.fromCodePoint(cp);
    }
  } else {
    for (let i = 0; i < bytes.length; i++) {
      const cid = bytes[i];
      const cp = map.toUnicode.get(cid);
      if (cp != null) out += String.fromCodePoint(cp);
    }
  }
  return out;
}
