// Save: real text replacement.
//
// 1. Parse each affected page's content stream into typed operations.
// 2. For each edit, find Tj/TJ operators whose text matrix lies inside the
//    edited run's bounding box and remove them — this deletes the original
//    glyphs from the PDF, so text selection / search returns the new text,
//    not the original.
// 3. Embed the bundled Dhivehi font (full, not subsetted, so HarfBuzz's
//    glyph IDs match what pdf-lib writes) and append new text-show
//    operators positioned at the run's baseline with the shaped glyphs.
//
// Multi-source: every page is addressed by (sourceKey, pageIndex). Each
// source is loaded once, the per-page content-stream surgery runs against
// THAT source's PDFDocument, and `output.copyPages` then pulls the edited
// pages out of every source in slot order. Cross-source moves are handled
// in a final phase after every source's stream surgery is committed.
//
// Multi-font: each edit can pick its own family from the registry. The
// embedded fonts are cached per (doc, family, bold, italic) across the
// save so only the actually-used fonts ship in the saved PDF.

import {
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFPage,
  PDFRef,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { TextRun } from "./pdf";
import { parseContentStream, serializeContentStream, findTextShows } from "./contentStream";
import { getPageContentBytes, setPageContentBytes } from "./pageContent";
import { DEFAULT_FONT_FAMILY, FONTS, loadFontBytes } from "./fonts";
import type { PageSlot } from "./slots";
import type { LoadedSource } from "./loadSource";
import type { Annotation } from "./annotations";
import { applyAnnotationsToDoc } from "./saveAnnotations";
import { drawShapedText, measureShapedWidth } from "./shapedDraw";

export type EditStyle = {
  /** Override of which Dhivehi font to render with. Defaults to the
   *  registry's DEFAULT_FONT_FAMILY (Faruma). */
  fontFamily?: string;
  /** Override of font size in PDF points. Defaults to the original run's
   *  rendered height. */
  fontSize?: number;
  /** Render bold via stroke + fill (simulated since most Dhivehi fonts
   *  don't ship a true bold variant). */
  bold?: boolean;
  /** Italic via shear (simulated for the same reason). */
  italic?: boolean;
  /** Underline drawn as a thin horizontal line under the text. */
  underline?: boolean;
  /** Strikethrough drawn as a thin horizontal line through the text. */
  strikethrough?: boolean;
  /** Explicit text direction. When `undefined` (the default), the
   *  draw / overlay paths auto-detect from the codepoints — Thaana
   *  / Hebrew / Arabic → "rtl", Latin → "ltr". Set explicitly when
   *  auto-detection misclassifies (e.g. an all-digit run that should
   *  render RTL inside a Dhivehi paragraph). */
  dir?: "rtl" | "ltr";
};

export type Edit = {
  /** Source the run belongs to. */
  sourceKey: string;
  /** Page index within `sourceKey`'s doc. */
  pageIndex: number;
  runId: string;
  newText: string;
  style?: EditStyle;
  /** Move offset in viewport pixels — translates the new draw position
   *  by (dx / scale, -dy / scale) in PDF user space (y-flipped). */
  dx?: number;
  dy?: number;
  /** Cross-page move target. When set and != (sourceKey, pageIndex),
   *  the run is stripped from origin and re-drawn on the target page
   *  at (targetPdfX, targetPdfY). Same-page moves use dx/dy and leave
   *  these undefined. */
  targetSourceKey?: string;
  targetPageIndex?: number;
  /** Baseline x on the target page in PDF user space (y-up). */
  targetPdfX?: number;
  /** Baseline y on the target page in PDF user space (y-up). */
  targetPdfY?: number;
  /** When true, strip the original Tj/TJ ops AND skip the replacement
   *  draw entirely. `newText`, move offsets, and cross-page fields are
   *  ignored — deletion removes the run from the saved PDF. */
  deleted?: boolean;
};

/** Drag + resize offset for an image XObject placement. Save injects a
 *  fresh outermost `cm` right after the image's `q`. dx/dy/dw/dh are
 *  in viewport pixels (same axis convention as ImageMoveValue):
 *    dx > 0 → bottom-left moves right
 *    dy > 0 → bottom-left moves DOWN in viewport (= -dy in PDF y-up)
 *    dw > 0 → wider; dh > 0 → taller
 *  (When dw == dh == 0 the cm reduces to a pure translate, matching
 *  the original move-only behavior.) */
export type ImageMove = {
  sourceKey: string;
  pageIndex: number;
  imageId: string;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  /** Cross-page move target. When set and != (sourceKey, pageIndex),
   *  the image is stripped from origin (its q…Q block removed) and
   *  re-drawn on the target. When `targetSourceKey === sourceKey` the
   *  cross-page path replicates the XObject ref into the target page
   *  resources; when sources differ the image's pixel bytes are
   *  re-embedded into the target's doc instead. */
  targetSourceKey?: string;
  targetPageIndex?: number;
  /** Bottom-left x on target page in PDF user space (y-up). */
  targetPdfX?: number;
  /** Bottom-left y on target page in PDF user space (y-up). */
  targetPdfY?: number;
  /** Width on target page in PDF user space. */
  targetPdfWidth?: number;
  /** Height on target page in PDF user space. */
  targetPdfHeight?: number;
  /** When true, strip the entire q…Q block of this image's draw and
   *  emit nothing. Move/resize/cross-page fields are ignored. */
  deleted?: boolean;
};

/** Net-new text the user typed at a fresh position on the page. Saved
 *  by appending a draw call to the page's content stream — no
 *  modification of existing ops. */
export type TextInsert = {
  sourceKey: string;
  pageIndex: number;
  /** PDF user-space baseline x. */
  pdfX: number;
  /** PDF user-space baseline y (y-up). */
  pdfY: number;
  fontSize: number;
  text: string;
  style?: EditStyle;
};

/** Net-new image dropped onto the page. */
export type ImageInsert = {
  sourceKey: string;
  pageIndex: number;
  /** Bottom-left in PDF user space (y-up). */
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  bytes: Uint8Array;
  format: "png" | "jpeg";
};

/** Vector-shape removal — strip the shape's q…Q block from the source
 *  page's content stream so the saved PDF no longer paints it. Only
 *  delete is supported in v1 (no move / resize). */
export type ShapeDelete = {
  sourceKey: string;
  pageIndex: number;
  shapeId: string;
};

const standardFontVariants: Record<
  NonNullable<(typeof FONTS)[number]["standardFont"]>,
  Record<"regular" | "bold" | "italic" | "boldItalic", StandardFonts>
> = {
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  TimesRoman: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  Courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
  },
};
const variantKey = (bold: boolean, italic: boolean) =>
  bold && italic ? "boldItalic" : bold ? "bold" : italic ? "italic" : "regular";

