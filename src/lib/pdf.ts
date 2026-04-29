import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { resolveFamilyFromHint } from "./fonts";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** 6-element affine transform: [a, b, c, d, tx, ty]. */
type Mat = number[];

function multiplyTransforms(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export type PdfDoc = pdfjsLib.PDFDocumentProxy;
export type PdfPage = pdfjsLib.PDFPageProxy;

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data }).promise;
}

export type TextItem = {
  /** Original index into the page's text content array. Stable id for edits. */
  index: number;
  /** Logical-order string as extracted by pdf.js (BiDi-resolved). */
  str: string;
  /**
   * Full 6-element affine in *viewport pixel space*: viewport.transform ∘
   * item.transform. tx,ty are the baseline-left in viewport pixels with
   * y-down. scaleY (= |m[3]|) is the line height in viewport pixels.
   */
  transform: number[];
  /** Width in viewport pixels (already scaled). */
  width: number;
  /** Line height in viewport pixels (= |scaleY|). */
  height: number;
  /** pdf.js font ID (looked up from page.commonObjs / objs). */
  fontName: string;
  /** True for trailing whitespace-only items pdf.js inserts between runs. */
  hasEOL: boolean;
};

/**
 * A merged group of pdf.js text items that share a line and have no
 * meaningful horizontal gap between them. The unit of edit interaction.
 * Combining marks (zero-width items like Thaana fili) get folded into
 * the run with their base letter so the user edits whole words at a time.
 */
export type TextRun = {
  /** Stable id within page: "p<pageNumber>-r<runIndex>". */
  id: string;
  /** Indices into the source TextItem[] this run was built from. */
  sourceIndices: number[];
  /** Concatenated logical-order text. */
  text: string;
  /** Viewport-pixel bounding box (left, top, width, height). */
  bounds: { left: number; top: number; width: number; height: number };
  /** Font height in viewport pixels (= |scaleY|). */
  height: number;
  /** Baseline y in viewport pixels. */
  baselineY: number;
  /** Original font, resolved to one of our registered families (best
   *  effort match against the source PDF's BaseFont name). */
  fontFamily: string;
  /** Original BaseFont string from the source PDF, e.g. "ABCDEF+Faruma".
   *  Kept for diagnostics + future smarter resolution. */
  fontBaseName: string | null;
  /** Detected from the original font's flags / name suffix. */
  bold: boolean;
  italic: boolean;
};

export type RenderedPage = {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  /** Viewport scale used at render time. */
  scale: number;
  /** PDF user-space dimensions. */
  pdfWidth: number;
  pdfHeight: number;
  /** Viewport pixel dimensions. */
  viewWidth: number;
  viewHeight: number;
  textItems: TextItem[];
  textRuns: TextRun[];
};

export async function renderPage(
  page: PdfPage,
  scale: number,
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const content = await page.getTextContent();
  // pdf.js gives us text item transforms in PDF user space. We compose with
  // viewport.transform so all downstream code (overlay positioning, run
  // bounding boxes, save coord conversion) works in viewport pixel space.
  const vt = viewport.transform as Mat;
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

  // Build a per-page lookup of font metadata from pdf.js's commonObjs.
  // Each text item carries a fontName like "g_d0_f6"; commonObjs.get maps
  // that to a font object exposing the actual BaseFont name + bold/italic
  // flags from the PDF font descriptor.
  const fontInfoByName = new Map<
    string,
    { baseName: string | null; bold: boolean; italic: boolean }
  >();
  for (const item of items) {
    if (!item.fontName || fontInfoByName.has(item.fontName)) continue;
    let info: { baseName: string | null; bold: boolean; italic: boolean } = {
      baseName: null,
      bold: false,
      italic: false,
    };
    try {
      const fontObj = (page.commonObjs as unknown as {
        get(id: string): unknown;
        has(id: string): boolean;
      }).has(item.fontName)
        ? (page.commonObjs as unknown as { get(id: string): unknown }).get(
            item.fontName,
          )
        : null;
      const f = fontObj as
        | {
            name?: string;
            loadedName?: string;
            black?: boolean;
            bold?: boolean;
            italic?: boolean;
          }
        | null;
      if (f) {
        info = {
          baseName: f.name ?? f.loadedName ?? null,
          bold: !!(f.bold || f.black),
          italic: !!f.italic,
        };
      }
    } catch {
      /* ignore — fall back to default null/false */
    }
    fontInfoByName.set(item.fontName, info);
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
    textRuns: buildTextRuns(items, page.pageNumber, fontInfoByName),
  };
}

// Strong-RTL Unicode ranges: Hebrew, Arabic, Thaana, Syriac, plus the
// Arabic Presentation Forms blocks. Used to detect run direction.
const RTL_REGEX =
  /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}]/u;

function isRtlText(text: string): boolean {
  return RTL_REGEX.test(text);
}

/**
 * Remove phantom whitespace that pdf.js inserts between adjacent
 * positioning operators when extracting RTL combining sequences.
 *
 * Specifically: pdf.js's getTextContent() inserts a U+0020 between two
 * positioned items if the horizontal gap exceeds a threshold. For Thaana
 * (and Arabic) the next item is often a combining mark / fili at the
 * base letter's x — pdf.js misreads that as a word break.
 *
 * Rule: any whitespace immediately *before* a Thaana fili (U+07A6–U+07B0)
 * or Arabic combining mark (U+064B–U+065F, U+0670, U+06D6–U+06ED) is
 * dropped.
 */
