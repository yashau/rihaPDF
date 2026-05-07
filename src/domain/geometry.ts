export type PdfRect = {
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
};

export function rectsOverlap(a: PdfRect, b: PdfRect): boolean {
  const ax2 = a.pdfX + a.pdfWidth;
  const ay2 = a.pdfY + a.pdfHeight;
  const bx2 = b.pdfX + b.pdfWidth;
  const by2 = b.pdfY + b.pdfHeight;
  return a.pdfX < bx2 && ax2 > b.pdfX && a.pdfY < by2 && ay2 > b.pdfY;
}
