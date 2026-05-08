import {
  PDFFont,
  PDFPage,
  clip,
  concatTransformationMatrix,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from "pdf-lib";
import bidiFactory from "bidi-js";
import type { AnnotationColor } from "@/domain/annotations";
import { DEFAULT_TEXT_COLOR } from "@/domain/color";
import type { EditStyle } from "@/domain/editStyle";
import { richTextOrPlain, type RichTextBlock, type RichTextSpan } from "@/domain/richText";
import type { TextAlignment } from "@/domain/textAlignment";
import { DEFAULT_FONT_FAMILY, FONTS } from "@/pdf/text/fonts";
import { drawShapedText, measureShapedWidth } from "@/pdf/text/shapedDraw";
import { drawMixedShapedText, isMixedScriptText, measureMixedWidth } from "@/pdf/text/shapedBidi";
import {
  fontHasNativeItalic,
  ITALIC_SHEAR,
  type EmbeddedFontFactory,
  type LoadedSourceContext,
} from "./context";
import type {
  CrossSourceDrawPlan,
  RichTextLineLayoutPdf,
  SameSourceDrawPlan,
  TextClipBoxPdf,
} from "./streamSurgery";

type RichDrawLine = RichTextSpan[];
type Bidi = {
  getEmbeddingLevels(
    text: string,
    explicitDirection?: "ltr" | "rtl",
  ): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
};
type RichDrawToken = RichTextSpan & {
  level?: number;
};

let bidiInstance: Bidi | null = null;

function getBidi(): Bidi {
  if (!bidiInstance) {
    const factory = bidiFactory as () => Bidi;
    bidiInstance = factory();
  }
  return bidiInstance;
}

function splitRichTextLines(block: RichTextBlock): RichDrawLine[] {
  const lines: RichDrawLine[] = [[]];
  for (const span of block.spans) {
    const parts = span.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1].push({ text: part, style: span.style });
    });
  }
  return lines.length > 0 ? lines : [[]];
}

function richTextWithSoftLineBreaks(block: RichTextBlock): RichTextBlock {
  const spans: RichTextSpan[] = [];
  block.spans.forEach((span, spanIndex) => {
    const text = span.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ");
    if (text.length === 0) return;
    if (spans.length > 0 && spanIndex > 0) spans.push({ text: " " });
    spans.push({ text, style: span.style });
  });
  return {
    text: spans.map((span) => span.text).join(""),
    spans,
  };
}

function trimLeadingLineSpaces(line: RichDrawLine): RichDrawLine {
  let trimming = true;
  return line
    .map((span) => {
      if (!trimming) return span;
      const text = span.text.replace(/^\s+/, "");
      if (text.length > 0) trimming = false;
      return { ...span, text };
    })
    .filter((span) => span.text.length > 0);
}

function splitLineTokens(line: RichDrawLine): RichDrawToken[] {
  const tokens: RichDrawToken[] = [];
  for (const span of line) {
    for (const part of span.text.split(/(\s+|\d+(?:[./:-]\d+)+|\d+|\p{P}+)/u)) {
      if (part.length > 0) tokens.push({ text: part, style: span.style });
    }
  }
  return tokens;
}

function splitLineWrapTokens(line: RichDrawLine): RichDrawToken[] {
  const tokens: RichDrawToken[] = [];
  for (const span of line) {
    for (const part of span.text.split(/(\s+)/u)) {
      if (part.length > 0) tokens.push({ text: part, style: span.style });
    }
  }
  return tokens;
}

function isWhitespaceToken(span: RichTextSpan): boolean {
  return span.text.length > 0 && span.text.trim().length === 0;
}

function mirrorRtlPunctuation(text: string, level: number | undefined): string {
  if (level === undefined || level % 2 === 0) return text;
  return text.replace(/[()]/gu, (ch) => (ch === "(" ? ")" : "("));
}

