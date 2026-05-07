import type { PageSlot } from "@/domain/slots";
import type { RenderedPage } from "@/pdf/render/pdf";

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
