export const PDF_LOAD_GUARDRAILS = {
  /** Eager loading renders every page and extracts source metadata up front,
   *  so reject files that are likely to exhaust browser memory. */
  maxFileBytes: 150 * 1024 * 1024,
  /** Until the viewer is virtualized, each loaded page owns a canvas. */
  maxPages: 250,
  /** Hard canvas bitmap budget. 16MP is below common mobile canvas limits
   *  while keeping ordinary Letter/A4 pages crisp at the app's scales. */
  maxCanvasPixels: 16_000_000,
  /** Browser canvas edge limits vary; keep well below the common 16k cap. */
  maxCanvasEdgePx: 8192,
  maxDevicePixelRatio: 2,
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mib = bytes / (1024 * 1024);
  if (mib < 10) return `${mib.toFixed(1)} MB`;
  return `${Math.round(mib)} MB`;
}

export function assertPdfFileWithinLimits(file: Pick<File, "name" | "size">): void {
  if (file.size <= PDF_LOAD_GUARDRAILS.maxFileBytes) return;
  throw new Error(
    `${file.name || "PDF"} is ${formatBytes(file.size)}; this browser build currently supports PDFs up to ${formatBytes(
      PDF_LOAD_GUARDRAILS.maxFileBytes,
    )}.`,
  );
}

export function assertPdfPageCountWithinLimits(pageCount: number, filename: string): void {
  if (pageCount <= PDF_LOAD_GUARDRAILS.maxPages) return;
  throw new Error(
    `${filename || "PDF"} has ${pageCount} pages; this browser build currently supports up to ${PDF_LOAD_GUARDRAILS.maxPages} pages at a time.`,
  );
}

function clampDevicePixelRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(value, PDF_LOAD_GUARDRAILS.maxDevicePixelRatio);
}

export type CanvasRenderBudget = {
  /** Multiplier between layout CSS pixels and backing-store pixels. */
  pixelScale: number;
  /** Canvas backing-store dimensions after guardrails are applied. */
  width: number;
  height: number;
  /** True when the requested DPR had to be reduced to fit the budget. */
  constrained: boolean;
};

export function chooseCanvasRenderBudget(
  cssWidth: number,
  cssHeight: number,
  requestedDevicePixelRatio: number,
): CanvasRenderBudget {
  const safeCssWidth = Math.max(1, cssWidth);
  const safeCssHeight = Math.max(1, cssHeight);
  const requestedPixelScale = clampDevicePixelRatio(requestedDevicePixelRatio);
  const byPixels = Math.sqrt(PDF_LOAD_GUARDRAILS.maxCanvasPixels / (safeCssWidth * safeCssHeight));
  const byWidth = PDF_LOAD_GUARDRAILS.maxCanvasEdgePx / safeCssWidth;
  const byHeight = PDF_LOAD_GUARDRAILS.maxCanvasEdgePx / safeCssHeight;
  const pixelScale = Math.max(0.1, Math.min(requestedPixelScale, byPixels, byWidth, byHeight));
  return {
    pixelScale,
    width: Math.max(1, Math.floor(safeCssWidth * pixelScale)),
    height: Math.max(1, Math.floor(safeCssHeight * pixelScale)),
    constrained: pixelScale < requestedDevicePixelRatio,
  };
}

export function browserDevicePixelRatio(): number {
  return typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
}