function cleanCombiningSpaces(text: string): string {
  return text
    .replace(/\s+(?=[ަ-ް])/g, "")
    .replace(/\s+(?=[ً-ٰٟۖ-ۭ])/g, "");
}

/**
 * Sort items inside a single run into logical reading order using x-position.
 *
 *  - LTR: ascending x (leftmost = first logical char)
 *  - RTL: descending x (rightmost = first logical char)
 *
 * Tiebreaker (same x): the **wider** glyph comes first so that base letters
 * precede zero-width combining marks (Thaana fili, Arabic harakat) which
 * sit on top of their base.
 */
function sortItemsLogical(items: TextItem[], rtl: boolean): TextItem[] {
  const cmp = (a: TextItem, b: TextItem) => {
    const ax = a.transform[4];
    const bx = b.transform[4];
    const xDelta = rtl ? bx - ax : ax - bx;
    // Treat positions within 1px as a tie — combining marks routinely sit at
    // their base's x ± fractional offset.
    if (Math.abs(xDelta) > 1) return xDelta;
    return (b.width || 0) - (a.width || 0);
  };
  return [...items].sort(cmp);
}

/**
 * Group adjacent items on the same line into editable runs.
 *
 * Same-line: baselines within 30 % of the larger height.
 * Same-run:  bounding boxes overlap horizontally OR gap < 0.5 × line height
 *            (direction-agnostic so RTL items at decreasing x merge cleanly).
 *
 * Within each run, items are re-sorted into logical reading order by x —
 * many PDFs (especially Office exports) emit combining marks out of stream
 * order, so we can't rely on pdf.js's natural item order.
 */
function buildTextRuns(
  items: TextItem[],
  pageNumber: number,
  fontInfoByName: Map<
    string,
    { baseName: string | null; bold: boolean; italic: boolean }
  >,
): TextRun[] {
  const visible = items.filter((it) => it.str.length > 0);
  if (visible.length === 0) return [];

  const horizontalGap = (a: TextItem, b: TextItem) => {
    const aLeft = a.transform[4];
    const aRight = aLeft + (a.width || a.height * 0.3);
    const bLeft = b.transform[4];
    const bRight = bLeft + (b.width || b.height * 0.3);
    if (aRight >= bLeft && bRight >= aLeft) return 0;
    return Math.min(Math.abs(bLeft - aRight), Math.abs(aLeft - bRight));
  };

  const runs: TextRun[] = [];
  let bucket: TextItem[] = [];
  let runIndex = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const rtl = bucket.some((it) => isRtlText(it.str));
    const ordered = sortItemsLogical(bucket, rtl);

    let minLeft = Infinity;
    let maxRight = -Infinity;
    let maxHeight = 0;
    let baselineY = 0;
    let text = "";
    const sourceIndices: number[] = [];
    for (const it of ordered) {
      const [, , , scaleY, tx, ty] = it.transform;
      const h = Math.abs(scaleY);
      const left = tx;
      const right = tx + (it.width || h * 0.3);
      minLeft = Math.min(minLeft, left);
      maxRight = Math.max(maxRight, right);
      maxHeight = Math.max(maxHeight, h);
      baselineY = ty;
      text += it.str;
      sourceIndices.push(it.index);
    }
    text = cleanCombiningSpaces(text);

    // Vertical bounding box: account for Thaana fili that sit above the
    // cap height. Padding 0.20 × height up / 0.10 × down covers fili and
    // common descenders without extending too far into the next line.
    const topPad = maxHeight * 0.2;
    const bottomPad = maxHeight * 0.1;
    const top = baselineY - maxHeight - topPad;
    const bottom = baselineY + bottomPad;

    // Pick the font from the first item — runs are mostly homogeneous
    // since merging breaks on font changes (different items end up in
    // different runs when their pdf.js fontName differs and gaps grow).
    const firstFontName = ordered[0]?.fontName;
    const fontInfo = firstFontName ? fontInfoByName.get(firstFontName) : null;
    const fontFamily = resolveFamilyFromHint(fontInfo?.baseName);

    runs.push({
      id: `p${pageNumber}-r${runIndex++}`,
      sourceIndices,
      text,
      bounds: {
        left: minLeft,
        top,
        width: Math.max(maxRight - minLeft, 4),
        height: Math.max(bottom - top, maxHeight),
      },
      height: maxHeight,
      baselineY,
      fontFamily,
      fontBaseName: fontInfo?.baseName ?? null,
      bold: fontInfo?.bold ?? false,
      italic: fontInfo?.italic ?? false,
    });
    bucket = [];
  };

  for (const item of visible) {
    if (bucket.length === 0) {
      bucket.push(item);
      continue;
    }
    const prev = bucket[bucket.length - 1];
    const sameLine =
      Math.abs(item.transform[5] - prev.transform[5]) <
      Math.max(item.height, prev.height) * 0.3;
    if (!sameLine) {
      flush();
      bucket.push(item);
      continue;
    }
    const gap = horizontalGap(prev, item);
    const mergeThreshold = Math.max(item.height, prev.height) * 0.5;
    if (gap < mergeThreshold) {
      bucket.push(item);
    } else {
      flush();
      bucket.push(item);
    }
  }
  flush();
  return runs;
}

/** Convert a text item's transform into a CSS-positioned bounding box in viewport pixels. */
export function itemBoundsInViewport(item: TextItem): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const [, , , scaleY, tx, ty] = item.transform;
  const height = Math.abs(scaleY);
  return {
    left: tx,
    top: ty - height,
    width: item.width,
    height,
  };
}
