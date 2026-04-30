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
  /** Image / Form XObject placements on this page. Drag-movable. */
  images: import("./sourceImages").ImageInstance[];
};

export async function renderPage(
  page: PdfPage,
  scale: number,
  /** Per-page list of `Tj/TJ` text-shows we already extracted from the
   *  source PDF via pdf-lib (in `extractPageFontShows`). buildTextRuns
   *  uses this to attach a fontFamily / bold / italic to each run by
   *  matching the run's PDF-user-space baseline against the show's. */
  fontShows: import("./sourceFonts").FontShow[] = [],
  /** Per-font glyphId → Unicode reverse cmap, used to recover characters
   *  the source PDF's broken ToUnicode CMap omitted (e.g. the long-vowel
   *  Thaana fili). Keyed by PDF resource name (`F1`, `F2`, …). */
  glyphMaps: Map<string, import("./glyphMap").GlyphMap> = new Map(),
  /** Image / Form XObject placements pre-extracted by `extractPageImages`.
   *  Indexed per page in source order; we don't recompute them here. */
  images: import("./sourceImages").ImageInstance[] = [],
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

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

  // Replace pdf.js's str on each item with the authoritative text we get
  // by decoding the matching content-stream Tj bytes through the font's
  // (fixed) CID→Unicode map. This recovers chars that pdf.js's broken-
  // ToUnicode-based extraction either mapped to U+0020 (the long-vowel
  // fili case) or dropped entirely (orphan single-CID Tj's). See
  // `applyShowDecodes` for the alignment / clearing logic.
  if (glyphMaps.size > 0 && fontShows.length > 0) {
    applyShowDecodes(items, fontShows, glyphMaps, scale, viewport.height, vt);
  }

  const _fontShows = fontShows;

  return {
    pageNumber: page.pageNumber,
    canvas,
    scale,
    pdfWidth: page.view[2] - page.view[0],
    pdfHeight: page.view[3] - page.view[1],
    viewWidth: viewport.width,
    viewHeight: viewport.height,
    textItems: items,
    textRuns: buildTextRuns(items, page.pageNumber, _fontShows, scale, viewport.height),
    images,
  };
}

/**
 * For each content-stream text-show with a known glyph map, decode the
 * Tj operand bytes into Unicode and use that as the authoritative string
 * for the matching pdf.js item — overwriting whatever pdf.js extracted
 * via the (potentially broken) `/ToUnicode` CMap.
 *
 * Why not stick to pdf.js's text? Two failure modes the Office-exported
 * PDFs we target hit constantly:
 *
 *   1. The `bfrange` for the long-vowel fili glyphs has the entry for
 *      aabaafili (U+07A7) corrupted to U+0020 (space). pdf.js dutifully
 *      extracts U+0020 wherever that CID appears.
 *   2. pdf.js sometimes splits a single Tj into two TextItems (one for
 *      the leading visual char, one for the rest of the BiDi-reordered
 *      string), and inserts spurious U+0020 between BiDi-direction
 *      transitions. Char-by-char patching on top is fragile.
 *
 * Our content-stream decode is unambiguous: bytes go in, codepoints come
 * out. We reverse for RTL (PDF paints visual L→R; we want logical
 * order), trim the CID 0x0003 padding glyphs Office uses as
 * line-start/end markers, and assign the result to whichever pdf.js
 * item lives at the show's position. Other items at the same position
 * get cleared so they don't duplicate text in the merged run. Items
 * whose font has no glyph map (no `/ToUnicode`, no usable binary cmap —
 * typically the embedded subsets for Latin punctuation) are left alone.
 */
