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
import { PDFJS_ANNOTATION_MODE_ENABLE_FORMS } from "@/pdf/render/pdfjs";
import type { RenderedPage } from "@/pdf/render/pdf";
import {
  parseContentStream,
  serializeContentStream,
  findTextShows,
} from "@/pdf/content/contentStream";
import {
  computeTextShowBoundsByOp,
  matchTextShowToTarget,
  type TextStripTargetBox,
} from "@/pdf/content/textShowBounds";
import { getPageContentBytes, setPageContentBytes } from "@/pdf/content/pageContent";
import { browserDevicePixelRatio, chooseCanvasRenderBudget } from "@/pdf/render/guardrails";
import { isLegacyThaanaFontHint } from "@/pdf/text/legacyThaana";

export type PageStripSpec = {
  /** Page index within the source's doc. */
  pageIndex: number;
  /** Run IDs whose Tj/TJ ops should be removed (covers both text edits
   *  and live drags — the HTML overlay redraws the text). */
  runIds: Set<string>;
  /** Image IDs whose Do op should be removed (the HTML overlay paints
   *  the image at its new position via the sprite cache). */
  imageIds: Set<string>;
  /** Shape IDs whose entire q…Q block should be removed. Vector shapes
   *  carry no overlay-rendered replacement, so the live preview shows
   *  the page minus the shape — the user sees the deletion immediately. */
  shapeIds: Set<string>;
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
    if (spec.runIds.size === 0 && spec.imageIds.size === 0 && spec.shapeIds.size === 0) continue;

    const content = getPageContentBytes(doc.context, page.node);
    const ops = parseContentStream(content);
    const shows = findTextShows(ops);
    const showBoundsByOp = computeTextShowBoundsByOp(ops, page.node.Resources(), doc.context);
    const opOwnerCount = countTextRunOpOwners(rendered.textRuns);

    const indicesToRemove = new Set<number>();
    const pageHeight = page.getHeight();
    const scale = rendered.scale;

    // Each TextRun carries the content-stream Tj/TJ op indices its
    // glyphs come from (propagated from FontShow → TextItem →
    // TextRun in pdf.ts). Start there. Source-detected underline /
    // strikethrough q…Q blocks ride alongside on `decorationOpRanges`
    // so the preview also sheds them — otherwise the old line stays
    // visible while the HTML overlay redraws the text on top of it.
    const targetBoxesByRunId = new Map<
      string,
      TextStripTargetBox & { allowBroadFallback: boolean }
    >();
    for (const runId of spec.runIds) {
      const run = rendered.textRuns.find((r) => r.id === runId);
      if (!run) continue;
      const targetBox = {
        rect: {
          pdfX: run.bounds.left / scale,
          pdfY: pageHeight - (run.bounds.top + run.bounds.height) / scale,
          pdfWidth: run.bounds.width / scale,
          pdfHeight: run.bounds.height / scale,
        },
        baselineY: Math.round(pageHeight - run.baselineY / scale),
        h: run.height / scale,
        allowBroadFallback:
          run.contentStreamOpIndices.length === 0 || isLegacyThaanaFontHint(run.fontBaseName),
      };
      targetBoxesByRunId.set(runId, targetBox);
      for (const i of run.contentStreamOpIndices) {
        const bounds = showBoundsByOp.get(i);
        if (bounds?.fromMetrics) {
          if (matchTextShowToTarget(bounds, targetBox).stripWholeOp) indicesToRemove.add(i);
        } else if ((opOwnerCount.get(i) ?? 0) <= 1) {
          indicesToRemove.add(i);
        }
      }
      for (const range of run.decorationOpRanges ?? []) {
        for (let i = range.qOpIndex; i <= range.QOpIndex; i++) {
          indicesToRemove.add(i);
        }
      }
    }
    // Then pick up any extra shows that visually fall on the same
    // baseline AND inside a targeted run's x-extent. Needed for pdf.js
    // bucketing where a logical paragraph splits into multiple Tj's
    // sharing a y (see preview-strip-paragraph tests). Bounding to the
    // run's x-extent keeps unrelated runs on the same baseline (e.g. a
    // "ޖަލްސާ:" label sitting outside the value run's box) from being
    // collateral-stripped.
    const targetBoxes = Array.from(targetBoxesByRunId.values());
    // Prefer actual Tj/TJ glyph envelopes, derived from the show op's
    // text matrix, font size/widths, and TJ adjustments. This keeps a
    // same-baseline label outside the edited run's visual bounds from
    // being stripped. The old baseline/x-slack heuristic is now a last
    // resort for legacy/empty-index runs only.
    for (const s of shows) {
      if (indicesToRemove.has(s.index)) continue;
      const bounds = showBoundsByOp.get(s.index);
      if (!bounds?.fromMetrics) continue;
      for (const box of targetBoxes) {
        if (!matchTextShowToTarget(bounds, box).stripWholeOp) continue;
        indicesToRemove.add(s.index);
        break;
      }
    }

    for (const s of shows) {
      if (indicesToRemove.has(s.index)) continue;
      const bounds = showBoundsByOp.get(s.index);
      if (bounds?.fromMetrics) continue;
      for (const box of targetBoxes) {
        if (!box.allowBroadFallback) continue;
        const ey = Math.round(s.textMatrix[5]);
        const ex = s.textMatrix[4];
        const xSlackPdf = Math.max(1, Math.min(4, box.h * 0.25));
        if (Math.abs(ey - box.baselineY) > 1) continue;
        if (ex < box.rect.pdfX - xSlackPdf) continue;
        if (ex > box.rect.pdfX + box.rect.pdfWidth + xSlackPdf) continue;
        indicesToRemove.add(s.index);
        break;
      }
    }

    for (const imageId of spec.imageIds) {
      const img = rendered.images.find((i) => i.id === imageId);
      if (!img) continue;
      indicesToRemove.add(img.doOpIndex);
    }

    // Vector-shape deletes strip the entire q…Q block. The detector
    // guarantees the block is pure-vector (no nested text or image)
    // so removing it can't take down unrelated content.
    for (const shapeId of spec.shapeIds) {
      const shape = rendered.shapes.find((s) => s.id === shapeId);
      if (!shape) continue;
      for (let i = shape.qOpIndex; i <= shape.QOpIndex; i++) {
        indicesToRemove.add(i);
      }
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
function countTextRunOpOwners(runs: RenderedPage["textRuns"]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const run of runs) {
    for (const opIndex of new Set(run.contentStreamOpIndices)) {
      counts.set(opIndex, (counts.get(opIndex) ?? 0) + 1);
    }
  }
  return counts;
}

export async function renderPagePreviewCanvas(
  pdfBytes: Uint8Array,
  pageIndex: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const buf = pdfBytes.slice().buffer;
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    // Match renderPage's DPR-aware bitmap rendering so the preview
    // canvas is crisp on retina mobile and matches the original at
    // pixel level. The CSS size (canvas.style.width) is set by
    // PdfPage to page.viewWidth in CSS pixels — this only affects
    // the bitmap pixel count, not the layout box.
    const layoutViewport = page.getViewport({ scale });
    const budget = chooseCanvasRenderBudget(
      layoutViewport.width,
      layoutViewport.height,
      browserDevicePixelRatio(),
    );
    const viewport = page.getViewport({ scale: scale * budget.pixelScale });
    const canvas = document.createElement("canvas");
    canvas.width = budget.width;
    canvas.height = budget.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
      // Match the main render path: form widgets are editable DOM
      // overlays in rihaPDF, so their saved /AP streams must not be
      // painted into the preview canvas underneath the live overlay.
      annotationMode: PDFJS_ANNOTATION_MODE_ENABLE_FORMS,
    }).promise;
    return canvas;
  } finally {
    void doc.destroy();
  }
}
