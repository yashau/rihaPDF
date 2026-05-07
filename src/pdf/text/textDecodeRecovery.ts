import type { GlyphMap } from "@/pdf/source/glyphMap";
import { multiplyTransforms } from "@/pdf/geometry/pdfTransform";
import { scriptOf } from "@/pdf/text/pdfTextScript";
import type { TextItem } from "@/pdf/render/pdfTypes";
import type { FontShow } from "@/pdf/source/sourceFonts";

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
export function applyShowDecodes(
  items: TextItem[],
  fontShows: FontShow[],
  glyphMaps: Map<string, GlyphMap>,
  scale: number,
  viewportHeight: number,
  viewportTransform: number[],
): void {
  type DecodedShow = {
    show: FontShow;
    text: string;
    visualPieces?: NonNullable<TextItem["visualPieces"]>;
  };
  const decodedShows: DecodedShow[] = [];
  for (const show of fontShows) {
    if (!show.fontResource) continue;
    const map = glyphMaps.get(show.fontResource);
    if (!map) continue;
    let decoded = decodeViaMap(show.bytes, map);
    if (decoded == null || decoded.length === 0) continue;
    const visualPieces = visualPiecesForShow(show, decoded, scale, viewportTransform);
    const isRtl = /[֐-ࣿ\u{10800}-\u{10FFF}]/u.test(decoded);
    if (!isRtl) {
      const text = decoded.replace(/^\s+|\s+$/g, "");
      if (text.length > 0 || visualPieces) decodedShows.push({ show, text, visualPieces });
      continue;
    }
    decoded = Array.from(decoded).reverse().join("");
    decoded = decoded.replace(/^\s+|\s+$/g, "");
    if (decoded.length === 0) continue;
    decodedShows.push({ show, text: decoded, visualPieces });
  }

  stampContentStreamOpsOnItems(items, fontShows, scale, viewportHeight);

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
        const showScript = scriptOf(ds.text);
        if (itemScript !== "unknown" && showScript !== "unknown" && itemScript !== showScript) {
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
      const composed = multiplyTransforms(viewportTransform, [12, 0, 0, 12, ds.show.x, ds.show.y]);
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
        contentStreamOpIndices: [ds.show.opIndex],
        visualPieces: ds.visualPieces,
      });
      continue;
    }

    let main = claimed[0];
    for (const it of claimed) {
      if (it.str.length > main.str.length) main = it;
    }

    let claimedLeft = Infinity;
    let claimedRight = -Infinity;
    let gapLeft = Infinity;
    let gapRight = -Infinity;
    for (const it of claimed) {
      const left = it.transform[4];
      const right = left + (it.width || 0);
      if (left < claimedLeft) claimedLeft = left;
      if (right > claimedRight) claimedRight = right;
      if (it.str.trim().length > 0 && scriptOf(it.str) === scriptOf(ds.text)) {
        if (left < gapLeft) gapLeft = left;
        if (right > gapRight) gapRight = right;
      }
    }
    if (Number.isFinite(claimedLeft) && Number.isFinite(claimedRight)) {
      main.transform = main.transform.slice();
      main.transform[4] = claimedLeft;
      main.width = Math.max(claimedRight - claimedLeft, main.width);
      if (Number.isFinite(gapLeft) && Number.isFinite(gapRight)) {
        main.gapLeft = gapLeft;
        main.gapRight = gapRight;
      }
    }
    main.str = ds.text;
    main.contentStreamOpIndices = [...(main.contentStreamOpIndices ?? []), ds.show.opIndex];
    main.visualPieces = [...(main.visualPieces ?? []), ...(ds.visualPieces ?? [])];
    for (const it of claimed) {
      if (it !== main) {
        it.str = "";
        it.contentStreamOpIndices = [...(it.contentStreamOpIndices ?? []), ds.show.opIndex];
      }
    }
  }
}

function viewportX(viewportTransform: number[], x: number, y: number): number {
  return viewportTransform[0] * x + viewportTransform[2] * y + viewportTransform[4];
}

function visualPiecesForShow(
  show: FontShow,
  decodedText: string,
  scale: number,
  viewportTransform: number[],
): NonNullable<TextItem["visualPieces"]> | undefined {
  if (!show.glyphSpans || show.glyphSpans.length === 0) return undefined;
  const chars = Array.from(decodedText);
  const count = Math.min(chars.length, show.glyphSpans.length);
  const pieces: NonNullable<TextItem["visualPieces"]> = [];
  for (let i = 0; i < count; i++) {
    const text = chars[i];
    if (/\s/u.test(text)) continue;
    const span = show.glyphSpans[i];
    const x0 = viewportX(viewportTransform, span.x0, show.y);
    const x1 = viewportX(viewportTransform, span.x1, show.y);
    const left = Math.min(x0, x1);
    const width = Math.max(Math.abs(x1 - x0), scale);
    pieces.push({ text, left, width });
  }
  return pieces.length > 0 ? pieces : undefined;
}

/** Pair every content-stream Tj/TJ show with the closest pdf.js item
 *  and stamp the show's op index onto that item's metadata. */
function stampContentStreamOpsOnItems(
  items: TextItem[],
  fontShows: FontShow[],
  scale: number,
  viewportHeight: number,
): void {
  if (items.length === 0 || fontShows.length === 0) return;
  const itemPdf = items.map((it) => ({
    it,
    x: it.transform[4] / scale,
    y: (viewportHeight - it.transform[5]) / scale,
  }));
  for (const show of fontShows) {
    let best: TextItem | null = null;
    let bestCost = Infinity;
    for (const ip of itemPdf) {
      const dy = Math.abs(ip.y - show.y);
      if (dy > 6) continue;
      const dx = Math.abs(ip.x - show.x);
      const cost = dx + dy * 50;
      if (cost < bestCost) {
        bestCost = cost;
        best = ip.it;
      }
    }
    if (!best) continue;
    const list = best.contentStreamOpIndices ?? [];
    if (!list.includes(show.opIndex)) list.push(show.opIndex);
    best.contentStreamOpIndices = list;
  }
}

/** Decode a content-stream Tj operand using the font's CID → Unicode map. */
function decodeViaMap(bytes: Uint8Array, map: GlyphMap): string | null {
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