function applyShowDecodes(
  items: TextItem[],
  fontShows: import("./sourceFonts").FontShow[],
  glyphMaps: Map<string, import("./glyphMap").GlyphMap>,
  scale: number,
  viewportHeight: number,
  viewportTransform: number[],
): void {
  // Pre-compute decoded text per show. Skip shows whose font has no
  // glyph map, whose bytes contain unmapped CIDs, or whose decoded
  // content is empty after trimming Office's CID 0x0003 padding.
  type DecodedShow = {
    show: import("./sourceFonts").FontShow;
    text: string;
  };
  const decodedShows: DecodedShow[] = [];
  for (const show of fontShows) {
    if (!show.fontResource) continue;
    const map = glyphMaps.get(show.fontResource);
    if (!map) continue;
    let decoded = decodeViaMap(show.bytes, map);
    if (decoded == null || decoded.length === 0) continue;
    const isRtl = /[֐-ࣿ\u{10800}-\u{10FFF}]/u.test(decoded);
    // Only override RTL shows. pdf.js extracts Latin / digit text
    // correctly via the same `/ToUnicode` CMap that breaks for fili —
    // claiming those items risks clearing a "29"/"2026" that pdf.js
    // already had right, in favour of a neighbouring show.
    if (!isRtl) continue;
    decoded = Array.from(decoded).reverse().join("");
    decoded = decoded.replace(/^\s+|\s+$/g, "");
    if (decoded.length === 0) continue;
    decodedShows.push({ show, text: decoded });
  }

  // Bucket DecodedShow's by quantised PDF-y so closest-show lookup is
  // line-local (different lines never compete).
  const showsByY = new Map<number, DecodedShow[]>();
  for (const ds of decodedShows) {
    const yKey = Math.round(ds.show.y);
    let arr = showsByY.get(yKey);
    if (!arr) {
      arr = [];
      showsByY.set(yKey, arr);
    }
    arr.push(ds);
  }

  // Each item picks the closest show whose script matches its own.
  // pdf.js splits a single Tj into N TextItems at varying x positions
  // when the visual order differs from logical reading order — owning
  // each split item by NEAREST same-script show is what catches them
  // all without spuriously claiming a digit/Latin item that happens to
  // sit between two Thaana shows on the same line.
  const itemToShow = new Map<TextItem, DecodedShow>();
  for (const it of items) {
    const yPdf = (viewportHeight - it.transform[5]) / scale;
    const xPdf = it.transform[4] / scale;
    const yKey = Math.round(yPdf);
    const itemScript = scriptOf(it.str);
    let best: DecodedShow | null = null;
    let bestDist = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      const arr = showsByY.get(yKey + dy);
      if (!arr) continue;
      for (const ds of arr) {
        // Skip if scripts differ. An empty/whitespace-only pdf.js str
        // can claim ANY show (these are often the leading-visual-char
        // split items that pdf.js emits with a single combining mark).
        const showScript = scriptOf(ds.text);
        if (
          itemScript !== "unknown" &&
          showScript !== "unknown" &&
          itemScript !== showScript
        ) {
          continue;
        }
        const dx = Math.abs(ds.show.x - xPdf);
        if (dx < bestDist) {
          bestDist = dx;
          best = ds;
        }
      }
    }
    if (best) itemToShow.set(it, best);
  }

  // Group items by their assigned show. Then for each show, give the
  // longest item the decoded text and clear the rest. Shows with no
  // claimed items get a synthesised TextItem at their (x, y).
  const showToItems = new Map<DecodedShow, TextItem[]>();
  for (const [it, ds] of itemToShow) {
    let arr = showToItems.get(ds);
    if (!arr) {
      arr = [];
      showToItems.set(ds, arr);
    }
    arr.push(it);
  }

  let synthIndex = items.length + 100_000;
  for (const ds of decodedShows) {
    const claimed = showToItems.get(ds);
    if (!claimed || claimed.length === 0) {
      // Orphan show — synthesise an item.
      const composed = multiplyTransforms(viewportTransform, [
        12, 0, 0, 12, ds.show.x, ds.show.y,
      ]);
      // Borrow average height from any item on the same line so the
      // run-merger picks it up.
      const yKey = Math.round(ds.show.y);
      const sameLine: TextItem[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (const ds2 of showsByY.get(yKey + dy) ?? []) {
          for (const it of showToItems.get(ds2) ?? []) sameLine.push(it);
        }
      }
      const surroundingHeight =
        sameLine.length > 0
          ? sameLine.reduce((sum, it) => sum + it.height, 0) / sameLine.length
          : Math.abs(composed[3]);
      items.push({
        index: synthIndex++,
        str: ds.text,
        transform: composed,
        width: 0,
        height: surroundingHeight,
        fontName: sameLine[0]?.fontName ?? "",
        hasEOL: false,
      });
      continue;
    }
    // Pick the longest item — pdf.js puts the full BiDi-reordered string
    // in one of its split items and a single leading char in others.
    let main = claimed[0];
    for (const it of claimed) {
      if (it.str.length > main.str.length) main = it;
    }
    // The other claimed items will be cleared (str = "") and dropped by
    // buildTextRuns' visible filter, so their widths would otherwise be
    // lost from the run's bounds. Roll up the full visual span — leftmost
    // item.left → rightmost (item.left + item.width) — into `main` so the
    // overlay ends up exactly the size of the rendered glyphs. Without
    // this, a justified-paragraph Tj that pdf.js split into many narrow
    // items collapses to a single ~one-word-wide overlay even though the
    // decoded text covers the whole line.
    let claimedLeft = Infinity;
    let claimedRight = -Infinity;
    for (const it of claimed) {
      const left = it.transform[4];
      const right = left + (it.width || 0);
      if (left < claimedLeft) claimedLeft = left;
      if (right > claimedRight) claimedRight = right;
    }
    if (Number.isFinite(claimedLeft) && Number.isFinite(claimedRight)) {
      // transform is shared/by-reference; clone before mutating tx so we
      // don't accidentally shift other items (TextItem.transform arrays
      // come straight from pdf.js).
      main.transform = main.transform.slice();
      main.transform[4] = claimedLeft;
      main.width = Math.max(claimedRight - claimedLeft, main.width);
    }
    main.str = ds.text;
    for (const it of claimed) {
      if (it !== main) it.str = "";
    }
  }
}

