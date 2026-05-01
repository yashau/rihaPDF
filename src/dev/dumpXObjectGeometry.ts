// Dev-only: for each XObject referenced on a page, dump the dict's
// `/Subtype`, `/BBox`, `/Matrix` so we can see how a Form XObject's
// internal coord system contributes to its rendered size on the page.
// Used to investigate the maldivian2.pdf emblem case where
// `extractPageImages` reports a 0.7 × 0.7 size but the emblem visually
// covers a much larger area.

import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";

export type XObjectGeometry = {
  resourceName: string;
  subtype: string;
  /** Form's `/BBox` if present — `[llx, lly, urx, ury]` in form-internal
   *  coords. */
  bbox: [number, number, number, number] | null;
  /** Form's `/Matrix` if present — `[a, b, c, d, e, f]` mapping form
   *  coords to its parent's coord system. Identity when absent. */
  matrix: [number, number, number, number, number, number] | null;
};

export async function dumpXObjectGeometry(
  pdfBytes: ArrayBuffer,
  pageIndex: number,
): Promise<XObjectGeometry[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPages()[pageIndex];
  if (!page) return [];
  let node: PDFDict | null = page.node;
  let xoDict: PDFDict | null = null;
  while (node && !xoDict) {
    const r = node.lookup(PDFName.of("Resources"));
    if (r instanceof PDFDict) {
      const x = r.lookup(PDFName.of("XObject"));
      if (x instanceof PDFDict) xoDict = x;
    }
    if (xoDict) break;
    const p: unknown = node.lookup(PDFName.of("Parent"));
    if (p instanceof PDFDict) node = p;
    else if (p instanceof PDFRef) {
      const r2 = doc.context.lookup(p);
      node = r2 instanceof PDFDict ? r2 : null;
    } else node = null;
  }
  if (!xoDict) return [];
  const out: XObjectGeometry[] = [];
  for (const [name] of xoDict.entries()) {
    const xo = xoDict.lookup(name);
    let dict: PDFDict | null = null;
    if (xo instanceof PDFDict) dict = xo;
    else if (xo instanceof PDFRawStream) dict = xo.dict;
    if (!dict) continue;
    const sub = dict.lookup(PDFName.of("Subtype"));
    const subtype = sub ? String(sub).replace(/^\//, "") : "?";
    const arrAsNums = (k: string) => {
      const v = dict.lookup(PDFName.of(k));
      if (!v || typeof v !== "object" || !("asArray" in v)) return null;
      const arr = (v as { asArray(): unknown[] }).asArray();
      const nums = arr.map((x) =>
        x && typeof x === "object" && "asNumber" in x
          ? (x as { asNumber(): number }).asNumber()
          : Number(x),
      );
      if (nums.some((n) => !Number.isFinite(n))) return null;
      return nums;
    };
    const bbox = arrAsNums("BBox");
    const matrix = arrAsNums("Matrix");
    out.push({
      resourceName: name.toString().replace(/^\//, ""),
      subtype,
      bbox:
        bbox && bbox.length >= 4 ? (bbox.slice(0, 4) as [number, number, number, number]) : null,
      matrix:
        matrix && matrix.length >= 6
          ? (matrix.slice(0, 6) as [number, number, number, number, number, number])
          : null,
    });
  }
  return out;
}
