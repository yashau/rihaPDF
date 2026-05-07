// Blank slots are first-class destinations: the user can click into
// them to drop text/images, drag runs and images from other pages
// onto them, and add highlights / comments / ink. To plug into the
// existing per-source save pipeline they need an addressable
// (sourceKey, pageIndex) pair — even though they don't come from a
// loaded PDF.
//
// We give each blank slot its own synthetic source: sourceKey
// "__blank__:<slotId>", pageIndex 0. The save pipeline detects the
// prefix, materialises a fresh PDFDocument with one page sized to
// the slot, runs the same insert / draw / annotation passes against
// it, and copies that page into the output instead of the bare
// `output.addPage(slot.size)` we used before.

import type { PageSlot } from "@/domain/slots";
import type { RenderedPage } from "@/lib/pdf";

const BLANK_SOURCE_PREFIX = "__blank__:";

export function blankSourceKey(slotId: string): string {
  return BLANK_SOURCE_PREFIX + slotId;
}

export function isBlankSourceKey(sourceKey: string): boolean {
  return sourceKey.startsWith(BLANK_SOURCE_PREFIX);
}

export function slotIdFromBlankSourceKey(sourceKey: string): string {
  return sourceKey.slice(BLANK_SOURCE_PREFIX.length);
}

/** Per-slot cache so re-renders reuse the same `RenderedPage` object
 *  (and the same canvas). PdfPage's canvas-mount effect is keyed on
 *  page identity — handing it a fresh canvas each render would force
 *  a remount + style reapplication on every state change. */
const renderedCache = new Map<string, RenderedPage>();

export function blankRenderedPage(slot: PageSlot, scale: number): RenderedPage {
  if (slot.kind !== "blank") {
    throw new Error("blankRenderedPage called with non-blank slot");
  }
  const cached = renderedCache.get(slot.id);
  if (cached && cached.scale === scale) return cached;

  const [pdfWidth, pdfHeight] = slot.size;
  const viewWidth = pdfWidth * scale;
  const viewHeight = pdfHeight * scale;
  // Match RenderedPage's DPR convention: the source pipeline renders
  // at scale × min(devicePixelRatio, 2) into a canvas whose CSS
  // width/height stay at scale-only dimensions. We do the same so
  // overlays / preview math (which derives the bitmap-to-CSS ratio
  // from canvas.style.width vs canvas.width) doesn't trip.
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewWidth * dpr));
  canvas.height = Math.max(1, Math.floor(viewHeight * dpr));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const page: RenderedPage = {
    pageNumber: 1,
    canvas,
    scale,
    pdfWidth,
    pdfHeight,
    viewWidth,
    viewHeight,
    textItems: [],
    textRuns: [],
    images: [],
    shapes: [],
  };
  renderedCache.set(slot.id, page);
  return page;
}

/** Drop the cached RenderedPage / canvas for a slot when it's removed
 *  so the bitmap memory doesn't leak across the session. Safe to call
 *  with a slot id that isn't cached. */
export function releaseBlankRenderedPage(slotId: string): void {
  renderedCache.delete(slotId);
}