function rtlVisualTokens(line: RichDrawLine): RichDrawToken[] {
  const tokens = splitLineTokens(line);
  const text = tokens.map((token) => token.text).join("");
  if (text.length === 0) return tokens;
  const levels = getBidi().getEmbeddingLevels(text, "rtl").levels;
  let offset = 0;
  const withLevels = tokens.map((token) => {
    const start = offset;
    offset += token.text.length;
    let level = levels[start] ?? 1;
    for (let i = start + 1; i < offset; i++) level = Math.max(level, levels[i] ?? level);
    return { ...token, level, text: mirrorRtlPunctuation(token.text, level) };
  });
  return reorderTokensToVisual(withLevels);
}

function reorderTokensToVisual<T extends { level?: number }>(tokens: T[]): T[] {
  let maxLevel = 0;
  let minOddLevel = Infinity;
  for (const token of tokens) {
    const level = token.level ?? 0;
    maxLevel = Math.max(maxLevel, level);
    if (level % 2 === 1) minOddLevel = Math.min(minOddLevel, level);
  }
  if (minOddLevel === Infinity) return tokens.slice();

  const ordered = tokens.slice();
  for (let level = maxLevel; level >= minOddLevel; level--) {
    let runStart = -1;
    for (let i = 0; i <= ordered.length; i++) {
      const inRun = i < ordered.length && (ordered[i].level ?? 0) >= level;
      if (inRun && runStart === -1) {
        runStart = i;
      } else if (!inRun && runStart !== -1) {
        ordered.splice(runStart, i - runStart, ...ordered.slice(runStart, i).reverse());
        runStart = -1;
      }
    }
  }
  return ordered;
}

function spaceCount(line: RichDrawLine): number {
  return line.reduce((sum, span) => sum + (span.text.match(/\s/gu)?.length ?? 0), 0);
}

function mergeStyle(base: EditStyle, override: EditStyle | undefined): EditStyle {
  return { ...base, ...override, color: override?.color ?? base.color };
}

function styleOverridesFallback(
  style: EditStyle | undefined,
  fallback: {
    family: string;
    fontSizePt: number;
    bold: boolean;
    italic: boolean;
    dir: "rtl" | "ltr" | undefined;
  },
): boolean {
  if (!style) return false;
  return (
    (style.fontFamily !== undefined && style.fontFamily !== fallback.family) ||
    (style.fontSize !== undefined && style.fontSize !== fallback.fontSizePt) ||
    (style.bold !== undefined && style.bold !== fallback.bold) ||
    (style.italic !== undefined && style.italic !== fallback.italic) ||
    style.underline !== undefined ||
    style.strikethrough !== undefined ||
    style.color !== undefined ||
    (style.dir !== undefined && style.dir !== fallback.dir)
  );
}

function lineHasDrawStyleOverride(
  line: RichDrawLine,
  baseStyle: EditStyle,
  fallback: {
    family: string;
    fontSizePt: number;
    bold: boolean;
    italic: boolean;
    dir: "rtl" | "ltr" | undefined;
  },
): boolean {
  return (
    styleOverridesFallback(baseStyle, fallback) ||
    line.some((span) => styleOverridesFallback(span.style, fallback))
  );
}

function alignedLineStart(x: number, width: number, lineWidth: number, align: TextAlignment) {
  if (align === "center") return x + (width - lineWidth) / 2;
  if (align === "right") return x + width - lineWidth;
  return x;
}

/** Emit underline / strikethrough rules under a freshly-drawn text run.
 *  Both decorations are simple thin horizontal lines:
 *    underline    : ~0.08 × size below the baseline
 *    strikethrough: ~0.30 × size above the baseline (mid-x-height)
 *  Pulled into a single helper so the run-edit and text-insert paths
 *  share one place to keep the geometry in sync. The pairing logic in
 *  `runDecorations.ts` uses matching offsets so a re-loaded saved PDF
 *  re-detects these as the run's decoration. */
