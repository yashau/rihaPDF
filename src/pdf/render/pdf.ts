import { applyShowDecodes } from "@/pdf/text/textDecodeRecovery";
import { buildTextRuns } from "@/pdf/text/textRunBuilder";
import type { GlyphMap } from "@/pdf/source/glyphMap";
import { PDFJS_ANNOTATION_MODE_ENABLE_FORMS, loadPdf } from "@/pdf/render/pdfjs";
import { itemBoundsInViewport, multiplyTransforms } from "@/pdf/geometry/pdfTransform";
import type { PdfPage, RenderedPage, TextItem } from "@/pdf/render/pdfTypes";
import type { FontShow } from "@/pdf/source/sourceFonts";
import type { ImageInstance } from "@/pdf/source/sourceImages";
import type { ShapeInstance } from "@/pdf/source/sourceShapes";
import { browserDevicePixelRatio, chooseCanvasRenderBudget } from "@/pdf/render/guardrails";

export { loadPdf, itemBoundsInViewport };
export type { PdfDoc, PdfPage, RenderedPage, TextItem, TextRun } from "@/pdf/render/pdfTypes";

export async function renderPage(
  page: PdfPage,
  scale: number,
  /** Per-page list of `Tj/TJ` text-shows we already extracted from the
   *  source PDF via pdf-lib (in `extractPageFontShows`). buildTextRuns
   *  uses this to attach a fontFamily / bold / italic to each run by
   *  matching the run's PDF-user-space baseline against the show's. */
  fontShows: FontShow[] = [],
  /** Per-font glyphId → Unicode reverse cmap, used to recover characters
   *  the source PDF's broken ToUnicode CMap omitted (e.g. the long-vowel
   *  Thaana fili). Keyed by PDF resource name (`F1`, `F2`, …). */
  glyphMaps: Map<string, GlyphMap> = new Map(),
  /** Image / Form XObject placements pre-extracted by `extractPageImages`.
   *  Indexed per page in source order; we don't recompute them here. */
  images: ImageInstance[] = [],
  /** Vector-shape blocks pre-extracted by `extractPageShapes`. */
  shapes: ShapeInstance[] = [],
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  // Render the bitmap at scale × devicePixelRatio so retina mobile (DPR
  // 2-3) gets crisp pixels on a canvas whose CSS-pixel size still
  // matches the layout `scale`. `cropCanvasToDataUrl` derives the
  // bitmap/CSS ratio from `canvas.style.width`, which PdfPage sets to
  // `page.viewWidth` (= layout-scale CSS pixels), so its math
  // automatically tracks this multiplier.
  //
  // DPR is capped at 2 to bound memory: a multi-page Letter document
  // at scale 1.5 × DPR 3 would allocate ~37 MP per page. Cap of 2
  // keeps the worst case at ~8 MP/page — visually indistinguishable
  // from 3× on the affected devices.
  const budget = chooseCanvasRenderBudget(
    viewport.width,
    viewport.height,
    browserDevicePixelRatio(),
  );
  const renderViewport = page.getViewport({ scale: scale * budget.pixelScale });
  const canvas = document.createElement("canvas");
  canvas.width = budget.width;
  canvas.height = budget.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({
    canvasContext: ctx,
    viewport: renderViewport,
    canvas,
    // rihaPDF renders AcroForm widgets as editable DOM overlays. If
    // pdf.js also paints widget /AP streams into the canvas (the
    // default AnnotationMode.ENABLE), re-opened saved forms show stale
    // rasterized text underneath the live input. Keep non-form
    // annotations visible, but suppress form-widget appearances here.
    annotationMode: PDFJS_ANNOTATION_MODE_ENABLE_FORMS,
  }).promise;

  // disableCombineTextItems keeps each Tj/TJ as its own item — pdf.js's
  // default consolidation merges adjacent items and inserts U+0020 to
  // bridge gaps, which hides the empty items that recover-missing-chars
  // wants to patch (orphan Thaana fili at standalone positions).
  const content = await page.getTextContent({
    disableCombineTextItems: true,
  } as Parameters<typeof page.getTextContent>[0]);
  // pdf.js gives us text item transforms in PDF user space. We compose with
  // viewport.transform so all downstream code (overlay positioning, run
  // bounding boxes, save coord conversion) works in viewport pixel space.
  const vt = viewport.transform;
  const items: TextItem[] = content.items.map((raw, index) => {
    const item = raw as {
      str: string;
      transform: number[];
      width: number;
      height: number;
      fontName: string;
      hasEOL: boolean;
    };
    const composed = multiplyTransforms(vt, item.transform);
    const heightView = Math.abs(composed[3]);
    return {
      index,
      str: item.str,
      transform: composed,
      width: item.width * scale,
      height: heightView,
      fontName: item.fontName,
      hasEOL: item.hasEOL,
    };
  });

  // Replace pdf.js's str on each item with authoritative text decoded
  // from matching content-stream Tj bytes where a usable glyph map exists.
  if (glyphMaps.size > 0 && fontShows.length > 0) {
    applyShowDecodes(items, fontShows, glyphMaps, scale, viewport.height, vt);
  }

  return {
    pageNumber: page.pageNumber,
    canvas,
    scale,
    pdfWidth: page.view[2] - page.view[0],
    pdfHeight: page.view[3] - page.view[1],
    viewWidth: viewport.width,
    viewHeight: viewport.height,
    textItems: items,
    textRuns: buildTextRuns(items, page.pageNumber, fontShows, scale, viewport.height),
    images,
    shapes,
  };
}
