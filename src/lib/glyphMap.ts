// Per-font CID → Unicode map.
//
// pdf.js extracts text from a PDF's content stream by looking up each
// glyph CID in the font's `/ToUnicode` CMap (if present) or its
// /Encoding. For the Maldivian Office-exported PDFs we target, the
// `/ToUnicode` CMap is *almost* correct — but Word's PDF exporter has
// a known bug where adjacent fili glyphs mapped via `bfrange` get one
// entry written as a literal `<0020>` (space) instead of the expected
// fili codepoint. Concretely you'll see things like:
//
//     <006D> <006E> [<07A6> <0020>]    ← cid 0x6E → space (should be 0x07A7)
//     <006F> <0077> <07A8>             ← cid 0x6F..0x77 → 0x07A8..0x07B0
//
// pdf.js dutifully extracts that broken entry as U+0020, dropping the
// long-vowel `aabaafili` from the rendered text.
//
// Strategy:
//   1. Parse the PDF's `/ToUnicode` CMap directly (it's the authoritative
//      mapping for text extraction).
//   2. Detect the "fili gap" pattern — a CID mapped to U+0020 whose
//      immediate neighbours map to consecutive Thaana fili codepoints —
//      and patch the gap to the missing fili.
//   3. If the font has no `/ToUnicode` (rare in Office PDFs but happens
//      e.g. for purely-glyph-name encoded fonts), fall back to the
//      font's binary cmap via fontkit, plus a glyph-name lookup.
//
// The result is the SAME shape as before — `Map<cid, codePoint>` — so
// the extraction-side code in `pdf.ts` doesn't change.

import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";

export type GlyphMap = {
  /** `cid` → first Unicode codepoint that maps to it. For Identity-H
   *  Type 0 fonts CID == GID, but for other encodings it's the byte
   *  value(s) seen in the content-stream Tj operand. */
  toUnicode: Map<number, number>;
  /** Encoding hint pulled from the PDF font dict — "Identity-H" / "Identity-V"
   *  / "WinAnsiEncoding" / etc. We treat anything starting with "Identity"
   *  as 2-byte CID; everything else as 1-byte. */
  encoding: string;
};

/** Resolve the dict that holds the actual TrueType binary stream for a
 *  PDF font. For Type 0 (composite) fonts the FontDescriptor lives one
 *  level deeper, on the descendant font. */