export function drawDecorations(
  page: PDFPage,
  opts: {
    x: number;
    y: number;
    width: number;
    size: number;
    underline: boolean;
    strikethrough: boolean;
    /** Stroke color for the rule(s); falls back to black when the
     *  caller hasn't set a text color override. Kept aligned with
     *  the text fill so a colored run gets matching decorations. */
    color?: AnnotationColor;
  },
): void {
  const thickness = Math.max(0.5, opts.size * 0.05);
  const c = opts.color ?? DEFAULT_TEXT_COLOR;
  const lineColor = rgb(c[0], c[1], c[2]);
  if (opts.underline) {
    const underlineY = opts.y - Math.max(1, opts.size * 0.08);
    page.drawLine({
      start: { x: opts.x, y: underlineY },
      end: { x: opts.x + opts.width, y: underlineY },
      thickness,
      color: lineColor,
    });
  }
  if (opts.strikethrough) {
    const strikeY = opts.y + opts.size * 0.3;
    page.drawLine({
      start: { x: opts.x, y: strikeY },
      end: { x: opts.x + opts.width, y: strikeY },
      thickness,
      color: lineColor,
    });
  }
}

/** Wrap a `drawText` call with a shear-about-baseline `cm` when we need
 *  to synthesize italic. The matrix `[1 0 s 1 -s·y 0]` is shear-about-y
 *  — verticals tilt right while the baseline x at y stays fixed, so the
 *  glyphs slant forward without drifting horizontally off the run's
 *  origin.
 *
 *  Dispatches by font kind and content:
 *    - Custom Dhivehi family + mixed-script text → `drawMixedShapedText`
 *      (bidi-js segments by direction; Thaana segments shaped via HB
 *      with the user's primary; Latin segments rendered via Helvetica
 *      because Faruma has no Latin glyphs in its character set).
 *    - Custom Dhivehi family + single-direction text → `drawShapedText`
 *      (one HarfBuzz pass; GPOS mark anchoring correct for Thaana).
 *    - Standard-14 Latin family (no TTF bytes) → pdf-lib's `drawText`.
 *      fontkit's layout is fine for Latin; HarfBuzz wouldn't help and
 *      we have no bytes to feed it anyway.
 *
 *  Direction handling: when the user pinned an explicit `dir`, we honor
 *  it for single-direction shaping and skip the bidi path — the
 *  override exists exactly for cases where auto-detect misclassifies. */
export async function drawTextWithStyle(
  page: PDFPage,
  text: string,
  opts: {
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    fontBytes: Uint8Array | null;
    family: string;
    italic: boolean;
    dir: "rtl" | "ltr" | undefined;
    /** Per-doc font factory — needed only for the mixed-script path,
     *  which has to resolve a SECOND font (Helvetica for Latin spans
     *  when primary is Faruma, or Faruma for Thaana spans when primary
     *  is Latin). Single-script paths ignore it. */
    getFont: EmbeddedFontFactory;
    /** Fill color in 0..1 RGB; undefined renders black. Threaded into
     *  every dispatch branch — pdf-lib's `drawText` takes it directly,
     *  the shaped paths emit a non-stroking color setter inside their
     *  BT/ET block (wrapped in q/Q so other content keeps its state). */
    color?: AnnotationColor;
  },
): Promise<void> {
  const synth = opts.italic && !fontHasNativeItalic(opts.family);
  if (synth) {
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(1, 0, ITALIC_SHEAR, 1, -ITALIC_SHEAR * opts.y, 0),
    );
  }
  const c = opts.color ?? DEFAULT_TEXT_COLOR;
  const drawColor = rgb(c[0], c[1], c[2]);
  if (opts.dir === undefined && isMixedScriptText(text)) {
    const pair = await resolveMixedFontPair(opts.family, opts.font, opts.fontBytes, opts.getFont);
    await drawMixedShapedText(page, {
      text,
      latin: pair.latin,
      thaana: pair.thaana,
      x: opts.x,
      y: opts.y,
      size: opts.size,
      color: opts.color,
    });
  } else if (opts.fontBytes) {
    await drawShapedText(page, {
      text,
      font: opts.font,
      fontBytes: opts.fontBytes,
      x: opts.x,
      y: opts.y,
      size: opts.size,
      dir: opts.dir,
      color: opts.color,
    });
  } else {
    page.drawText(text, {
      x: opts.x,
      y: opts.y,
      size: opts.size,
      font: opts.font,
      color: drawColor,
    });
  }
  if (synth) {
    page.pushOperators(popGraphicsState());
  }
}

