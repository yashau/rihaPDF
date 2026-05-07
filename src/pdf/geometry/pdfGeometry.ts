export type Mat6 = [number, number, number, number, number, number];

export type PdfRect = {
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
};

export const IDENTITY_MATRIX: Mat6 = [1, 0, 0, 1, 0, 0];

/** 6-element affine A x B, using the PDF row-vector convention: P' = P x M. */
export function mulCm(a: Mat6, b: Mat6): Mat6 {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function transformPoint(m: Mat6, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function rectsOverlap(a: PdfRect, b: PdfRect): boolean {
  const ax2 = a.pdfX + a.pdfWidth;
  const ay2 = a.pdfY + a.pdfHeight;
  const bx2 = b.pdfX + b.pdfWidth;
  const by2 = b.pdfY + b.pdfHeight;
  return a.pdfX < bx2 && ax2 > b.pdfX && a.pdfY < by2 && ay2 > b.pdfY;
}