function fontDescriptorOf(fontDict: PDFDict, doc: PDFDocument): PDFDict | null {
  const subtype = String(fontDict.lookup(PDFName.of("Subtype")) ?? "");
  if (subtype === "/Type0") {
    const desc = fontDict.lookup(PDFName.of("DescendantFonts"));
    const arr = desc && "asArray" in desc ? (desc as { asArray(): unknown[] }).asArray() : null;
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

function fontFileBytesOf(descriptor: PDFDict): Uint8Array | null {
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

/** Parse a PDF `/ToUnicode` CMap stream into a CID → codepoint map.
 *  Handles `bfchar` (single mappings) and `bfrange` (ranged mappings,
 *  both incrementing-destination and array-of-destinations forms). */
function parseToUnicodeCMap(text: string): Map<number, number> {
  const out = new Map<number, number>();

  // bfchar: list of <SRC> <DST> pairs.
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const body = m[1];
    for (const t of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const cid = parseInt(t[1], 16);
      const cp = firstCodePointFromHex(t[2]);
      if (cp != null) out.set(cid, cp);
    }
  }

  // bfrange: <LO> <HI> <DST>  OR  <LO> <HI> [ <a> <b> … ]
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = m[1];
    // Tokenise — the two range forms are intermixed. We walk the body
    // looking for `<lo> <hi>` then either another `<dst>` or `[ … ]`.
    const tokenRe = /<([0-9a-fA-F]+)>|\[([\s\S]*?)\]/g;
    const tokens: Array<{ kind: "hex"; v: string } | { kind: "arr"; v: string }> = [];
    for (const t of body.matchAll(tokenRe)) {
      if (t[1] !== undefined) tokens.push({ kind: "hex", v: t[1] });
      else if (t[2] !== undefined) tokens.push({ kind: "arr", v: t[2] });
    }
    for (let i = 0; i + 2 < tokens.length; ) {
      const a = tokens[i];
      const b = tokens[i + 1];
      const c = tokens[i + 2];
      if (a.kind !== "hex" || b.kind !== "hex") {
        i++;
        continue;
      }
      const lo = parseInt(a.v, 16);
      const hi = parseInt(b.v, 16);
      if (c.kind === "hex") {
        const start = parseInt(c.v, 16);
        for (let cid = lo, n = 0; cid <= hi; cid++, n++) {
          out.set(cid, start + n);
        }
        i += 3;
      } else {
        // Array form: each entry can itself be multi-codepoint, but for
        // text extraction the first codepoint is what counts.
        const inner = [...c.v.matchAll(/<([0-9a-fA-F]+)>/g)];
        for (let n = 0; n < inner.length; n++) {
          const cp = firstCodePointFromHex(inner[n][1]);
          if (cp != null) out.set(lo + n, cp);
        }
        i += 3;
      }
    }
  }

  return out;
}

/** Hex strings in CMap dst slots are UTF-16BE. Decode the first codepoint
 *  (we discard combined sequences — for our use case we only need the
 *  base char to recognise as fili / Thaana). */
function firstCodePointFromHex(hex: string): number | null {
  if (hex.length === 0) return null;
  if (hex.length === 2) return parseInt(hex, 16);
  // 4-byte UTF-16BE unit (with possible surrogate continuation we ignore).
  if (hex.length >= 4) {
    const u = parseInt(hex.slice(0, 4), 16);
    if (u >= 0xd800 && u <= 0xdbff && hex.length >= 8) {
      const low = parseInt(hex.slice(4, 8), 16);
      return 0x10000 + ((u - 0xd800) << 10) + (low - 0xdc00);
    }
    return u;
  }
  return parseInt(hex, 16);
}

/** Detect Word's "fili gap" CMap bug: a CID mapped to U+0020 whose
 *  immediate neighbour CIDs map to consecutive Thaana fili codepoints.
 *  In the Office output we've seen, only a single CID inside an otherwise
 *  contiguous fili block gets corrupted (always aabaafili U+07A7 — the
 *  one mapped via a 2-element bfrange array `[<07A6> <0020>]`). The
 *  surrounding CIDs in the same content stream are still mapped correctly
 *  by the next `bfrange`, so we can derive the missing codepoint by
 *  interpolating: prev_cp + (cid - prev_cid). */
function patchBrokenFiliMappings(map: Map<number, number>): void {
  const inThaana = (c: number | undefined): boolean =>
    c != null && c !== 0x20 && c >= 0x0780 && c <= 0x07b1;
  // Snapshot keys — we mutate during iteration.
  const cids = Array.from(map.keys()).sort((a, b) => a - b);
  for (const cid of cids) {
    if (map.get(cid) !== 0x20) continue;
    const prev = map.get(cid - 1);
    const next = map.get(cid + 1);
    if (!inThaana(prev) || !inThaana(next)) continue;
    // Sequential pattern: prev_cp + 2 === next_cp implies the gap is
    // exactly prev_cp + 1.
    if ((next as number) - (prev as number) !== 2) continue;
    map.set(cid, (prev as number) + 1);
  }
}

// Map of Adobe / Maldivian glyph names → Unicode codepoints. Last-resort
// lookup when a font has neither `/ToUnicode` nor a useful binary cmap
// (rare — Office output always ships ToUnicode for the fonts that need
// it).
const GLYPH_NAME_TO_UNICODE: Record<string, number> = {
  abafili: 0x07a6,
  aabaafili: 0x07a7,
  ibifili: 0x07a8,
  eebeefili: 0x07a9,
  ubufili: 0x07aa,
  oobofili: 0x07ab,
  ebefili: 0x07ac,
  eybeyfili: 0x07ad,
  obofili: 0x07ae,
  oaboafili: 0x07af,
  sukun: 0x07b0,
  thaana_abafili: 0x07a6,
  thaana_aabaafili: 0x07a7,
  thaana_ibifili: 0x07a8,
  thaana_eebeefili: 0x07a9,
  thaana_ubufili: 0x07aa,
  thaana_oobofili: 0x07ab,
  thaana_ebefili: 0x07ac,
  thaana_eybeyfili: 0x07ad,
  thaana_obofili: 0x07ae,
  thaana_oaboafili: 0x07af,
  thaana_sukun: 0x07b0,
};

/** Build a CID → Unicode map from the font's binary cmap (fallback when
 *  the PDF has no `/ToUnicode`). */
function buildFontBinaryCmap(fontBytes: Uint8Array): Map<number, number> {
  const reverse = new Map<number, number>();
  try {
    const f = (
      fontkit as unknown as {
        create(b: Uint8Array): {
          characterSet?: number[];
          numGlyphs?: number;
          glyphForCodePoint?(cp: number): { id: number };
          getGlyph?(id: number): { id: number; name?: string };
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
        /* unmappable codepoint */
      }
      if (glyphId == null || glyphId === 0) continue;
      if (!reverse.has(glyphId)) reverse.set(glyphId, cp);
    }
    if (typeof f.getGlyph === "function" && typeof f.numGlyphs === "number") {
      for (let id = 1; id < f.numGlyphs; id++) {
        if (reverse.has(id)) continue;
        try {
          const g = f.getGlyph(id);
          const name = (g?.name ?? "").toLowerCase();
          if (!name) continue;
          const cp = GLYPH_NAME_TO_UNICODE[name];
          if (cp != null) reverse.set(id, cp);
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* not a TTF fontkit can parse */
  }
  return reverse;
}

/** Build the CID → Unicode map for one PDF font. Prefers the PDF's
 *  `/ToUnicode` CMap (with fili-gap patching), falls back to the
 *  embedded font's binary cmap. */
function buildCidToUnicode(fontDict: PDFDict, doc: PDFDocument): Map<number, number> {
  const tu = fontDict.lookup(PDFName.of("ToUnicode"));
  if (tu instanceof PDFRawStream) {
    const text = new TextDecoder("latin1").decode(decodePDFRawStream(tu).decode());
    const map = parseToUnicodeCMap(text);
    if (map.size > 0) {
      patchBrokenFiliMappings(map);
      return map;
    }
  }
  // No usable ToUnicode — fall back to font binary cmap.
  const desc = fontDescriptorOf(fontDict, doc);
  if (!desc) return new Map();
  const bytes = fontFileBytesOf(desc);
  if (!bytes) return new Map();
  return buildFontBinaryCmap(bytes);
}

/**
 * Extract a per-page CID → Unicode map keyed by the page's font resource
 * name (the `/F<n>` you see in `Tf` operators).
 */
export function extractPageGlyphMaps(doc: PDFDocument, pageIndex: number): Map<string, GlyphMap> {
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
    const toUnicode = buildCidToUnicode(fontEntryRaw, doc);
    if (toUnicode.size === 0) continue;
    result.set(name.toString().replace(/^\//, ""), {
      toUnicode,
      encoding: encodingOf(fontEntryRaw),
    });
  }
  return result;
}

/** Decode a Tj operand's bytes into Unicode using the font's CID → Unicode
 *  map. Bytes is the raw operand bytes (after un-escaping for literal
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
