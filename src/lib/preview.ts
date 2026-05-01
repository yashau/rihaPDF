// Live preview pipeline — instead of covering the original glyphs/
// images with white HTML rectangles when the user edits or moves
// something, we actually REMOVE those ops from the page's content
// stream and re-render the page canvas. The HTML overlays then sit on
// a clean canvas and don't need to mask anything.
//
// We don't draw the replacement text/image into the preview PDF; that's
// still done with HTML in PdfPage. The preview is purely "the page
// minus the items the user is currently editing/moving" — keeps the
// preview cheap (no font embedding) and keeps the save path the sole
// owner of the actual content rewrite.
//
// Source-keyed: callers run this once per source whose pages need
// stripping. The output bytes feed straight into pdfjs.getDocument for
// per-page re-rendering keyed by `${sourceKey}:${pageIndex}`.

import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import type { RenderedPage } from "./pdf";
import { parseContentStream, serializeContentStream, findTextShows } from "./contentStream";
import { getPageContentBytes, setPageContentBytes } from "./pageContent";

export type PageStripSpec = {
  /** Page index within the source's doc. */
  pageIndex: number;
  /** Run IDs whose Tj/TJ ops should be removed (covers both text edits
   *  and live drags — the HTML overlay redraws the text). */
  runIds: Set<string>;
  /** Image IDs whose Do op should be removed (the HTML overlay paints
   *  the image at its new position via the sprite cache). */
  imageIds: Set<string>;
};

/** Build a lightweight preview PDF where the specified runs/images are
 *  stripped from each page's content stream. The returned Uint8Array
 *  feeds straight into pdfjs.getDocument for re-rendering. */
export async function buildPreviewBytes(
  originalBytes: ArrayBuffer,
  pages: RenderedPage[],
  specs: PageStripSpec[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes);
  const docPages = doc.getPages();
  for (const spec of specs) {
    const page = docPages[spec.pageIndex];
    const rendered = pages[spec.pageIndex];
    if (!page || !rendered) continue;
    if (spec.runIds.size === 0 && spec.imageIds.size === 0) continue;

    const content = getPageContentBytes(doc.context, page.node);
    const ops = parseContentStream(content);
    const shows = findTextShows(ops);

    const indicesToRemove = new Set<number>();
    const pageHeight = page.getHeight();
    const scale = rendered.scale;

    // Each TextRun carries the content-stream Tj/TJ op indices its
    // glyphs come from (propagated from FontShow → TextItem →
    // TextRun in pdf.ts). Start there.
    for (const runId of spec.runIds) {
      const run = rendered.textRuns.find((r) => r.id === runId);
      if (!run) continue;
      for (const i of run.contentStreamOpIndices) indicesToRemove.add(i);
    }
    // Then pick up any extra shows that visually fall on the same
    // baseline as one of the targeted runs. See preview-strip-paragraph
    // tests for why this is needed (pdf.js bucketing splits a logical
    // paragraph into multiple Tj's that share a y).
    const allTargetYs = new Set<number>();
    for (const runId of spec.runIds) {
      const run = rendered.textRuns.find((r) => r.id === runId);
      if (!run) continue;
      const runPdfY = pageHeight - run.baselineY / scale;
      allTargetYs.add(Math.round(runPdfY));
    }
    for (const s of shows) {
      if (indicesToRemove.has(s.index)) continue;
      const ey = Math.round(s.textMatrix[5]);
      if (allTargetYs.has(ey) || allTargetYs.has(ey - 1) || allTargetYs.has(ey + 1)) {
        indicesToRemove.add(s.index);
      }
    }

    for (const imageId of spec.imageIds) {
      const img = rendered.images.find((i) => i.id === imageId);
      if (!img) continue;
      indicesToRemove.add(img.doOpIndex);
    }

    if (indicesToRemove.size === 0) continue;

    const newOps = ops.filter((_, i) => !indicesToRemove.has(i));
    setPageContentBytes(doc.context, page.node, serializeContentStream(newOps));
  }
  return doc.save();
}

/** Render a single page from `pdfBytes` to a canvas at the given scale.
 *  Used to refresh just the affected pages after a preview rebuild
 *  without re-extracting fonts / glyph maps / images (those are stable
 *  for the original PDF). */
export async function renderPagePreviewCanvas(
  pdfBytes: Uint8Array,
  pageIndex: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const buf = pdfBytes.slice().buffer;
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas;
  } finally {
    void doc.destroy();
  }
}
