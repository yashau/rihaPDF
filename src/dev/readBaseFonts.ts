// Dev-only: read every Page's font BaseFont strings from a PDF blob.
// Used by scripts/verifyInsertFormat.mjs to confirm the saved file
// references the right StandardFont variant for an inserted run.

import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

export async function readBaseFonts(pdfBytes: ArrayBuffer): Promise<string[][]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out: string[][] = [];
  for (const page of doc.getPages()) {
    const seen: string[] = [];
    let node: PDFDict | null = page.node;
    while (node) {
      const r = node.lookup(PDFName.of("Resources"));
      if (r instanceof PDFDict) {
        const f = r.lookup(PDFName.of("Font"));
        if (f instanceof PDFDict) {
          for (const [name] of f.entries()) {
            const fd = f.lookup(name);
            if (fd instanceof PDFDict) {
              const base = fd.lookup(PDFName.of("BaseFont"));
              if (base) seen.push(String(base));
            }
          }
        }
      }
      const par: unknown = node.lookup(PDFName.of("Parent"));
      if (par instanceof PDFDict) node = par;
      else if (par instanceof PDFRef) {
        const r2 = doc.context.lookup(par);
        node = r2 instanceof PDFDict ? r2 : null;
      } else node = null;
    }
    out.push(seen);
  }
  return out;
}
