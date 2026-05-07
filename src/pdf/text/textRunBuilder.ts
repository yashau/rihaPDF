import { FONTS, resolveFamilyFromHint } from "@/pdf/text/fonts";
import { scriptOf } from "@/pdf/text/pdfTextScript";
import type { TextItem, TextRun } from "@/pdf/render/pdfTypes";
import type { FontShow } from "@/pdf/source/sourceFonts";

function isListMarkerText(text: string): boolean {
  return /^[\d.()[\]/-]+$/.test(text.trim());
}

function cssSpaceWidth(
  fontFamily: string,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): number {
  if (typeof document === "undefined") return fontSizePx * 0.25;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return fontSizePx * 0.25;
  ctx.font = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${fontSizePx}px "${fontFamily}"`;
  const width = ctx.measureText(" ").width;
  return width > 0 ? width : fontSizePx * 0.25;
}

function spacesForVisualGap(
  gapPx: number,
  fontFamily: string,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): number {
  return Math.max(1, Math.round(gapPx / cssSpaceWidth(fontFamily, fontSizePx, bold, italic)));
}

// Strong-RTL Unicode ranges: Hebrew, Arabic, Thaana, Syriac, plus the
// Arabic Presentation Forms blocks. Used to detect run direction.
const RTL_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE\u{10800}-\u{10FFF}]/u;
const THAANA_REGEX = /[\u0780-\u07bf]/u;
const THAANA_FONT_FAMILIES = new Set(
  FONTS.filter((f) => f.script === "thaana").map((f) => f.family),
);

function isRtlText(text: string): boolean {
  return RTL_REGEX.test(text);
}

function isThaanaText(text: string): boolean {
  return THAANA_REGEX.test(text);
}

function baseFontTargetsThaana(baseName: string | null | undefined): boolean {
  return THAANA_FONT_FAMILIES.has(resolveFamilyFromHint(baseName, null));
}

/**
 * Sort items inside a single run into logical reading order using x-position.
 *
 *  - LTR: ascending x (leftmost = first logical char)
 *  - RTL: descending x (rightmost = first logical char)
 *
 * Tiebreaker (same x): the wider glyph comes first so base letters
 * precede zero-width combining marks.
 */
function sortItemsLogical(items: TextItem[], rtl: boolean): TextItem[] {
  const cmp = (a: TextItem, b: TextItem) => {
    const edge = (it: TextItem) => {
      const left = it.transform[4];
      const width = it.width || Math.abs(it.transform[3]) * 0.3;
      return rtl ? left + width : left;
    };
    const ax = edge(a);
    const bx = edge(b);
    const xDelta = rtl ? bx - ax : ax - bx;
    if (Math.abs(xDelta) > 1) return xDelta;
    return (b.width || 0) - (a.width || 0);
  };
  return [...items].sort(cmp);
}

function itemCaretStartEnd(it: TextItem): { startX: number; endX: number } {
  const left = it.transform[4];
  const width = it.width || it.height * 0.3;
  const right = left + width;
  return scriptOf(it.str) === "rtl" ? { startX: right, endX: left } : { startX: left, endX: right };
}

function caretGapPiece(prevItem: TextItem, it: TextItem): CaretPiece {
  const prevEndX = itemCaretStartEnd(prevItem).endX;
  const currentStartX = itemCaretStartEnd(it).startX;
  return { text: " ", startX: prevEndX, endX: currentStartX };
}

const COMBINING_MARK_RE = /^[ަ-ްً-ٰٟۖ-ۭ]$/u;

function fontShowForItem(it: TextItem, fontShowsByOpIndex: Map<number, FontShow>): FontShow | null {
  const ops = Array.from(new Set(it.contentStreamOpIndices ?? []));
  if (ops.length !== 1) return null;
  return fontShowsByOpIndex.get(ops[0]) ?? null;
}

type CaretPiece = { text: string; startX: number; endX: number };

function isCombiningMark(text: string): boolean {
  return COMBINING_MARK_RE.test(text);
}

function buildVisualPiecesFromCaretPieces(
  pieces: CaretPiece[],
  minLeft: number,
): TextRun["visualPieces"] {
  const clusters: Array<{ text: string; left: number; right: number }> = [];
  for (const piece of pieces) {
    if (piece.text.length === 0) continue;
    for (let i = 0; i < piece.text.length; i++) {
      const ch = piece.text[i];
      if (/\s/u.test(ch)) continue;
      const beforeT = i / piece.text.length;
      const afterT = (i + 1) / piece.text.length;
      const startX = piece.startX + (piece.endX - piece.startX) * beforeT;
      const endX = piece.startX + (piece.endX - piece.startX) * afterT;
      const left = Math.min(startX, endX);
      const right = Math.max(startX, endX);
      const prev = clusters[clusters.length - 1];
      if (prev && isCombiningMark(ch)) {
        prev.text += ch;
        prev.left = Math.min(prev.left, left);
        prev.right = Math.max(prev.right, right);
      } else {
        clusters.push({ text: ch, left, right });
      }
    }
  }
  return clusters
    .map((cluster) => ({
      text: cluster.text,
      left: cluster.left - minLeft,
      width: Math.max(cluster.right - cluster.left, 1),
    }))
    .sort((a, b) => a.left - b.left);
}

function buildVisualPiecesFromItems(items: TextItem[], minLeft: number): TextRun["visualPieces"] {
  const pieces = items.flatMap((item) => item.visualPieces ?? []);
  if (pieces.length === 0) return undefined;
  return pieces
    .map((piece) => ({
      text: piece.text,
      left: piece.left - minLeft,
      width: piece.width,
    }))
    .sort((a, b) => a.left - b.left);
}

function caretPiecesForItem(
  it: TextItem,
  fontShowsByOpIndex: Map<number, FontShow>,
  scale: number,
): CaretPiece[] {
  const show = fontShowForItem(it, fontShowsByOpIndex);
  if (show?.glyphSpans && show.glyphSpans.length >= it.str.length) {
    const spans =
      scriptOf(it.str) === "rtl" ? [...show.glyphSpans].reverse() : [...show.glyphSpans];
    spans.length = it.str.length;
    return spans.map((span, i) => {
      const left = Math.min(span.x0, span.x1) * scale;
      const right = Math.max(span.x0, span.x1) * scale;
      return scriptOf(it.str[i]) === "rtl"
        ? { text: it.str[i], startX: right, endX: left }
        : { text: it.str[i], startX: left, endX: right };
    });
  }

  const span = itemCaretStartEnd(it);
  return [{ text: it.str, ...span }];
}

function itemLogicalEdges(pieces: CaretPiece[]): { startX: number; endX: number } | null {
  const first = pieces.find((piece) => piece.text.length > 0);
  const last = pieces.findLast((piece) => piece.text.length > 0);
  if (!first || !last) return null;
  return { startX: first.startX, endX: last.endX };
}

function buildCaretPositionsFromPieces(pieces: CaretPiece[]): {
  text: string;
  caretPositions: Array<{ offset: number; x: number }>;
} {
  const chars: Array<{ ch: string; beforeX: number; afterX: number }> = [];
  for (const piece of pieces) {
    const len = piece.text.length;
    if (len === 0) continue;
    for (let i = 0; i < len; i++) {
      const beforeT = i / len;
      const afterT = (i + 1) / len;
      chars.push({
        ch: piece.text[i],
        beforeX: piece.startX + (piece.endX - piece.startX) * beforeT,
        afterX: piece.startX + (piece.endX - piece.startX) * afterT,
      });
    }
  }

  const kept: typeof chars = [];
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i].ch)) {
      let end = i + 1;
      while (end < chars.length && /\s/.test(chars[end].ch)) end++;
      if (end < chars.length && COMBINING_MARK_RE.test(chars[end].ch)) {
        i = end - 1;
        continue;
      }
    }
    kept.push(chars[i]);
  }

  const caretPositions: Array<{ offset: number; x: number }> = [];
  let text = "";
  for (let offset = 0; offset < kept.length; offset++) {
    const ch = kept[offset];
    text += ch.ch;
    caretPositions.push({ offset, x: ch.beforeX });
    caretPositions.push({ offset: offset + 1, x: ch.afterX });
  }
  return { text, caretPositions };
}

/**
 * Group adjacent items on the same line into editable runs.
 *
 * Same-line: baselines within 30 % of the larger height.
 * Same-run:  bounding boxes overlap horizontally OR gap < 0.5 × line height
 *            (direction-agnostic so RTL items at decreasing x merge cleanly).
 */
export function buildTextRuns(
  items: TextItem[],
  pageNumber: number,
  fontShows: FontShow[],
  scale: number,
  viewportHeight: number,
): TextRun[] {
  const visible = items.filter((it) => it.str.length > 0);
  if (visible.length === 0) return [];

  const horizontalGap = (a: TextItem, b: TextItem) => {
    const aLeft = a.gapLeft ?? a.transform[4];
    const aRight = a.gapRight ?? aLeft + (a.width || a.height * 0.3);
    const bLeft = b.gapLeft ?? b.transform[4];
    const bRight = b.gapRight ?? bLeft + (b.width || b.height * 0.3);
    if (aRight >= bLeft && bRight >= aLeft) return 0;
    return Math.min(Math.abs(bLeft - aRight), Math.abs(aLeft - bRight));
  };

  const runs: TextRun[] = [];
  let bucket: TextItem[] = [];
  let runIndex = 0;
  const fontShowsByOpIndex = new Map(fontShows.map((s) => [s.opIndex, s]));
  const piecesByItem = new Map<TextItem, CaretPiece[]>();
  const piecesFor = (it: TextItem) => {
    let pieces = piecesByItem.get(it);
    if (!pieces) {
      pieces = caretPiecesForItem(it, fontShowsByOpIndex, scale);
      piecesByItem.set(it, pieces);
    }
    return pieces;
  };
  const logicalGap = (a: TextItem, b: TextItem) => {
    const aEdges = itemLogicalEdges(piecesFor(a)) ?? itemCaretStartEnd(a);
    const bEdges = itemLogicalEdges(piecesFor(b)) ?? itemCaretStartEnd(b);
    return Math.abs(bEdges.startX - aEdges.endX);
  };

  const flush = () => {
    if (bucket.length === 0) return;
    const rtl = bucket.some((it) => isRtlText(it.str));
    const ordered = sortItemsLogical(bucket, rtl);
    const gapPlaceholders = new Map<string, { gapPx: number; startX: number; endX: number }>();
    const caretPieces: Array<{ text: string; startX: number; endX: number }> = [];

    let minLeft = Infinity;
    let maxRight = -Infinity;
    let maxHeight = 0;
    let baselineY = 0;
    let text = "";
    const sourceIndices: number[] = [];
    const opIndexSet = new Set<number>();
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
      if (prevItem && it.str.length > 0) {
        const mixedScript = scriptOf(prevItem.str) !== scriptOf(it.str);
        const visualGap = horizontalGap(prevItem, it);
        const hiddenLogicalGap = mixedScript ? logicalGap(prevItem, it) : 0;
        const wordGap = Math.max(visualGap, hiddenLogicalGap);
        if (wordGap > h * 0.12 && !text.endsWith(" ") && !it.str.startsWith(" ")) {
          const tabLikeListGap =
            scriptOf(prevItem.str) === "ltr" &&
            scriptOf(it.str) === "rtl" &&
            isListMarkerText(text);
          if (tabLikeListGap) {
            const marker = `\u{e000}${gapPlaceholders.size}\u{e001}`;
            const gapPiece = caretGapPiece(prevItem, it);
            gapPlaceholders.set(marker, {
              gapPx: visualGap,
              startX: gapPiece.startX,
              endX: gapPiece.endX,
            });
            caretPieces.push({ ...gapPiece, text: marker });
            text += marker;
          } else {
            caretPieces.push(caretGapPiece(prevItem, it));
            text += " ";
          }
        }
      }
      caretPieces.push(...piecesFor(it));
      text += it.str;
      if (it.str.length > 0) prevItem = it;
      sourceIndices.push(it.index);
      for (const op of it.contentStreamOpIndices ?? []) opIndexSet.add(op);
    }

    const topPad = maxHeight * 0.2;
    const bottomPad = maxHeight * 0.1;
    const top = baselineY - maxHeight - topPad;
    const bottom = baselineY + bottomPad;

    const runPdfX = minLeft / scale;
    const runPdfY = (viewportHeight - baselineY) / scale;
    const showCandidates: Array<{
      show: FontShow;
      dist: number;
      owned: boolean;
    }> = [];
    for (const s of fontShows) {
      const dy = Math.abs(s.y - runPdfY);
      if (dy > 4) continue;
      const dx = Math.abs(s.x - runPdfX);
      const dist = dx + dy * 10;
      showCandidates.push({ show: s, dist, owned: opIndexSet.has(s.opIndex) });
    }
    const ownedCandidates = showCandidates.filter((c) => c.owned);
    let preferredCandidates = ownedCandidates.length > 0 ? ownedCandidates : showCandidates;
    if (isThaanaText(text)) {
      const thaanaCandidates = preferredCandidates.filter((c) =>
        baseFontTargetsThaana(c.show.baseFont),
      );
      if (thaanaCandidates.length > 0) preferredCandidates = thaanaCandidates;
    }
    let bestShow: FontShow | null = null;
    let bestDist = Infinity;
    for (const c of preferredCandidates) {
      if (
        ownedCandidates.length > 0
          ? c.show.bytes.length > (bestShow?.bytes.length ?? -1) ||
            (c.show.bytes.length === (bestShow?.bytes.length ?? -1) && c.dist < bestDist)
          : c.dist < bestDist
      ) {
        bestDist = c.dist;
        bestShow = c.show;
      }
    }
    const baseName = bestShow?.baseFont ?? null;
    const fontFamily = resolveFamilyFromHint(baseName, text);
    if (gapPlaceholders.size > 0) {
      for (const [marker, gap] of gapPlaceholders) {
        const spaces = spacesForVisualGap(
          gap.gapPx,
          fontFamily,
          maxHeight,
          bestShow?.bold ?? false,
          bestShow?.italic ?? false,
        );
        text = text.replace(marker, " ".repeat(spaces));
        for (const piece of caretPieces) {
          if (piece.text === marker) piece.text = " ".repeat(spaces);
        }
      }
    }
    const caret = buildCaretPositionsFromPieces(caretPieces);
    text = caret.text;

    const exactVisualPieces = buildVisualPiecesFromItems(bucket, minLeft);

    runs.push({
      id: `p${pageNumber}-r${runIndex++}`,
      sourceIndices,
      contentStreamOpIndices: Array.from(opIndexSet).sort((a, b) => a - b),
      text,
      caretPositions: caret.caretPositions,
      visualPieces: exactVisualPieces ?? buildVisualPiecesFromCaretPieces(caretPieces, minLeft),
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
      Math.abs(item.transform[5] - prev.transform[5]) < Math.max(item.height, prev.height) * 0.3;
    if (!sameLine) {
      flush();
      bucket.push(item);
      continue;
    }
    const gap = horizontalGap(prev, item);
    const mergeThreshold = Math.max(item.height, prev.height) * 1.5;
    const mixedListMarkerGap =
      scriptOf(prev.str) !== scriptOf(item.str) && gap < Math.max(item.height, prev.height) * 2;
    const leadingListMarkerLine =
      bucket.length === 1 && isListMarkerText(bucket[0].str) && scriptOf(item.str) === "rtl";
    const activeListMarkerLine = bucket.length > 1 && isListMarkerText(bucket[0].str);
    if (
      gap < mergeThreshold ||
      mixedListMarkerGap ||
      leadingListMarkerLine ||
      activeListMarkerLine
    ) {
      bucket.push(item);
    } else {
      flush();
      bucket.push(item);
    }
  }
  flush();
  return runs;
}