/** Pick the (latin, thaana) font pair the bidi path will use. The
 *  user's primary covers ITS script; the OTHER script falls back to
 *  the registry default (Arial for Latin, Faruma for Thaana). When
 *  primary IS Faruma, latin = Helvetica StandardFont (no TTF; pdf-lib
 *  draws those Latin segments directly). When primary is Arial,
 *  thaana = Faruma TTF (HB shapes those Thaana segments). */
async function resolveMixedFontPair(
  family: string,
  primaryFont: PDFFont,
  primaryBytes: Uint8Array | null,
  getFont: EmbeddedFontFactory,
): Promise<{
  latin: { font: PDFFont; bytes: Uint8Array | null };
  thaana: { font: PDFFont; bytes: Uint8Array | null };
}> {
  const def = FONTS.find((f) => f.family === family);
  const primaryIsThaana = def?.script === "thaana";
  const primary = { font: primaryFont, bytes: primaryBytes };
  if (primaryIsThaana) {
    const latinEmbed = await getFont("Arial");
    return { thaana: primary, latin: { font: latinEmbed.pdfFont, bytes: latinEmbed.bytes } };
  }
  const thaanaEmbed = await getFont(DEFAULT_FONT_FAMILY);
  return { latin: primary, thaana: { font: thaanaEmbed.pdfFont, bytes: thaanaEmbed.bytes } };
}

/** Width of `text` rendered with `font` at `size`. Routes to HarfBuzz
 *  for shaped families (whose advance widths reflect GPOS adjustments)
 *  and falls back to pdf-lib's fontkit-driven measure for standard-14.
 *  Mirrors the dispatch in `drawTextWithStyle` so RTL right-alignment
 *  math stays in sync — both must use the same width pipeline or the
 *  base x will drift relative to where the shape eventually lands. */
export async function measureTextWidth(
  text: string,
  font: PDFFont,
  fontBytes: Uint8Array | null,
  family: string,
  size: number,
  dir: "rtl" | "ltr" | undefined,
  getFont: EmbeddedFontFactory,
): Promise<number> {
  if (dir === undefined && isMixedScriptText(text)) {
    const pair = await resolveMixedFontPair(family, font, fontBytes, getFont);
    return measureMixedWidth(text, pair, size);
  }
  if (!fontBytes) return font.widthOfTextAtSize(text, size);
  return measureShapedWidth(text, fontBytes, size, dir);
}

async function measureRichLine(
  line: RichDrawLine,
  baseStyle: EditStyle,
  fallback: {
    family: string;
    fontSizePt: number;
    bold: boolean;
    italic: boolean;
    dir: "rtl" | "ltr" | undefined;
  },
  getFont: EmbeddedFontFactory,
): Promise<number> {
  let width = 0;
  for (const span of line) {
    const style = mergeStyle(baseStyle, span.style);
    const family = style.fontFamily ?? fallback.family;
    const size = style.fontSize ?? fallback.fontSizePt;
    const bold = style.bold ?? fallback.bold;
    const italic = style.italic ?? fallback.italic;
    const dir = style.dir ?? fallback.dir;
    const { pdfFont, bytes } = await getFont(family, bold, italic);
    width += await measureTextWidth(span.text, pdfFont, bytes, family, size, dir, getFont);
  }
  return width;
}

