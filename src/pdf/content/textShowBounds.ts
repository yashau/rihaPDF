import { PDFContext, PDFDict } from "pdf-lib";
import type { PdfRect } from "@/domain/geometry";
import type { ContentOp } from "@/pdf/content/contentStream";
import {
  walkTextShows,
  type PdfTextState,
  type TextShowSegment,
} from "@/pdf/content/pdfTextWalker";
import { readFontMetrics, resolveFontDict, type FontMetrics } from "@/pdf/save/redactions/glyphs";

export type TextShowBounds = {
  opIndex: number;
  fontName: string | null;
  fontSize: number;
  /** Full glyph/text-show envelope in PDF user space. */
  rect: PdfRect;
  /** Baseline origin from the text matrix, useful as a coarse fallback. */
  baseline: { x: number; y: number };
  /** True when derived from PDF font widths rather than a start-point heuristic. */
  fromMetrics: boolean;
};

export type TextStripTargetBox = {
  rect: PdfRect;
  baselineY: number;
  h: number;
};

export type TextShowTargetMatch = {
  /** True when a whole-op strip is narrow enough for this target run. */
  stripWholeOp: boolean;
  /** True when the op overlaps the target, but also appears to span neighbours. */
  spansBeyondTarget: boolean;
  horizontalOverlapRatio: number;
};

/** Compute a per-Tj/TJ visual envelope from the parsed show op, text state,
 * font size, font widths, and TJ spacing. This is intentionally a narrow
 * matching primitive for edit/preview strip decisions: prefer these op-local
 * bounds over global baseline slack so adjacent labels on the same line do not
 * get stripped accidentally.
 */
export function computeTextShowBoundsByOp(
  ops: ContentOp[],
  resources: PDFDict | undefined | null,
  ctx: PDFContext,
): Map<number, TextShowBounds> {
  const metricsByFont = new Map<string, FontMetrics | null>();
  const getMetrics = (fontName: string | null): FontMetrics | null => {
    if (!fontName || !resources) return null;
    if (!metricsByFont.has(fontName)) {
      const fontDict = resolveFontDict(resources, fontName, ctx);
      metricsByFont.set(fontName, fontDict ? readFontMetrics(fontDict, ctx) : null);
    }
    return metricsByFont.get(fontName) ?? null;
  };

  const out = new Map<number, TextShowBounds>();
  walkTextShows(ops, ({ opIndex, state, segments }) => {
    const metrics = getMetrics(state.fontName);
    const precise = metrics && segments ? boundsFromSegments(state, segments, metrics) : null;
    const rect = precise ?? fallbackOriginBounds(state);
    if (!rect) return;
    out.set(opIndex, {
      opIndex,
      fontName: state.fontName,
      fontSize: state.fontSize,
      rect,
      baseline: { x: state.tm[4], y: state.tm[5] },
      fromMetrics: !!precise,
    });
  });
  return out;
}

function boundsFromSegments(
  s: PdfTextState,
  segments: TextShowSegment[],
  metrics: FontMetrics,
): PdfRect | null {
  if (s.fontSize <= 0) return null;
  let tx = 0;
  let rect: PdfRect | null = null;
  for (const seg of segments) {
    if (seg.kind === "spacer") {
      tx -= (seg.value / 1000) * s.fontSize * s.Th;
      continue;
    }
    const glyphs = decodeGlyphIds(seg.bytes, metrics);
    for (const gid of glyphs) {
      const widthFontUnits = metrics.widthByGid.get(gid) ?? metrics.defaultWidth;
      const glyphAdvance = (widthFontUnits / 1000) * s.fontSize * s.Th;
      const glyphRect = bboxFromTextSpaceRect(s.tm, tx, tx + glyphAdvance, s.fontSize);
      rect = rect ? unionRects(rect, glyphRect) : glyphRect;
      const isSpaceChar = metrics.twAppliesToSpace && metrics.bytesPerGlyph === 1 && gid === 0x20;
      tx += glyphAdvance + (s.Tc + (isSpaceChar ? s.Tw : 0)) * s.Th;
    }
  }
  return rect;
}

function decodeGlyphIds(bytes: Uint8Array, metrics: FontMetrics): number[] {
  const out: number[] = [];
  const bpg = metrics.bytesPerGlyph;
  const usable = bytes.length - (bytes.length % bpg);
  for (let i = 0; i < usable; i += bpg) {
    let gid = 0;
    for (let k = 0; k < bpg; k++) gid = (gid << 8) | bytes[i + k];
    out.push(gid);
  }
  return out;
}

function fallbackOriginBounds(s: PdfTextState): PdfRect | null {
  if (s.fontSize <= 0) return null;
  const [a, , c, d, e, f] = s.tm;
  const w = Math.max(1, Math.abs(a) * s.fontSize * Math.max(1, s.Th));
  const h = Math.max(1, Math.hypot(c, d) || s.fontSize);
  return { pdfX: e - 0.5, pdfY: f - h * 0.25, pdfWidth: w + 1, pdfHeight: h * 1.25 };
}

