import {
  PDFFont,
  PDFPage,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import type { AnnotationColor } from "@/domain/annotations";
import { DEFAULT_TEXT_COLOR } from "@/domain/color";
import { DEFAULT_FONT_FAMILY, FONTS } from "../fonts";
import { drawShapedText, measureShapedWidth } from "../shapedDraw";
import { drawMixedShapedText, isMixedScriptText, measureMixedWidth } from "../shapedBidi";
import {
  fontHasNativeItalic,
  ITALIC_SHEAR,
  type EmbeddedFontFactory,
  type LoadedSourceContext,
} from "./context";
import type { CrossSourceDrawPlan, SameSourceDrawPlan } from "./streamSurgery";

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
  const drawY = baselineYPdf;

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