async function wrapRichLine(
  line: RichDrawLine,
  width: number,
  baseStyle: EditStyle,
  fallback: {
    family: string;
    fontSizePt: number;
    bold: boolean;
    italic: boolean;
    dir: "rtl" | "ltr" | undefined;
  },
  getFont: EmbeddedFontFactory,
): Promise<RichDrawLine[]> {
  if (line.length === 0) return [[]];
  const tokens = splitLineWrapTokens(line);
  const out: RichDrawLine[] = [];
  let current: RichDrawLine = [];
  let currentWidth = 0;
  for (const token of tokens) {
    if (current.length === 0 && isWhitespaceToken(token)) continue;
    const tokenWidth = await measureRichLine([token], baseStyle, fallback, getFont);
    if (current.length > 0 && currentWidth + tokenWidth > width) {
      out.push(current.filter((span) => !isWhitespaceToken(span) || span.text.length > 0));
      current = [];
      currentWidth = 0;
      if (isWhitespaceToken(token)) continue;
    }
    current.push(token);
    currentWidth += tokenWidth;
  }
  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : [[]];
}

async function drawTokenizedRichLine(
  page: PDFPage,
  line: RichDrawLine,
  opts: {
    x: number;
    y: number;
    width: number;
    isRtl: boolean;
    baseStyle: EditStyle;
    fallbackFamily: string;
    fallbackSize: number;
    fallbackBold: boolean;
    fallbackItalic: boolean;
    fallbackDir: "rtl" | "ltr" | undefined;
    extraSpace?: number;
    getFont: EmbeddedFontFactory;
  },
): Promise<void> {
  const tokens = opts.isRtl ? rtlVisualTokens(line) : splitLineTokens(line);
  const tokenWidths: Array<{
    span: RichDrawToken;
    width: number;
    family: string;
    fontSizePt: number;
    italic: boolean;
    dir: "rtl" | "ltr" | undefined;
    font: PDFFont;
    fontBytes: Uint8Array | null;
    style: EditStyle;
  }> = [];
  let totalWidth = 0;
  let totalSpaces = 0;
  for (const span of tokens) {
    const style = mergeStyle(opts.baseStyle, span.style);
    const family = style.fontFamily ?? opts.fallbackFamily;
    const fontSizePt = style.fontSize ?? opts.fallbackSize;
    const bold = style.bold ?? opts.fallbackBold;
    const italic = style.italic ?? opts.fallbackItalic;
    const tokenHasRtl = /[֐-׿؀-ۿހ-޿]/u.test(span.text);
    const dir = style.dir ?? (tokenHasRtl ? "rtl" : "ltr");
    const { pdfFont, bytes: fontBytes } = await opts.getFont(family, bold, italic);
    const widthPt = await measureTextWidth(
      span.text,
      pdfFont,
      fontBytes,
      family,
      fontSizePt,
      dir,
      opts.getFont,
    );
    totalWidth += widthPt;
    totalSpaces += span.text.match(/\s/gu)?.length ?? 0;
    tokenWidths.push({
      span,
      width: widthPt,
      family,
      fontSizePt,
      italic,
      dir,
      font: pdfFont,
      fontBytes,
      style,
    });
  }
  const extraWidth = (opts.extraSpace ?? 0) * totalSpaces;
  let cursorX = opts.isRtl ? opts.x + opts.width - totalWidth - extraWidth : opts.x;
  for (const item of tokenWidths) {
    const span = item.span;
    if (isWhitespaceToken(span)) {
      const spaces = span.text.match(/\s/gu)?.length ?? 0;
      cursorX += item.width + (opts.extraSpace ?? 0) * spaces;
      continue;
    }
    const drawX = cursorX;
    await drawTextWithStyle(page, span.text, {
      x: drawX,
      y: opts.y,
      size: item.fontSizePt,
      font: item.font,
      fontBytes: item.fontBytes,
      family: item.family,
      italic: item.italic,
      dir: item.dir,
      getFont: opts.getFont,
      color: item.style.color,
    });
    drawDecorations(page, {
      x: drawX,
      y: opts.y,
      width: item.width,
      size: item.fontSizePt,
      underline: item.style.underline ?? opts.baseStyle.underline ?? false,
      strikethrough: item.style.strikethrough ?? opts.baseStyle.strikethrough ?? false,
      color: item.style.color,
    });
    cursorX += item.width;
  }
}

