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

import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import type { RenderedPage, TextRun } from "./pdf";
import {
  parseContentStream,
  serializeContentStream,
  findTextShows,
} from "./contentStream";
import { getPageContentBytes, setPageContentBytes } from "./pageContent";

export type PageStripSpec = {
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

    // For each edited/dragged run, find the Tj/TJ ops whose text-matrix
    // translation lands inside the run's PDF-user-space bounding box.
    // Same heuristic as save.ts (kept in sync — the matching tolerance
    // is what reliably catches Office-style per-line Tm setups).
    for (const runId of spec.runIds) {
      const run = rendered.textRuns.find((r) => r.id === runId);
      if (!run) continue;
      const idxs = matchTjIndicesForRun(shows, run, pageHeight, scale);
      for (const i of idxs) indicesToRemove.add(i);
    }

    // Each image has its Do op index pre-resolved at extraction; just
    // drop that op. Form XObjects with multiple cm/state changes still
    // disappear because pdf.js won't paint a Do that's gone.
    for (const imageId of spec.imageIds) {
      const img = rendered.images.find((i) => i.id === imageId);
      if (!img) continue;
      indicesToRemove.add(img.doOpIndex);
    }

    if (indicesToRemove.size === 0) continue;

    const newOps = ops.filter((_, i) => !indicesToRemove.has(i));
    setPageContentBytes(
      doc.context,
      page.node,
      serializeContentStream(newOps),
    );
  }
  return doc.save();
}

/** Find the indices in the parsed `ops` array that correspond to the
 *  Tj/TJ operators painting `run`. Matches by the text-matrix
 *  translation vs the run's PDF-user-space bounding box (same logic
 *  used by save.ts when removing the originals). */
function matchTjIndicesForRun(
  shows: ReturnType<typeof findTextShows>,
  run: TextRun,
  pageHeight: number,
  scale: number,
): number[] {
  const runPdfX = run.bounds.left / scale;
  const runPdfY = pageHeight - run.baselineY / scale;
  const runPdfWidth = run.bounds.width / scale;
  const runPdfHeight = run.height / scale;
  const tolY = Math.max(2, runPdfHeight * 0.4);
  const tolX = Math.max(2, runPdfHeight * 0.3);
  const out: number[] = [];
  for (const s of shows) {
    const ex = s.textMatrix[4];
    const ey = s.textMatrix[5];
    if (Math.abs(ey - runPdfY) > tolY) continue;
    if (ex < runPdfX - tolX) continue;
    if (ex > runPdfX + runPdfWidth + tolX) continue;
    out.push(s.index);
  }
  return out;
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
    doc.destroy();
  }
}