/** Standard italic slant: tan(~12°). Used to synthesize italic for fonts
 *  that don't ship a real italic variant (every bundled Dhivehi family). */
const ITALIC_SHEAR = 0.21;

/** True iff `family` resolves to a Standard 14 font that has a real
 *  italic / oblique variant we picked in `makeFontFactory`. For those,
 *  italic is rendered by the variant's own glyph shapes — no shear
 *  needed. For everything else (every bundled Dhivehi TTF) we synthesize
 *  italic via a Tm-equivalent shear `cm`. */
function fontHasNativeItalic(family: string): boolean {
  const def = FONTS.find((f) => f.family === family);
  return !!def?.standardFont;
}

/** Emit underline / strikethrough rules under a freshly-drawn text run.
 *  Both decorations are simple thin horizontal lines:
 *    underline    : ~0.08 × size below the baseline
 *    strikethrough: ~0.30 × size above the baseline (mid-x-height)
 *  Pulled into a single helper so the run-edit and text-insert paths
 *  share one place to keep the geometry in sync. The pairing logic in
 *  `runDecorations.ts` uses matching offsets so a re-loaded saved PDF
 *  re-detects these as the run's decoration. */
function drawDecorations(
  page: PDFPage,
  opts: {
    x: number;
    y: number;
    width: number;
    size: number;
    underline: boolean;
    strikethrough: boolean;
  },
): void {
  const thickness = Math.max(0.5, opts.size * 0.05);
  if (opts.underline) {
    const underlineY = opts.y - Math.max(1, opts.size * 0.08);
    page.drawLine({
      start: { x: opts.x, y: underlineY },
      end: { x: opts.x + opts.width, y: underlineY },
      thickness,
      color: rgb(0, 0, 0),
    });
  }
  if (opts.strikethrough) {
    const strikeY = opts.y + opts.size * 0.3;
    page.drawLine({
      start: { x: opts.x, y: strikeY },
      end: { x: opts.x + opts.width, y: strikeY },
      thickness,
      color: rgb(0, 0, 0),
    });
  }
}

/** Wrap a `drawText` call with a shear-about-baseline `cm` when we need
 *  to synthesize italic. The matrix `[1 0 s 1 -s·y 0]` is shear-about-y
 *  — verticals tilt right while the baseline x at y stays fixed, so the
 *  glyphs slant forward without drifting horizontally off the run's
 *  origin.
 *
 *  Dispatches by font kind:
 *    - Custom Dhivehi family with bundled TTF bytes → `drawShapedText`
 *      (HarfBuzz-shaped GIDs written as raw Tj operators against a
 *      subset:false Type 0 font, so GPOS mark anchoring is correct).
 *    - Standard-14 Latin family (no TTF bytes) → pdf-lib's `drawText`.
 *      fontkit's layout is fine for Latin; HarfBuzz wouldn't help. */
async function drawTextWithStyle(
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
  },
): Promise<void> {
  const synth = opts.italic && !fontHasNativeItalic(opts.family);
  if (synth) {
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(1, 0, ITALIC_SHEAR, 1, -ITALIC_SHEAR * opts.y, 0),
    );
  }
  if (opts.fontBytes) {
    await drawShapedText(page, {
      text,
      font: opts.font,
      fontBytes: opts.fontBytes,
      x: opts.x,
      y: opts.y,
      size: opts.size,
      dir: opts.dir,
    });
  } else {
    page.drawText(text, {
      x: opts.x,
      y: opts.y,
      size: opts.size,
      font: opts.font,
      color: rgb(0, 0, 0),
    });
  }
  if (synth) {
    page.pushOperators(popGraphicsState());
  }
}

/** Width of `text` rendered with `font` at `size`. Routes to HarfBuzz
 *  for shaped families (whose advance widths reflect GPOS adjustments)
 *  and falls back to pdf-lib's fontkit-driven measure for standard-14. */