export async function drawRichTextBlock(
  page: PDFPage,
  block: RichTextBlock,
  opts: {
    x: number;
    y: number;
    width: number;
    lineStep: number;
    lineLayouts?: RichTextLineLayoutPdf[];
    baseStyle: EditStyle;
    fallbackFamily: string;
    fallbackSize: number;
    fallbackBold: boolean;
    fallbackItalic: boolean;
    fallbackDir: "rtl" | "ltr" | undefined;
    textAlign?: TextAlignment;
    justifyWrapped?: boolean;
    softLineBreaks?: boolean;
    clipBox?: TextClipBoxPdf;
    getFont: EmbeddedFontFactory;
  },
): Promise<void> {
  if (opts.clipBox) {
    page.pushOperators(
      pushGraphicsState(),
      rectangle(opts.clipBox.x, opts.clipBox.y, opts.clipBox.width, opts.clipBox.height),
      clip(),
      endPath(),
    );
  }
  const drawBlock = opts.softLineBreaks ? richTextWithSoftLineBreaks(block) : block;
  const sourceLines = splitRichTextLines(drawBlock);
  const fallback = {
    family: opts.fallbackFamily,
    fontSizePt: opts.fallbackSize,
    bold: opts.fallbackBold,
    italic: opts.fallbackItalic,
    dir: opts.fallbackDir,
  };
  const lines: RichDrawLine[] = [];
  if (opts.lineLayouts && opts.lineLayouts.length > 0) {
    lines.push(...sourceLines);
  } else {
    for (const line of sourceLines) {
      lines.push(...(await wrapRichLine(line, opts.width, opts.baseStyle, fallback, opts.getFont)));
    }
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const layout = opts.lineLayouts?.[lineIndex];
    const line = layout ? trimLeadingLineSpaces(lines[lineIndex]) : lines[lineIndex];
    const plain = line.map((span) => span.text).join("");
    const isRtl =
      opts.baseStyle.dir === "rtl" || (opts.baseStyle.dir !== "ltr" && /[֐-׿؀-ۿހ-޿]/u.test(plain));
    const lineX = opts.x + (layout?.xOffset ?? 0);
    const lineY = opts.y - (layout?.baselineOffset ?? opts.lineStep * lineIndex);
    const targetWidth = layout?.width ?? opts.width;
    const lineWidth = await measureRichLine(line, opts.baseStyle, fallback, opts.getFont);
    const spaces = spaceCount(line);
    const hasFormattingOverride = lineHasDrawStyleOverride(line, opts.baseStyle, {
      family: opts.fallbackFamily,
      fontSizePt: opts.fallbackSize,
      bold: opts.fallbackBold,
      italic: opts.fallbackItalic,
      dir: opts.fallbackDir,
    });
    const shouldJustify =
      spaces > 0 &&
      lineWidth < targetWidth &&
      ((opts.textAlign === "justify" && lineIndex < lines.length - 1) ||
        (!opts.textAlign && layout?.justify && hasFormattingOverride) ||
        (!opts.textAlign &&
          opts.justifyWrapped === true &&
          !layout &&
          lineIndex < lines.length - 1));
    if (shouldJustify) {
      await drawTokenizedRichLine(page, line, {
        x: lineX,
        y: lineY,
        width: targetWidth,
        isRtl,
        baseStyle: opts.baseStyle,
        fallbackFamily: opts.fallbackFamily,
        fallbackSize: opts.fallbackSize,
        fallbackBold: opts.fallbackBold,
        fallbackItalic: opts.fallbackItalic,
        fallbackDir: opts.fallbackDir,
        extraSpace: (targetWidth - lineWidth) / spaces,
        getFont: opts.getFont,
      });
      continue;
    }
    if (opts.textAlign) {
      if (opts.textAlign === "justify") {
        await drawTokenizedRichLine(page, line, {
          x: lineX,
          y: lineY,
          width: targetWidth,
          isRtl,
          baseStyle: opts.baseStyle,
          fallbackFamily: opts.fallbackFamily,
          fallbackSize: opts.fallbackSize,
          fallbackBold: opts.fallbackBold,
          fallbackItalic: opts.fallbackItalic,
          fallbackDir: opts.fallbackDir,
          getFont: opts.getFont,
        });
        continue;
      }
      const lineStart = alignedLineStart(lineX, targetWidth, lineWidth, opts.textAlign);
      await drawTokenizedRichLine(page, line, {
        x: lineStart,
        y: lineY,
        width: lineWidth,
        isRtl,
        baseStyle: opts.baseStyle,
        fallbackFamily: opts.fallbackFamily,
        fallbackSize: opts.fallbackSize,
        fallbackBold: opts.fallbackBold,
        fallbackItalic: opts.fallbackItalic,
        fallbackDir: opts.fallbackDir,
        getFont: opts.getFont,
      });
      continue;
    }
    if (isRtl) {
      await drawTokenizedRichLine(page, line, {
        x: lineX,
        y: lineY,
        width: targetWidth,
        isRtl,
        baseStyle: opts.baseStyle,
        fallbackFamily: opts.fallbackFamily,
        fallbackSize: opts.fallbackSize,
        fallbackBold: opts.fallbackBold,
        fallbackItalic: opts.fallbackItalic,
        fallbackDir: opts.fallbackDir,
        getFont: opts.getFont,
      });
      continue;
    }
    let cursorX = isRtl ? lineX + targetWidth : lineX;
    for (const span of isRtl ? [...line].reverse() : line) {
      const style = mergeStyle(opts.baseStyle, span.style);
      const family = style.fontFamily ?? opts.fallbackFamily;
      const fontSizePt = style.fontSize ?? opts.fallbackSize;
      const bold = style.bold ?? opts.fallbackBold;
      const italic = style.italic ?? opts.fallbackItalic;
      const dir = style.dir ?? opts.fallbackDir;
      const { pdfFont, bytes: fontBytes } = await opts.getFont(family, bold, italic);
      const widthPt = await measureTextWidth(
        span.text,
        pdfFont,
        fontBytes,
        family,
        fontSizePt,
        dir,
        opts.getFont,
      );
      const drawX = isRtl ? cursorX - widthPt : cursorX;
      await drawTextWithStyle(page, span.text, {
        x: drawX,
        y: lineY,
        size: fontSizePt,
        font: pdfFont,
        fontBytes,
        family,
        italic,
        dir,
        getFont: opts.getFont,
        color: style.color,
      });
      drawDecorations(page, {
        x: drawX,
        y: lineY,
        width: widthPt,
        size: fontSizePt,
        underline: style.underline ?? opts.baseStyle.underline ?? false,
        strikethrough: style.strikethrough ?? opts.baseStyle.strikethrough ?? false,
        color: style.color,
      });
      cursorX += isRtl ? -widthPt : widthPt;
    }
    if (line.length === 0 && lineWidth > 0) {
      cursorX = isRtl ? lineX + targetWidth - lineWidth : lineX + lineWidth;
    }
  }
  if (opts.clipBox) {
    page.pushOperators(popGraphicsState());
  }
}

