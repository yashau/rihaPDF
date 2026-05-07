import type { PdfRect } from "@/pdf/geometry/pdfGeometry";

export type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ResizeCorner = "tl" | "tr" | "bl" | "br";

/** Convert a PDF y-up rectangle into the natural viewport pixel box
 *  used by page overlays. */
export function pdfRectToViewportRect(
  rect: PdfRect,
  pageScale: number,
  viewHeight: number,
): ViewportRect {
  return {
    left: rect.pdfX * pageScale,
    top: viewHeight - (rect.pdfY + rect.pdfHeight) * pageScale,
    width: rect.pdfWidth * pageScale,
    height: rect.pdfHeight * pageScale,
  };
}

export function pdfRectArrayToViewportRect(
  [llx, lly, urx, ury]: readonly [number, number, number, number],
  pageScale: number,
  viewHeight: number,
): ViewportRect {
  return pdfRectToViewportRect(
    { pdfX: llx, pdfY: lly, pdfWidth: urx - llx, pdfHeight: ury - lly },
    pageScale,
    viewHeight,
  );
}

/** Convert a text baseline PDF point into the natural viewport box
 *  used by inserted text. */
export function pdfBaselineToViewportBox({
  pdfX,
  pdfY,
  fontSizePt,
  lineHeightPt,
  minWidthPx,
  widthPt,
  pageScale,
  viewHeight,
}: {
  pdfX: number;
  pdfY: number;
  fontSizePt: number;
  lineHeightPt: number;
  widthPt: number;
  minWidthPx: number;
  pageScale: number;
  viewHeight: number;
}): ViewportRect {
  const fontSizePx = fontSizePt * pageScale;
  return {
    left: pdfX * pageScale,
    top: viewHeight - pdfY * pageScale - fontSizePx,
    width: Math.max(widthPt * pageScale, minWidthPx),
    height: lineHeightPt * pageScale,
  };
}

/** Pointer deltas arrive in displayed screen pixels. Dividing by the
 *  effective PDF scale converts x directly; y flips because PDF space
 *  is y-up while viewport space is y-down. */
export function screenDeltaToPdf(
  dxRaw: number,
  dyRaw: number,
  effectivePdfScale: number,
): { dxPdf: number; dyPdf: number } {
  return {
    dxPdf: dxRaw / effectivePdfScale,
    dyPdf: -dyRaw / effectivePdfScale,
  };
}

/** Resize a PDF y-up rectangle from a corner while anchoring the
 *  opposite corner. */
export function resizePdfRectFromCorner(
  base: { x: number; y: number; w: number; h: number },
  corner: ResizeCorner,
  dxPdf: number,
  dyPdf: number,
  minPdf: number,
): { x: number; y: number; w: number; h: number } {
  let { x, y } = base;
  let w = base.w;
  let h = base.h;
  switch (corner) {
    case "br":
      w = Math.max(minPdf, base.w + dxPdf);
      h = Math.max(minPdf, base.h - dyPdf);
      y = base.y + base.h - h;
      break;
    case "tr":
      w = Math.max(minPdf, base.w + dxPdf);
      h = Math.max(minPdf, base.h + dyPdf);
      break;
    case "tl":
      w = Math.max(minPdf, base.w - dxPdf);
      h = Math.max(minPdf, base.h + dyPdf);
      x = base.x + base.w - w;
      break;
    case "bl":
      w = Math.max(minPdf, base.w - dxPdf);
      h = Math.max(minPdf, base.h - dyPdf);
      x = base.x + base.w - w;
      y = base.y + base.h - h;
      break;
  }
  return { x, y, w, h };
}