async function measureTextWidth(
  text: string,
  font: PDFFont,
  fontBytes: Uint8Array | null,
  size: number,
  dir: "rtl" | "ltr" | undefined,
): Promise<number> {
  if (fontBytes) return measureShapedWidth(text, fontBytes, size, dir);
  return font.widthOfTextAtSize(text, size);
}

/** Cached per-(family, bold, italic) embedded font factory bound to a
 *  single PDFDocument — fonts can't be shared across docs because each
 *  doc owns its own object table. The save loop builds one of these
 *  per loaded source.
 *
 *  Returns both the embedded `PDFFont` and the raw TTF bytes. The bytes
 *  are needed by the HarfBuzz emitter so its glyph IDs match the CIDs
 *  pdf-lib will write (subset:false embeds the bytes verbatim and uses
 *  CIDToGIDMap=Identity, so HB GID == output CID). Standard-14 fonts
 *  have no TTF — `bytes` is null for those, signalling the caller to
 *  fall back to pdf-lib's drawText / widthOfTextAtSize. */
type EmbeddedFont = {
  pdfFont: PDFFont;
  /** Raw TTF bytes, or null for standard-14 fonts. */
  bytes: Uint8Array | null;
};

function makeFontFactory(doc: PDFDocument) {
  const cache = new Map<string, EmbeddedFont>();
  return async (family: string, bold = false, italic = false): Promise<EmbeddedFont> => {
    const cacheKey = `${family}|${bold ? "b" : ""}${italic ? "i" : ""}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const def = FONTS.find((f) => f.family === family);
    let entry: EmbeddedFont;
    if (def?.standardFont) {
      const variant = standardFontVariants[def.standardFont][variantKey(bold, italic)];
      const pdfFont = await doc.embedFont(variant);
      entry = { pdfFont, bytes: null };
    } else {
      const bytes = await loadFontBytes(family);
      const pdfFont = await doc.embedFont(bytes, {
        subset: false,
        customName: `DhivehiEdit_${family.replace(/\W+/g, "_")}`,
      });
      entry = { pdfFont, bytes };
    }
    cache.set(cacheKey, entry);
    return entry;
  };
}

/** Walk forward from a `q` op tracking nested q/Q depth and return the
 *  index of the matching `Q`. Used by the cross-page image strip path
 *  to remove the entire q…Q block of the moved image so its pixels
 *  vanish from the origin page. */
function findMatchingQ(ops: Array<{ op: string }>, qIndex: number): number | null {
  if (ops[qIndex]?.op !== "q") return null;
  let depth = 1;
  for (let i = qIndex + 1; i < ops.length; i++) {
    if (ops[i].op === "q") depth++;
    else if (ops[i].op === "Q") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** Look up the PDFRef for an XObject named `resName` on a page (walking
 *  the page-tree via Parent so inherited Resources also work). Returns
 *  null when the XObject is stored inline (no ref) — we register it as
 *  a fresh ref before returning, since cross-page replication needs a
 *  ref to put into the target page's resources. */
function lookupPageXObjectRef(doc: PDFDocument, pageNode: PDFDict, resName: string): PDFRef | null {
  let node: PDFDict | null = pageNode;
  while (node) {
    const resources = node.lookup(PDFName.of("Resources"));
    if (resources instanceof PDFDict) {
      const xo = resources.lookup(PDFName.of("XObject"));
      if (xo instanceof PDFDict) {
        const raw = xo.get(PDFName.of(resName));
        if (raw instanceof PDFRef) return raw;
        if (raw) {
          // Inline object — register it so we can reference it from
          // another page. (Should be very rare; XObjects are usually
          // indirect.)
          return doc.context.register(raw);
        }
      }
    }
    const parent: unknown = node.lookup(PDFName.of("Parent"));
    if (parent instanceof PDFDict) {
      node = parent;
    } else if (parent instanceof PDFRef) {
      const r = doc.context.lookup(parent);
      node = r instanceof PDFDict ? r : null;
    } else {
      node = null;
    }
  }
  return null;
}

type LoadedSourceContext = {
  source: LoadedSource;
  doc: PDFDocument;
  getFont: (family: string, bold?: boolean, italic?: boolean) => Promise<EmbeddedFont>;
};

/** Plan for a same-source draw: emit drawText on this source's `doc`
 *  at (boxLeftPdf, baselineYPdf) on `targetPageIndex`. */
type SameSourceDrawPlan = {
  edit: Edit;
  run: TextRun;
  sourceKey: string;
  targetPageIndex: number;
  boxLeftPdf: number;
  baselineYPdf: number;
  runPdfWidth: number;
  runPdfHeight: number;
};

/** Plan for a cross-source draw: drawText on the TARGET source's doc,
 *  but the run / styling came from a different source. */
type CrossSourceDrawPlan = {
  edit: Edit;
  run: TextRun;
  targetSourceKey: string;
  targetPageIndex: number;
  boxLeftPdf: number;
  baselineYPdf: number;
  runPdfWidth: number;
  runPdfHeight: number;
};

type SameSourceImageDrawPlan = {
  move: ImageMove;
  sourceKey: string;
  xobjectRef: PDFRef;
  targetPageIndex: number;
  cm: [number, number, number, number, number, number];
};

type CrossSourceImageDrawPlan = {
  move: ImageMove;
  /** Pixel bytes pulled out of the origin source — re-embedded on the
   *  target source's doc. Lossy for vector / masked images, ok for
   *  raster (the v1 trade-off documented in the plan). */
  imageBytes: Uint8Array;
  imageFormat: "png" | "jpeg" | null;
  targetSourceKey: string;
  targetPageIndex: number;
  cm: [number, number, number, number, number, number];
};

export async function applyEditsAndSave(
  sources: Map<string, LoadedSource>,
  slots: PageSlot[],
  edits: Edit[],
  imageMoves: ImageMove[] = [],
  textInserts: TextInsert[] = [],
  imageInserts: ImageInsert[] = [],
  shapeDeletes: ShapeDelete[] = [],
  annotations: Annotation[] = [],
): Promise<Uint8Array> {
  // Bucket ops by source so each source's doc gets surgery in one pass.
  const editsBySource = new Map<string, Edit[]>();
  const movesBySource = new Map<string, ImageMove[]>();
  const shapeDeletesBySource = new Map<string, ShapeDelete[]>();
  const sourcesNeedingLoad = new Set<string>();
  // Sources referenced by any slot need to be loaded so copyPages can
  // pull from them. Edits / moves / inserts can target a source even
  // when no slot from that source is in `slots` — but the user can't
  // produce such a state today (cross-source operations only fire
  // when both endpoints are visible). Still, register origins/targets
  // so the bucket loop in the load phase loads them all.
  for (const slot of slots) {
    if (slot.kind === "page") sourcesNeedingLoad.add(slot.sourceKey);
  }
  for (const e of edits) {
    sourcesNeedingLoad.add(e.sourceKey);
    if (e.targetSourceKey) sourcesNeedingLoad.add(e.targetSourceKey);
    if (!editsBySource.has(e.sourceKey)) editsBySource.set(e.sourceKey, []);
    editsBySource.get(e.sourceKey)!.push(e);
  }
  for (const m of imageMoves) {
    sourcesNeedingLoad.add(m.sourceKey);
    if (m.targetSourceKey) sourcesNeedingLoad.add(m.targetSourceKey);
    if (!movesBySource.has(m.sourceKey)) movesBySource.set(m.sourceKey, []);
    movesBySource.get(m.sourceKey)!.push(m);
  }
  for (const t of textInserts) sourcesNeedingLoad.add(t.sourceKey);
  for (const i of imageInserts) sourcesNeedingLoad.add(i.sourceKey);
  for (const a of annotations) sourcesNeedingLoad.add(a.sourceKey);
  for (const d of shapeDeletes) {
    sourcesNeedingLoad.add(d.sourceKey);
    if (!shapeDeletesBySource.has(d.sourceKey)) shapeDeletesBySource.set(d.sourceKey, []);
    shapeDeletesBySource.get(d.sourceKey)!.push(d);
  }

  // Load each source's doc once. We re-load from bytes (rather than
  // reusing any cached PDFDocument) so the save pipeline can't leave
  // mutations behind in the in-memory source state.
  const ctxBySource = new Map<string, LoadedSourceContext>();
  for (const sourceKey of sourcesNeedingLoad) {
    const source = sources.get(sourceKey);
    if (!source) continue;
    const doc = await PDFDocument.load(source.bytes);
    doc.registerFontkit(fontkit);
    ctxBySource.set(sourceKey, {
      source,
      doc,
      getFont: makeFontFactory(doc),
    });
  }

  const sameSourceDraws: SameSourceDrawPlan[] = [];
  const crossSourceDraws: CrossSourceDrawPlan[] = [];
  const sameSourceImageDraws: SameSourceImageDrawPlan[] = [];
  const crossSourceImageDraws: CrossSourceImageDrawPlan[] = [];

  // First pass — per source, do content-stream surgery. Cross-source
  // draws are queued and emitted in the second pass after every source
  // has had its strips committed.
  for (const [sourceKey, ctx] of ctxBySource) {
    const sourceEdits = editsBySource.get(sourceKey) ?? [];
    const sourceMoves = movesBySource.get(sourceKey) ?? [];
    const sourceShapeDeletes = shapeDeletesBySource.get(sourceKey) ?? [];
    if (sourceEdits.length === 0 && sourceMoves.length === 0 && sourceShapeDeletes.length === 0) {
      continue;
    }
    await applyStreamSurgeryForSource(
      ctx,
      sourceEdits,
      sourceMoves,
      sourceShapeDeletes,
      sameSourceDraws,
      crossSourceDraws,
      sameSourceImageDraws,
      crossSourceImageDraws,
    );
  }

  // Second pass — emit cross-source / cross-page image draws on the
  // target page's resources. For same-source cross-page we replicate
  // the XObject ref; for cross-source we embed the pixel bytes fresh
  // on the target's doc.
  for (const plan of sameSourceImageDraws) {
    const ctx = ctxBySource.get(plan.sourceKey);
    if (!ctx) continue;
    const targetPage = ctx.doc.getPages()[plan.targetPageIndex];
    if (!targetPage) continue;
    const name = (
      targetPage.node as unknown as {
        newXObject: (tag: string, ref: PDFRef) => PDFName;
      }
    ).newXObject("RihaImg", plan.xobjectRef);
    targetPage.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...plan.cm),
      drawObject(name),
      popGraphicsState(),
    );
  }

  for (const plan of crossSourceImageDraws) {
    const targetCtx = ctxBySource.get(plan.targetSourceKey);
    if (!targetCtx) continue;
    const targetPage = targetCtx.doc.getPages()[plan.targetPageIndex];
    if (!targetPage) continue;
    if (!plan.imageFormat) continue; // unsupported format — silently skip
    const embedded =
      plan.imageFormat === "png"
        ? await targetCtx.doc.embedPng(plan.imageBytes)
        : await targetCtx.doc.embedJpg(plan.imageBytes);
    targetPage.drawImage(embedded, {
      x: plan.cm[4],
      y: plan.cm[5],
      width: plan.cm[0],
      height: plan.cm[3],
    });
  }

  // Same-source text draws — emit on origin or target page within the
  // same doc.
  for (const plan of sameSourceDraws) {
    const ctx = ctxBySource.get(plan.sourceKey);
    if (!ctx) continue;
    await emitTextDraw(ctx, plan.targetPageIndex, plan);
  }
  for (const plan of crossSourceDraws) {
    const ctx = ctxBySource.get(plan.targetSourceKey);
    if (!ctx) continue;
    await emitTextDraw(ctx, plan.targetPageIndex, plan);
  }

  // Net-new insertions — text + image. Each insertion already targets a
  // specific (sourceKey, pageIndex) pair; the load phase ensured the
  // doc is open.
  for (const ins of textInserts) {
    if (!ins.text || ins.text.trim().length === 0) continue;
    const ctx = ctxBySource.get(ins.sourceKey);
    if (!ctx) continue;
    const page = ctx.doc.getPages()[ins.pageIndex];
    if (!page) continue;
    const family =
      ins.style?.fontFamily ??
      // default per-script: Thaana → Faruma, otherwise Arial
      (/[֐-׿؀-ۿހ-޿]/u.test(ins.text) ? DEFAULT_FONT_FAMILY : "Arial");
    const bold = !!ins.style?.bold;
    const italic = !!ins.style?.italic;
    const { pdfFont, bytes: fontBytes } = await ctx.getFont(family, bold, italic);
    const fontSizePt = ins.fontSize;
    // Explicit `style.dir` wins; otherwise auto-detect from the text's
    // strong codepoints. RTL right-aligns the baseline so glyphs grow
    // leftward from `pdfX`; LTR draws from `pdfX` rightward.
    const isRtl =
      ins.style?.dir === "rtl" || (ins.style?.dir !== "ltr" && /[֐-׿؀-ۿހ-޿]/u.test(ins.text));
    const dir: "rtl" | "ltr" | undefined = ins.style?.dir;
    const widthPt = await measureTextWidth(ins.text, pdfFont, fontBytes, fontSizePt, dir);
    const baseX = isRtl ? ins.pdfX - widthPt : ins.pdfX;
    await drawTextWithStyle(page, ins.text, {
      x: baseX,
      y: ins.pdfY,
      size: fontSizePt,
      font: pdfFont,
      fontBytes,
      family,
      italic,
      dir,
    });
    drawDecorations(page, {
      x: baseX,
      y: ins.pdfY,
      width: widthPt,
      size: fontSizePt,
      underline: !!ins.style?.underline,
      strikethrough: !!ins.style?.strikethrough,
    });
  }

  // Embed each unique image once per (doc, byte-buffer) pair so a
  // single user image dropped on multiple pages of the same source
  // shares one XObject in the saved file.
  const imageEmbedCache = new Map<
    string,
    Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>>
  >();
  for (const ins of imageInserts) {
    const ctx = ctxBySource.get(ins.sourceKey);
    if (!ctx) continue;
    const page = ctx.doc.getPages()[ins.pageIndex];
    if (!page) continue;
    const cacheKey = `${ins.sourceKey} ${idOf(ins.bytes)}`;
    let embedded = imageEmbedCache.get(cacheKey);
    if (!embedded) {
      embedded =
        ins.format === "png"
          ? await ctx.doc.embedPng(ins.bytes)
          : await ctx.doc.embedJpg(ins.bytes);
      imageEmbedCache.set(cacheKey, embedded);
    }
    page.drawImage(embedded, {
      x: ins.pdfX,
      y: ins.pdfY,
      width: ins.pdfWidth,
      height: ins.pdfHeight,
    });
  }

  // Annotations - native PDF /Annot dicts appended to each source
  // page's /Annots array. Bucket by source so we only pay one pass per
  // doc; pdf-lib copyPages then carries the new /Annots through to the
  // output along with any pre-existing source annotations.
  if (annotations.length > 0) {
    const annotsBySource = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const list = annotsBySource.get(a.sourceKey) ?? [];
      list.push(a);
      annotsBySource.set(a.sourceKey, list);
    }
    for (const [sourceKey, list] of annotsBySource) {
      const ctx = ctxBySource.get(sourceKey);
      if (!ctx) continue;
      await applyAnnotationsToDoc(ctx.doc, list, { getFont: ctx.getFont });
    }
  }

  // Build the output by walking `slots[]` in order. Edits are baked
  // into each source's `doc` from the loops above; copyPages preserves
  // embedded fonts / images / XObjects. Blanks become fresh pages.
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const indicesPerSource = new Map<string, number[]>();
  for (const slot of slots) {
    if (slot.kind !== "page") continue;
    const arr = indicesPerSource.get(slot.sourceKey) ?? [];
    arr.push(slot.sourcePageIndex);
    indicesPerSource.set(slot.sourceKey, arr);
  }
  const copiedPerSource = new Map<string, Awaited<ReturnType<typeof output.copyPages>>>();
  for (const [sourceKey, indices] of indicesPerSource) {
    const ctx = ctxBySource.get(sourceKey);
    if (!ctx) continue;
    const copied = await output.copyPages(ctx.doc, indices);
    copiedPerSource.set(sourceKey, copied);
  }
  const cursorPerSource = new Map<string, number>();
  for (const slot of slots) {
    if (slot.kind === "blank") {
      output.addPage(slot.size);
      continue;
    }
    const copied = copiedPerSource.get(slot.sourceKey);
    if (!copied) continue;
    const cursor = cursorPerSource.get(slot.sourceKey) ?? 0;
    output.addPage(copied[cursor]);
    cursorPerSource.set(slot.sourceKey, cursor + 1);
  }
  return output.save();
}

async function applyStreamSurgeryForSource(
  ctx: LoadedSourceContext,
  sourceEdits: Edit[],
  sourceMoves: ImageMove[],
  sourceShapeDeletes: ShapeDelete[],
  sameSourceDraws: SameSourceDrawPlan[],
  crossSourceDraws: CrossSourceDrawPlan[],
  sameSourceImageDraws: SameSourceImageDrawPlan[],
  crossSourceImageDraws: CrossSourceImageDrawPlan[],
): Promise<void> {
  const { source, doc, getFont } = ctx;
  const editsByPage = new Map<number, Edit[]>();
  for (const e of sourceEdits) {
    if (!editsByPage.has(e.pageIndex)) editsByPage.set(e.pageIndex, []);
    editsByPage.get(e.pageIndex)!.push(e);
  }
  const movesByPage = new Map<number, ImageMove[]>();
  for (const m of sourceMoves) {
    if (!movesByPage.has(m.pageIndex)) movesByPage.set(m.pageIndex, []);
    movesByPage.get(m.pageIndex)!.push(m);
  }
  const shapeDeletesByPage = new Map<number, ShapeDelete[]>();
  for (const d of sourceShapeDeletes) {
    if (!shapeDeletesByPage.has(d.pageIndex)) shapeDeletesByPage.set(d.pageIndex, []);
    shapeDeletesByPage.get(d.pageIndex)!.push(d);
  }
  const pagesToRewrite = new Set<number>([
    ...editsByPage.keys(),
    ...movesByPage.keys(),
    ...shapeDeletesByPage.keys(),
  ]);

  const docPages = doc.getPages();

  for (const pageIndex of pagesToRewrite) {
    const pageEdits = editsByPage.get(pageIndex) ?? [];
    const pageImageMoves = movesByPage.get(pageIndex) ?? [];
    const page = docPages[pageIndex];
    const rendered = source.pages[pageIndex];
    if (!page || !rendered) continue;

    // Pre-load all fonts this page needs and register them on the page so
    // the resource names exist before we emit operators referencing them.
    // (Cross-page edits register their font on the TARGET page later via
    // drawText's internal setFont call — handled in the second-pass phase.)
    const familiesUsed = Array.from(
      new Set(
        pageEdits
          .filter(
            (e) =>
              !isCrossPageEdit(e, source.sourceKey, pageIndex) &&
              !isCrossSourceEdit(e, source.sourceKey),
          )
          .map((e) => {
            if (e.style?.fontFamily) return e.style.fontFamily;
            const run = rendered.textRuns.find((r) => r.id === e.runId);
            return run?.fontFamily ?? DEFAULT_FONT_FAMILY;
          }),
      ),
    );
    for (const family of familiesUsed) {
      const f = await getFont(family);
      page.setFont(f.pdfFont);
    }

    // Read + parse the existing content stream.
    const originalContent = getPageContentBytes(doc.context, page.node);
    const ops = parseContentStream(originalContent);
    const shows = findTextShows(ops);

    const pageHeight = page.getHeight();
    const scale = rendered.scale;

    const indicesToRemove = new Set<number>();
    const moveOps: Array<{ tjIndex: number; newTx: number; newTy: number }> = [];

    for (const edit of pageEdits) {
      const run = rendered.textRuns.find((r) => r.id === edit.runId);
      if (!run) continue;
      const runPdfX = run.bounds.left / scale;
      const runPdfY = pageHeight - run.baselineY / scale;
      const runPdfWidth = run.bounds.width / scale;
      const runPdfHeight = run.height / scale;

      let matched = shows.filter((s) => run.contentStreamOpIndices.includes(s.index));
      if (matched.length === 0) {
        const tolY = Math.max(2, runPdfHeight * 0.4);
        const tolX = Math.max(2, runPdfHeight * 0.3);
        matched = shows.filter((s) => {
          const ex = s.textMatrix[4];
          const ey = s.textMatrix[5];
          if (Math.abs(ey - runPdfY) > tolY) return false;
          if (ex < runPdfX - tolX) return false;
          if (ex > runPdfX + runPdfWidth + tolX) return false;
          return true;
        });
      }

      // Whatever the path, if the run carries source-detected
      // decoration ops (underline / strikethrough q…Q blocks paired
      // with this run at load time), strip those alongside the Tj's so
      // the line never desyncs from the text. The redraw paths re-emit
      // a fresh decoration that tracks the new geometry.
      const stripDecoration = () => {
        for (const range of run.decorationOpRanges ?? []) {
          for (let k = range.qOpIndex; k <= range.QOpIndex; k++) {
            indicesToRemove.add(k);
          }
        }
      };

      if (edit.deleted) {
        for (const s of matched) indicesToRemove.add(s.index);
        stripDecoration();
        continue;
      }

      const isCross = isCrossPageEdit(edit, source.sourceKey, pageIndex);
      if (isCross) {
        for (const s of matched) indicesToRemove.add(s.index);
        stripDecoration();
        const targetSourceKey = edit.targetSourceKey ?? source.sourceKey;
        if (targetSourceKey === source.sourceKey) {
          sameSourceDraws.push({
            edit,
            run,
            sourceKey: source.sourceKey,
            targetPageIndex: edit.targetPageIndex!,
            boxLeftPdf: edit.targetPdfX ?? 0,
            baselineYPdf: edit.targetPdfY ?? 0,
            runPdfWidth,
            runPdfHeight,
          });
        } else {
          crossSourceDraws.push({
            edit,
            run,
            targetSourceKey,
            targetPageIndex: edit.targetPageIndex!,
            boxLeftPdf: edit.targetPdfX ?? 0,
            baselineYPdf: edit.targetPdfY ?? 0,
            runPdfWidth,
            runPdfHeight,
          });
        }
        continue;
      }

      // A pure-translation move can normally keep the original Tj's in
      // place and emit a single Tm to relocate them — cheaper, exact.
      // But that path leaves any source-detected decoration q…Q at the
      // OLD position, so once a run has decoration we fall through to
      // the full strip-and-redraw path which will re-emit a fresh line
      // at the new position.
      const hasDecoration = (run.decorationOpRanges?.length ?? 0) > 0;
      const isMoveOnly =
        edit.newText === run.text &&
        !edit.style &&
        !hasDecoration &&
        ((edit.dx ?? 0) !== 0 || (edit.dy ?? 0) !== 0);
      if (isMoveOnly && matched.length > 0) {
        const moveX = (edit.dx ?? 0) / scale;
        const moveY = -(edit.dy ?? 0) / scale;
        for (const s of matched) {
          moveOps.push({
            tjIndex: s.index,
            newTx: s.textMatrix[4] + moveX,
            newTy: s.textMatrix[5] + moveY,
          });
        }
        continue;
      }

      for (const s of matched) indicesToRemove.add(s.index);
      stripDecoration();

      const moveX = (edit.dx ?? 0) / scale;
      const moveY = -(edit.dy ?? 0) / scale;
      sameSourceDraws.push({
        edit,
        run,
        sourceKey: source.sourceKey,
        targetPageIndex: pageIndex,
        boxLeftPdf: runPdfX + moveX,
        baselineYPdf: runPdfY + moveY,
        runPdfWidth,
        runPdfHeight,
      });
    }

    const moveByTjIndex = new Map<number, { newTx: number; newTy: number }>();
    for (const m of moveOps) {
      moveByTjIndex.set(m.tjIndex, { newTx: m.newTx, newTy: m.newTy });
    }

    const insertAfterQ = new Map<number, [number, number, number, number, number, number]>();
    for (const move of pageImageMoves) {
      const img = rendered.images.find((i) => i.id === move.imageId);
      if (!img || img.qOpIndex == null) continue;

      if (move.deleted) {
        const matchingQ = findMatchingQ(ops, img.qOpIndex);
        if (matchingQ != null) {
          for (let k = img.qOpIndex; k <= matchingQ; k++) indicesToRemove.add(k);
        }
        continue;
      }

      const isCross = isCrossPageMove(move, source.sourceKey, pageIndex);

      if (isCross) {
        const matchingQ = findMatchingQ(ops, img.qOpIndex);
        if (matchingQ != null) {
          for (let k = img.qOpIndex; k <= matchingQ; k++) indicesToRemove.add(k);
        }
        const w = move.targetPdfWidth ?? img.pdfWidth;
        const h = move.targetPdfHeight ?? img.pdfHeight;
        const tx = move.targetPdfX ?? img.pdfX;
        const ty = move.targetPdfY ?? img.pdfY;
        const targetSourceKey = move.targetSourceKey ?? source.sourceKey;
        if (targetSourceKey === source.sourceKey) {
          // Same-source cross-page move — we can re-use the XObject ref.
          const ref = lookupPageXObjectRef(doc, page.node, img.resourceName);
          if (!ref) continue;
          sameSourceImageDraws.push({
            move,
            sourceKey: source.sourceKey,
            xobjectRef: ref,
            targetPageIndex: move.targetPageIndex!,
            cm: [w, 0, 0, h, tx, ty],
          });
        } else {
          // Cross-source move — pull the original pixel bytes out of
          // the source's XObject and queue an embed-on-target. Vector
          // / masked images won't survive cleanly; that's documented.
          const bytesAndFmt = readImageBytesFromXObject(doc, page.node, img.resourceName);
          crossSourceImageDraws.push({
            move,
            imageBytes: bytesAndFmt?.bytes ?? new Uint8Array(),
            imageFormat: bytesAndFmt?.format ?? null,
            targetSourceKey,
            targetPageIndex: move.targetPageIndex!,
            cm: [w, 0, 0, h, tx, ty],
          });
        }
        continue;
      }

      const dxPdf = (move.dx ?? 0) / scale;
      const dyPdf = -(move.dy ?? 0) / scale;
      const dwPdf = (move.dw ?? 0) / scale;
      const dhPdf = (move.dh ?? 0) / scale;
      const oldW = img.pdfWidth;
      const oldH = img.pdfHeight;
      const newW = oldW + dwPdf;
      const newH = oldH + dhPdf;
      const oldX = img.pdfX;
      const oldY = img.pdfY;
      const newX = oldX + dxPdf;
      const newY = oldY + dyPdf;
      const sx = oldW > 1e-6 ? newW / oldW : 1;
      const sy = oldH > 1e-6 ? newH / oldH : 1;
      const ex = newX - oldX * sx;
      const ey = newY - oldY * sy;
      insertAfterQ.set(img.qOpIndex, [sx, 0, 0, sy, ex, ey]);
    }

    // Vector-shape deletes — strip each shape's q…Q range. The detector
    // already validated the block is pure vector (no nested text /
    // image), so removing it can't take down unrelated content.
    const pageShapeDeletes = shapeDeletesByPage.get(pageIndex) ?? [];
    for (const del of pageShapeDeletes) {
      const shape = rendered.shapes.find((s) => s.id === del.shapeId);
      if (!shape) continue;
      for (let k = shape.qOpIndex; k <= shape.QOpIndex; k++) {
        indicesToRemove.add(k);
      }
    }

    const newOps: typeof ops = [];
    for (let i = 0; i < ops.length; i++) {
      if (indicesToRemove.has(i)) continue;
      const move = moveByTjIndex.get(i);
      if (move) {
        newOps.push({
          op: "Tm",
          operands: [
            { kind: "number", value: 1, raw: "1" },
            { kind: "number", value: 0, raw: "0" },
            { kind: "number", value: 0, raw: "0" },
            { kind: "number", value: 1, raw: "1" },
            {
              kind: "number",
              value: move.newTx,
              raw: move.newTx.toFixed(3),
            },
            {
              kind: "number",
              value: move.newTy,
              raw: move.newTy.toFixed(3),
            },
          ],
        });
      }
      newOps.push(ops[i]);
      const imgMove = insertAfterQ.get(i);
      if (imgMove && ops[i].op === "q") {
        newOps.push({
          op: "cm",
          operands: imgMove.map((v) => ({
            kind: "number" as const,
            value: v,
            raw: v.toFixed(3),
          })),
        });
      }
    }
    setPageContentBytes(doc.context, page.node, serializeContentStream(newOps));
  }
}

function isCrossPageEdit(edit: Edit, sourceKey: string, pageIndex: number): boolean {
  if (edit.targetPageIndex === undefined) return false;
  if (edit.targetSourceKey && edit.targetSourceKey !== sourceKey) return true;
  return edit.targetPageIndex !== pageIndex;
}
function isCrossSourceEdit(edit: Edit, sourceKey: string): boolean {
  return edit.targetSourceKey !== undefined && edit.targetSourceKey !== sourceKey;
}
function isCrossPageMove(move: ImageMove, sourceKey: string, pageIndex: number): boolean {
  if (move.targetPageIndex === undefined) return false;
  if (move.targetSourceKey && move.targetSourceKey !== sourceKey) return true;
  return move.targetPageIndex !== pageIndex;
}

async function emitTextDraw(
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
  const widthPt = await measureTextWidth(edit.newText, pdfFont, fontBytes, fontSizePt, dir);
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
  });
}

/** Pull raw image-XObject bytes (and format hint) out of a page's
 *  resources by name. Used by cross-source image moves so we can
 *  re-embed the original pixels on the target source's doc. Falls back
 *  to null when the XObject isn't a raster (Form XObjects, indirect
 *  masks, weird filter chains). */
function readImageBytesFromXObject(
  doc: PDFDocument,
  pageNode: PDFDict,
  resName: string,
): { bytes: Uint8Array; format: "png" | "jpeg" | null } | null {
  const ref = lookupPageXObjectRef(doc, pageNode, resName);
  if (!ref) return null;
  const obj = doc.context.lookup(ref);
  if (!obj || typeof obj !== "object" || !("contents" in obj)) return null;
  const stream = obj as unknown as {
    contents?: Uint8Array;
    dict: PDFDict;
  };
  if (!(stream.contents instanceof Uint8Array)) return null;
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  let format: "png" | "jpeg" | null = null;
  // pdf-lib's filter values vary in shape (single name vs array). We
  // only need a coarse hint — JPEG = DCTDecode, anything else we fall
  // back to PNG and trust pdf-lib's embedPng to fail loud if the bytes
  // aren't actually PNG (which is fine; cross-source image moves of
  // exotic filters are best-effort in v1).
  const filterStr = String(filter ?? "");
  if (filterStr.includes("DCTDecode")) format = "jpeg";
  else if (looksLikePngBytes(stream.contents)) format = "png";
  return { bytes: stream.contents, format };
}

function looksLikePngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

let nextImageId = 0;
const imageBytesIds = new WeakMap<Uint8Array, string>();
function idOf(bytes: Uint8Array): string {
  let id = imageBytesIds.get(bytes);
  if (!id) {
    nextImageId += 1;
    id = `i${nextImageId}`;
    imageBytesIds.set(bytes, id);
  }
  return id;
}

export function downloadBlob(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
