// Dev-only diagnostic: dumps each embedded font's first N glyph IDs along
// with their PostScript name + cmap codepoints, so we can see whether
// long-fili glyphs are reachable via the post table when the cmap is
// stripped. Imported from a Playwright probe via a Vite virtual import.

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";

export type GlyphDumpEntry = {
  resource: string;
  baseFont: string;
  numGlyphs?: number;
  cmapSize?: number;
  cmapHasFili?: number[];
  glyphSample?: Array<{
    id: number;
    name: string | null;
    codePoints: number[] | null;
    error?: string;
  }>;
  cid3?: { id?: number; name?: string | null; codePoints?: number[] | null; error?: string };
  error?: string;
};

export async function dumpGlyphs(pdfBytes: ArrayBuffer): Promise<GlyphDumpEntry[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out: GlyphDumpEntry[] = [];
  const page = doc.getPages()[0];
  let node: PDFDict | null = page.node;
  let fontDict: PDFDict | null = null;
  while (node && !fontDict) {
    const r = node.lookup(PDFName.of("Resources"));
    if (r instanceof PDFDict) {
      const f = r.lookup(PDFName.of("Font"));
      if (f instanceof PDFDict) fontDict = f;
    }
    if (fontDict) break;
    const p: unknown = node.lookup(PDFName.of("Parent"));
    if (p instanceof PDFDict) node = p;
    else if (p instanceof PDFRef) {
      const r2 = doc.context.lookup(p);
      node = r2 instanceof PDFDict ? r2 : null;
    } else node = null;
  }
  if (!fontDict) return out;

  for (const [name] of fontDict.entries()) {
    const fd = fontDict.lookup(name);
    if (!(fd instanceof PDFDict)) continue;
    const subtype = String(fd.lookup(PDFName.of("Subtype")) ?? "");
    const baseFont = String(fd.lookup(PDFName.of("BaseFont")) ?? "");
    let descriptor: PDFDict | null = null;
    if (subtype === "/Type0") {
      const desc = fd.lookup(PDFName.of("DescendantFonts"));
      const arr =
        desc && "asArray" in desc
          ? (desc as { asArray(): unknown[] }).asArray()
          : null;
      const first = arr?.[0];
      let descendant: PDFDict | null = null;
      if (first instanceof PDFRef) {
        const r = doc.context.lookup(first);
        if (r instanceof PDFDict) descendant = r;
      } else if (first instanceof PDFDict) descendant = first;
      if (descendant) {
        const d = descendant.lookup(PDFName.of("FontDescriptor"));
        if (d instanceof PDFDict) descriptor = d;
      }
    } else {
      const d = fd.lookup(PDFName.of("FontDescriptor"));
      if (d instanceof PDFDict) descriptor = d;
    }
    if (!descriptor) {
      out.push({ resource: name.toString(), baseFont, error: "no descriptor" });
      continue;
    }
    const file =
      descriptor.lookup(PDFName.of("FontFile2")) ??
      descriptor.lookup(PDFName.of("FontFile3")) ??
      descriptor.lookup(PDFName.of("FontFile"));
    if (!(file instanceof PDFRawStream)) {
      out.push({ resource: name.toString(), baseFont, error: "no fontfile" });
      continue;
    }
    const bytes = decodePDFRawStream(file).decode();
    let fk: {
      numGlyphs: number;
      characterSet?: number[];
      glyphForCodePoint?(cp: number): { id: number };
      getGlyph?(id: number): { id: number; name?: string; codePoints?: number[] };
    };
    try {
      fk = (fontkit as unknown as { create(b: Uint8Array): typeof fk }).create(
        bytes,
      );
    } catch (e) {
      out.push({
        resource: name.toString(),
        baseFont,
        error: "fontkit.create failed: " + (e as Error).message,
      });
      continue;
    }
    const charSet = fk.characterSet ?? [];
    const numGlyphs = fk.numGlyphs;
    const sample: GlyphDumpEntry["glyphSample"] = [];
    for (let id = 0; id < Math.min(numGlyphs, 30); id++) {
      try {
        const g = fk.getGlyph?.(id);
        sample.push({
          id,
          name: g?.name ?? null,
          codePoints: g?.codePoints ?? null,
        });
      } catch (e) {
        sample.push({
          id,
          name: null,
          codePoints: null,
          error: String((e as Error).message ?? e).slice(0, 80),
        });
      }
    }
    let cid3: GlyphDumpEntry["cid3"] = {};
    try {
      const g = fk.getGlyph?.(3);
      cid3 = { id: g?.id, name: g?.name ?? null, codePoints: g?.codePoints ?? null };
    } catch (e) {
      cid3 = { error: String((e as Error).message ?? e) };
    }
    out.push({
      resource: name.toString(),
      baseFont,
      numGlyphs,
      cmapSize: charSet.length,
      cmapHasFili: [0x07a6, 0x07a7, 0x07a8, 0x07a9, 0x07aa, 0x07ab, 0x07ac, 0x07ad, 0x07ae, 0x07af, 0x07b0]
        .filter((cp) => charSet.includes(cp)),
      glyphSample: sample,
      cid3,
    });
  }
  return out;
}