export async function emitTextDraw(
  ctx: LoadedSourceContext,
  targetPageIndex: number,
  plan: SameSourceDrawPlan | CrossSourceDrawPlan,
): Promise<void> {
  const { edit, run, boxLeftPdf, baselineYPdf, runPdfWidth, runPdfHeight } = plan;
  const targetPage = ctx.doc.getPages()[targetPageIndex];
  if (!targetPage) return;
  const style = edit.style ?? {};
  const family = style.fontFamily ?? run.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontSizePt = style.fontSize ?? runPdfHeight;
  const bold = style.bold ?? run.bold;
  const italic = style.italic ?? run.italic;
  const { pdfFont, bytes: fontBytes } = await ctx.getFont(family, bold, italic);

  // Explicit `style.dir` wins; otherwise auto-detect.
  const isRtl = style.dir === "rtl" || (style.dir !== "ltr" && /[֐-׿؀-ۿހ-޿]/u.test(edit.newText));
  const dir: "rtl" | "ltr" | undefined = style.dir;
  const justifyWrapped =
    edit.textAlign === undefined &&
    (("textAlign" in run && run.textAlign === "justify") ||
      ("isParagraph" in run && run.isParagraph && isRtl));
  // Browser text paints a little lower inside source line-layout boxes
  // than the raw PDF baseline. Apply the same visual baseline for
  // paragraph rewrites so commit and saved render stay WYSIWYG.
  const hasSourceLineLayouts = !!plan.lineLayoutsPdf && plan.lineLayoutsPdf.length > 0;
  const drawY = hasSourceLineLayouts ? baselineYPdf - fontSizePt * 0.15 : baselineYPdf;
  const softLineBreaks = !hasSourceLineLayouts && "isParagraph" in run && run.isParagraph === true;

  if (edit.richText || hasSourceLineLayouts || softLineBreaks) {
    await drawRichTextBlock(targetPage, richTextOrPlain(edit.richText, edit.newText, style), {
      x: boxLeftPdf,
      y: drawY,
      width: runPdfWidth,
      lineStep: plan.lineStepPdf ?? runPdfHeight * 1.4,
      lineLayouts: plan.lineLayoutsPdf,
      baseStyle: style,
      fallbackFamily: run.fontFamily ?? DEFAULT_FONT_FAMILY,
      fallbackSize: runPdfHeight,
      fallbackBold: run.bold,
      fallbackItalic: run.italic,
      fallbackDir: dir,
      textAlign: edit.textAlign,
      justifyWrapped,
      softLineBreaks,
      clipBox: plan.clipBoxPdf,
      getFont: ctx.getFont,
    });
    return;
  }

  if (edit.textAlign) {
    await drawRichTextBlock(targetPage, richTextOrPlain(undefined, edit.newText, style), {
      x: boxLeftPdf,
      y: drawY,
      width: runPdfWidth,
      lineStep: plan.lineStepPdf ?? runPdfHeight * 1.4,
      baseStyle: {
        ...style,
        underline: style.underline ?? run.underline ?? false,
        strikethrough: style.strikethrough ?? run.strikethrough ?? false,
      },
      fallbackFamily: run.fontFamily ?? DEFAULT_FONT_FAMILY,
      fallbackSize: runPdfHeight,
      fallbackBold: run.bold,
      fallbackItalic: run.italic,
      fallbackDir: dir,
      textAlign: edit.textAlign,
      clipBox: plan.clipBoxPdf,
      getFont: ctx.getFont,
    });
    return;
  }

  const widthPt = await measureTextWidth(
    edit.newText,
    pdfFont,
    fontBytes,
    family,
    fontSizePt,
    dir,
    ctx.getFont,
  );
  const baseX = isRtl ? boxLeftPdf + runPdfWidth - widthPt : boxLeftPdf;

  await drawTextWithStyle(targetPage, edit.newText, {
    x: baseX,
    y: drawY,
    size: fontSizePt,
    font: pdfFont,
    fontBytes,
    family,
    italic,
    dir,
    getFont: ctx.getFont,
    color: style.color,
  });

  // Effective decoration: the user's toolbar override wins; otherwise
  // inherit the source-detected run decoration so a fresh save of an
  // already-decorated run keeps its line. The strip phase removed the
  // run's `decorationOpRanges` already, so we re-emit a fresh line that
  // tracks the new geometry (text moved, font changed, etc.).
  const underline = style.underline ?? run.underline ?? false;
  const strikethrough = style.strikethrough ?? run.strikethrough ?? false;
  drawDecorations(targetPage, {
    x: baseX,
    y: drawY,
    width: widthPt,
    size: fontSizePt,
    underline,
    strikethrough,
    color: style.color,
  });
}
