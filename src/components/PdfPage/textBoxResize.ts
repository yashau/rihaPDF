import type { ResizeCorner } from "./geometry";

const RESIZE_CLICK_SUPPRESS_MS = 250;

export function setTextBoxResizeActive(active: boolean): void {
  if (active) {
    document.body.dataset.textBoxResizeActive = "true";
    return;
  }
  window.setTimeout(() => {
    if (document.body.dataset.textBoxResizeActive === "true") {
      delete document.body.dataset.textBoxResizeActive;
    }
  }, RESIZE_CLICK_SUPPRESS_MS);
}

export function resizeTextBoxRealEstateFromCorner({
  base,
  corner,
  dx,
  dy,
  min,
  isRtl,
}: {
  base: { width: number; height: number };
  corner: ResizeCorner;
  dx: number;
  dy: number;
  min: number;
  isRtl: boolean;
}): { anchorDx: number; width: number; height: number } {
  const isLeftHandle = corner === "tl" || corner === "bl";
  const isTopHandle = corner === "tl" || corner === "tr";
  const width = Math.max(min, base.width + (isLeftHandle ? -dx : dx));
  const height = Math.max(min, base.height + (isTopHandle ? -dy : dy));
  const widthDelta = width - base.width;
  const anchorSideDragged = isRtl ? !isLeftHandle : isLeftHandle;
  const anchorDx = anchorSideDragged ? (isLeftHandle ? -widthDelta : widthDelta) : 0;
  return { anchorDx, width, height };
}
