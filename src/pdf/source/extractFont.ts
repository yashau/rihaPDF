// Extract an embedded TrueType font from a PDFDocument so we can shape new
// text with the same font the source PDF uses. Walks Resources → Font →
// FontDescriptor → FontFile2 to find the binary stream.

import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";

/**
 * Walk all pages and return the first embedded TrueType font we find.
 * For the user's PDFs (Maldivian govt docs) this is reliably Faruma /
 * MV-Boli. Returns the font's full TTF binary plus the resource name
 * (e.g. "F1") it appears under in the source page's resources.
 */
export function extractFirstEmbeddedFont(doc: PDFDocument): {
  bytes: Uint8Array;
  /** PDF resource name in the *source* page (only used for diagnostics —
   *  the embedded copy in the *output* doc gets a fresh name from pdf-lib). */
  sourceName: string;
} | null {
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    if (!resources) continue;
    const fontDict = resources.lookup(PDFName.of("Font"), PDFDict);
    if (!fontDict) continue;
    for (const [name, ref] of fontDict.entries()) {
      const font = doc.context.lookup(ref, PDFDict);
      if (!font) continue;
      const subtype = font.get(PDFName.of("Subtype"));
      if (!subtype) continue;
      const subtypeStr = String(subtype);
      if (subtypeStr !== "/TrueType" && subtypeStr !== "/Type0") continue;

      // For Type0 (composite) fonts, the actual TTF is one level deeper:
      //   Type0.DescendantFonts[0].FontDescriptor.FontFile2
      let descriptor: PDFDict | undefined;
      if (subtypeStr === "/Type0") {
        const descendants = font.lookup(PDFName.of("DescendantFonts"));
        const arr =
          descendants && "asArray" in descendants
            ? (descendants as { asArray(): unknown[] }).asArray()
            : null;
        const first = arr?.[0];
        if (first instanceof PDFRef) {
          const descendantFont = doc.context.lookup(first, PDFDict);
          if (descendantFont) {
            const desc = descendantFont.lookup(PDFName.of("FontDescriptor"));
            if (desc instanceof PDFDict) descriptor = desc;
          }
        } else if (first instanceof PDFDict) {
          const desc = first.lookup(PDFName.of("FontDescriptor"));
          if (desc instanceof PDFDict) descriptor = desc;
        }
      } else {
        const desc = font.lookup(PDFName.of("FontDescriptor"));
        if (desc instanceof PDFDict) descriptor = desc;
      }
      if (!descriptor) continue;

      // FontFile2 = TrueType, FontFile3 = OpenType/CFF, FontFile = Type1.
      const file =
        descriptor.lookup(PDFName.of("FontFile2")) ??
        descriptor.lookup(PDFName.of("FontFile3")) ??
        descriptor.lookup(PDFName.of("FontFile"));
      if (!(file instanceof PDFRawStream)) continue;

      const bytes = decodePDFRawStream(file).decode();
      return { bytes, sourceName: name.toString() };
    }
  }
  return null;
}