/** Coarse script classification used to keep `applyShowDecodes` from
 *  claiming an item with a different script than the show. We only
 *  distinguish the cases we care about: Thaana / Arabic vs everything
 *  else (Latin / digits / punctuation). Empty or whitespace-only strings
 *  return "unknown" so they can be claimed by any show — those are the
 *  leading-visual-char split items pdf.js emits with a single combining
 *  mark and no real script signal. */
function scriptOf(text: string): "rtl" | "ltr" | "unknown" {
  let hasRtl = false;
  let hasLtr = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x0590 && cp <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana, Arabic Supplement
      (cp >= 0xfb1d && cp <= 0xfdff) || // Arabic Presentation Forms-A
      (cp >= 0xfe70 && cp <= 0xfeff) || // Arabic Presentation Forms-B
      (cp >= 0x10800 && cp <= 0x10fff) // older RTL scripts
    ) {
      hasRtl = true;
    } else if (
      (cp >= 0x0030 && cp <= 0x0039) || // ASCII digits
      (cp >= 0x0041 && cp <= 0x005a) || // ASCII upper
      (cp >= 0x0061 && cp <= 0x007a) // ASCII lower
    ) {
      hasLtr = true;
    }
  }
  if (hasRtl) return "rtl";
  if (hasLtr) return "ltr";
  return "unknown";
}

/** Decode a content-stream Tj operand using the font's CID → Unicode
 *  map. Returns null if any CID is missing from the map — the caller
 *  should leave the corresponding pdf.js item alone rather than risk
 *  overwriting it with a partially-decoded string (or a string of
 *  silent placeholders). */
function decodeViaMap(
  bytes: Uint8Array,
  map: import("./glyphMap").GlyphMap,
): string | null {
  const isIdentity = map.encoding.startsWith("Identity");
  let out = "";
  if (isIdentity) {
    if (bytes.length % 2 !== 0) return null;
    for (let i = 0; i < bytes.length; i += 2) {
      const cid = (bytes[i] << 8) | bytes[i + 1];
      const cp = map.toUnicode.get(cid);
      if (cp == null) return null;
      out += String.fromCodePoint(cp);
    }
  } else {
    for (let i = 0; i < bytes.length; i++) {
      const cp = map.toUnicode.get(bytes[i]);
      if (cp == null) return null;
      out += String.fromCodePoint(cp);
    }
  }
  return out;
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
  fontShows: import("./sourceFonts").FontShow[],
  scale: number,
  viewportHeight: number,
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
    let prevItem: TextItem | null = null;
    for (const it of ordered) {
      const [, , , scaleY, tx, ty] = it.transform;
      const h = Math.abs(scaleY);
      const left = tx;
      const right = tx + (it.width || h * 0.3);
      minLeft = Math.min(minLeft, left);
      maxRight = Math.max(maxRight, right);
      maxHeight = Math.max(maxHeight, h);
      baselineY = ty;
      // Insert an inter-word space when the visual gap between this item
      // and the previous one (in logical reading order) is larger than
      // ~12% of the line height. Authoritative content-stream decodes
      // (applyShowDecodes) strip the CID 0x0003 padding glyphs Office
      // uses as Tj-leading whitespace markers, so without this the items
      // get glued together when they really should be separate words.
      if (prevItem && it.str.length > 0) {
        const wordGap = horizontalGap(prevItem, it);
        if (wordGap > h * 0.12 && !text.endsWith(" ") && !it.str.startsWith(" ")) {
          text += " ";
        }
      }
      text += it.str;
      if (it.str.length > 0) prevItem = it;
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

    // Convert the run's baseline (viewport-y, y-down) back to PDF user
    // space (y-up) so we can match it against the source-extracted font
    // shows.
    const runPdfX = minLeft / scale;
    const runPdfY = (viewportHeight - baselineY) / scale;
    let bestShow: import("./sourceFonts").FontShow | null = null;
    let bestDist = Infinity;
    for (const s of fontShows) {
      const dy = Math.abs(s.y - runPdfY);
      if (dy > 4) continue; // different line — skip
      const dx = Math.abs(s.x - runPdfX);
      const dist = dx + dy * 10;
      if (dist < bestDist) {
        bestDist = dist;
        bestShow = s;
      }
    }
    const baseName = bestShow?.baseFont ?? null;
    const fontFamily = resolveFamilyFromHint(baseName);

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
      fontBaseName: baseName,
      bold: bestShow?.bold ?? false,
      italic: bestShow?.italic ?? false,
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