function bboxFromTextSpaceRect(
  tm: PdfTextState["tm"],
  x0: number,
  x1: number,
  fontSize: number,
): PdfRect {
  const [a, b, c, d, e, f] = tm;
  const corners: Array<[number, number]> = [
    [x0, 0],
    [x1, 0],
    [x1, fontSize],
    [x0, fontSize],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [tx, ty] of corners) {
    const wx = a * tx + c * ty + e;
    const wy = b * tx + d * ty + f;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
  }
  return { pdfX: minX, pdfY: minY, pdfWidth: maxX - minX, pdfHeight: maxY - minY };
}

function unionRects(a: PdfRect, b: PdfRect): PdfRect {
  const minX = Math.min(a.pdfX, b.pdfX);
  const minY = Math.min(a.pdfY, b.pdfY);
  const maxX = Math.max(a.pdfX + a.pdfWidth, b.pdfX + b.pdfWidth);
  const maxY = Math.max(a.pdfY + a.pdfHeight, b.pdfY + b.pdfHeight);
  return { pdfX: minX, pdfY: minY, pdfWidth: maxX - minX, pdfHeight: maxY - minY };
}

export function matchTextShowToTarget(
  bounds: TextShowBounds,
  target: TextStripTargetBox,
): TextShowTargetMatch {
  const pad = Math.max(0.5, Math.min(1.5, target.h * 0.06));
  const baselineTol = Math.max(1.25, Math.min(3, target.h * 0.18));
  const baselineOk = Math.abs(bounds.baseline.y - target.baselineY) <= baselineTol;
  if (!baselineOk) return noTargetMatch();

  const show = expandRect(bounds.rect, pad);
  const run = expandRect(target.rect, pad);
  if (!rectsIntersect(show, run)) return noTargetMatch();

  const xOverlap = overlap1d(
    bounds.rect.pdfX,
    bounds.rect.pdfX + bounds.rect.pdfWidth,
    target.rect.pdfX,
    target.rect.pdfX + target.rect.pdfWidth,
  );
  const yOverlap = overlap1d(
    bounds.rect.pdfY,
    bounds.rect.pdfY + bounds.rect.pdfHeight,
    target.rect.pdfY,
    target.rect.pdfY + target.rect.pdfHeight,
  );
  if (xOverlap <= 0 || yOverlap <= 0) return noTargetMatch();

  const minWidth = Math.max(0.001, Math.min(bounds.rect.pdfWidth, target.rect.pdfWidth));
  const targetWidth = Math.max(0.001, target.rect.pdfWidth);
  const showWidth = Math.max(0.001, bounds.rect.pdfWidth);
  const horizontalOverlapRatio = xOverlap / minWidth;
  const showCoveredByTarget = xOverlap / showWidth;
  const targetCoveredByShow = xOverlap / targetWidth;
  const targetCenter = target.rect.pdfX + target.rect.pdfWidth / 2;
  const showCenter = bounds.rect.pdfX + bounds.rect.pdfWidth / 2;
  const targetCenterInsideShow =
    targetCenter >= bounds.rect.pdfX && targetCenter <= bounds.rect.pdfX + bounds.rect.pdfWidth;
  const showCenterInsideTarget =
    showCenter >= target.rect.pdfX && showCenter <= target.rect.pdfX + target.rect.pdfWidth;

  const meaningfulHorizontalMatch =
    horizontalOverlapRatio >= 0.45 ||
    (targetCenterInsideShow && targetCoveredByShow >= 0.55) ||
    (showCenterInsideTarget && showCoveredByTarget >= 0.55);
  if (!meaningfulHorizontalMatch) return noTargetMatch(horizontalOverlapRatio);

  // If the PDF show op is much wider than the extracted run, stripping it
  // wholesale would likely erase neighbouring labels/runs that pdf.js split
  // out separately. Only allow it when the target covers most of the show,
  // which indicates the op tightly corresponds to the target box.
  const spansBeyondTarget = showWidth > targetWidth * 1.35 && showCoveredByTarget < 0.82;
  return { stripWholeOp: !spansBeyondTarget, spansBeyondTarget, horizontalOverlapRatio };
}

function noTargetMatch(horizontalOverlapRatio = 0): TextShowTargetMatch {
  return { stripWholeOp: false, spansBeyondTarget: false, horizontalOverlapRatio };
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function rectsIntersect(a: PdfRect, b: PdfRect): boolean {
  return (
    a.pdfX < b.pdfX + b.pdfWidth &&
    a.pdfX + a.pdfWidth > b.pdfX &&
    a.pdfY < b.pdfY + b.pdfHeight &&
    a.pdfY + a.pdfHeight > b.pdfY
  );
}

export function expandRect(rect: PdfRect, amount: number): PdfRect {
  return {
    pdfX: rect.pdfX - amount,
    pdfY: rect.pdfY - amount,
    pdfWidth: rect.pdfWidth + amount * 2,
    pdfHeight: rect.pdfHeight + amount * 2,
  };
}
