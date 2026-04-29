// Extract font information from the source PDF that pdf.js doesn't expose
// reliably. We walk the page's content stream looking for `Tf` operators
// (set font name + size), pair each subsequent `Tj/TJ` text-show with the
// active font, and resolve `/F1` style resource names to the actual
// BaseFont string by reading the page's Resources Font dict.
//
// The result is a list of "font shows" — one entry per text-show op —
// that the run-builder uses to attach a fontFamily / bold / italic to
// each TextRun.

import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFArray,
  PDFRef,
} from "pdf-lib";
import {
  parseContentStream,
  findTextShows,
} from "./contentStream";
import { getPageContentBytes } from "./pageContent";

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
};

/**
 * Build a FontShow[] for every page in the document. Index of the array
 * matches PDF page index (0-based).
 */
export async function extractPageFontShows(
  pdfBytes: ArrayBuffer,
): Promise<FontShow[][]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const result: FontShow[][] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageDict = page.node;
    const fontDict = resolveFontDict(pageDict, doc);
    const fontInfoByResource = new Map<
      string,
      { baseFont: string | null; bold: boolean; italic: boolean }
    >();
    if (fontDict) {
      for (const [name] of fontDict.entries()) {
        const fontEntryRaw = fontDict.lookup(name);
        if (!(fontEntryRaw instanceof PDFDict)) continue;
        const fontEntry = fontEntryRaw;
        const baseFontObj = fontEntry.lookup(PDFName.of("BaseFont"));
        const baseFont = baseFontObj
          ? String(baseFontObj).replace(/^\//, "")
          : null;
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
        });
      }
    }

    const bytes = getPageContentBytes(doc.context, pageDict);
    const ops = parseContentStream(bytes);
    const shows = findTextShows(ops);
    const fontShows: FontShow[] = shows.map((s) => {
      // s.fontName is the resource key the Tf operator referenced
      // (without leading slash); look it up in our map.
      const info = s.fontName ? fontInfoByResource.get(s.fontName) : null;
      // Office often draws "bold" as Tr 2 (fill + stroke) rather than a
      // separate Bold-variant font. Treat that as bold so we can replicate
      // it on the rerender path.
      const trBold = s.textRenderingMode === 2;
      return {
        x: s.textMatrix[4],
        y: s.textMatrix[5],
        baseFont: info?.baseFont ?? null,
        bold: (info?.bold ?? false) || trBold,
        italic: info?.italic ?? false,
      };
    });
    result.push(fontShows);
  }
  return result;
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
