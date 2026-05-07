// Build pdf-lib annotation dicts from our Annotation values and append
// them to a page's /Annots array. pdf-lib has no first-class annotation
// builder, so we construct PDFDict / PDFArray directly. Each annotation
// kind maps to a single PDF /Subtype:
//   highlight → /Highlight (text-markup with /QuadPoints)
//   comment   → /FreeText  (visible inline text box on the annot layer)
//   ink       → /Ink        (freehand strokes via /InkList)
//
// /Highlight and /Ink omit /AP — Acrobat, Preview, Chrome, and pdf.js
// auto-render appearances for those subtypes from the shape fields
// (/QuadPoints, /InkList, /C).
//
// /FreeText comments need extra care for Thaana. Acrobat / pdf.js can
// regenerate an appearance from /DA + /Contents, but the regeneration
// pipeline doesn't run a complex-script shaper — Thaana fili end up
// stacked at fixed offsets or rendered as `.notdef`. For comments
// containing Thaana we therefore SHIP a custom /AP /N Form XObject
// pre-shaped via HarfBuzz; Latin-only comments keep the lighter /DA
// path. Fallback for legacy viewers that ignore /AP and re-render from
// /DA: we register the embedded Faruma in the doc's /AcroForm/DR/Font
// so /DA's font reference can resolve, and switch the /DA from /Helv
// to that Faruma alias when the text is Thaana.

import {
  fill,
  PDFArray,
  PDFContentStream,
  PDFContext,
  PDFDict,
  PDFFont,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  type PDFOperator,
} from "pdf-lib";
import {
  annotationBBox,
  type Annotation,
  type AnnotationColor,
  type CommentAnnotation,
  type HighlightAnnotation,
  type InkAnnotation,
} from "@/domain/annotations";
import { isRtlScript } from "@/lib/fonts";
import { encodeUtf16BE, makeAcroFormFontSetup, type EmbeddedFontFactory } from "./pdfAcroForm";
import { buildShapedTextOps, measureShapedWidth } from "./shapedDraw";

/** Subset of save.ts's per-source font factory needed by the comment
 *  /AP path. Defined structurally here so saveAnnotations.ts doesn't
 *  cross-import the bigger save-pipeline types. */
export type AnnotationFontFactory = EmbeddedFontFactory;

export type AnnotationSaveOptions = {
  /** Embedded-font factory bound to the same doc the annotations are
   *  being applied to. Used by Thaana comment annotations to embed
   *  Faruma for the `/AP /N` appearance stream + the `/AcroForm/DR`
   *  fallback. */
  getFont: AnnotationFontFactory;
};

/** Append an existing annotation ref to the page's /Annots array,
 *  creating the array if the page has none. */
function appendAnnotRef(page: PDFPage, ref: PDFRef): void {
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) {
    existing.push(ref);
    return;
  }
  const arr = page.doc.context.obj([ref]);
  page.node.set(PDFName.of("Annots"), arr);
}

function rectArray(ctx: PDFContext, r: [number, number, number, number]): PDFArray {
  return ctx.obj([PDFNumber.of(r[0]), PDFNumber.of(r[1]), PDFNumber.of(r[2]), PDFNumber.of(r[3])]);
}

function colorArray(ctx: PDFContext, c: AnnotationColor): PDFArray {
  return ctx.obj([PDFNumber.of(c[0]), PDFNumber.of(c[1]), PDFNumber.of(c[2])]);
}

/** Apply common /Annot fields (Type, Rect, C, Contents) to `dict`. We
 *  intentionally don't set /F: leaving it absent means the viewer's
 *  default applies, which is "show on screen, don't print" — matching
 *  what most users expect from highlight / comment / ink markup.
 *  Setting /F = 4 (Print bit) made saved PDFs print all annotations,
 *  which surprised reviewers who only wanted markup on screen. */
function setBaseAnnotFields(
  dict: PDFDict,
  ctx: PDFContext,
  rect: [number, number, number, number],
  color: AnnotationColor,
  contents: string | undefined,
): void {
  dict.set(PDFName.of("Type"), PDFName.of("Annot"));
  dict.set(PDFName.of("Rect"), rectArray(ctx, rect));
  dict.set(PDFName.of("C"), colorArray(ctx, color));
  if (contents !== undefined && contents.length > 0) {
    dict.set(PDFName.of("Contents"), encodeUtf16BE(contents));
  }
}

function buildHighlightDict(ctx: PDFContext, a: HighlightAnnotation): PDFDict {
  const dict = PDFDict.withContext(ctx);
  setBaseAnnotFields(dict, ctx, annotationBBox(a), a.color, a.comment);
  dict.set(PDFName.of("Subtype"), PDFName.of("Highlight"));
  // /QuadPoints: 8 numbers per quad, in TL TR BL BR order.
  const quadNums: PDFObject[] = [];
  for (const q of a.quads) {
    quadNums.push(PDFNumber.of(q.x1), PDFNumber.of(q.y1));
    quadNums.push(PDFNumber.of(q.x2), PDFNumber.of(q.y2));
    quadNums.push(PDFNumber.of(q.x3), PDFNumber.of(q.y3));
    quadNums.push(PDFNumber.of(q.x4), PDFNumber.of(q.y4));
  }
  dict.set(PDFName.of("QuadPoints"), ctx.obj(quadNums));
  return dict;
}

function buildInkDict(ctx: PDFContext, a: InkAnnotation): PDFDict {
  const dict = PDFDict.withContext(ctx);
  setBaseAnnotFields(dict, ctx, annotationBBox(a), a.color, undefined);
  dict.set(PDFName.of("Subtype"), PDFName.of("Ink"));
  // /InkList: array of arrays. Each inner array is a flat [x0 y0 x1 y1 …]
  // for one continuous stroke.
  const inkList = ctx.obj([]);
  for (const stroke of a.strokes) {
    const flat: PDFObject[] = [];
    for (const p of stroke) flat.push(PDFNumber.of(p.x), PDFNumber.of(p.y));
    inkList.push(ctx.obj(flat));
  }
  dict.set(PDFName.of("InkList"), inkList);
  // /BS sets stroke thickness — without it, viewers fall back to a 1pt
  // default regardless of /Border.
  const bs = PDFDict.withContext(ctx);
  bs.set(PDFName.of("Type"), PDFName.of("Border"));
  bs.set(PDFName.of("W"), PDFNumber.of(a.thickness));
  bs.set(PDFName.of("S"), PDFName.of("S"));
  dict.set(PDFName.of("BS"), bs);
  return dict;
}

/** Build a /FreeText annotation. Common to both the Latin (/Helv) and
 *  Thaana (Faruma + /AP) paths:
 *    - /Contents: the body text (UTF-16BE for non-ASCII).
 *    - /Q: quadding (text alignment). 0 = left for LTR; 2 = right for
 *      RTL Thaana so the visible text right-aligns inside the box even
 *      when a viewer falls back to rendering from /DA + /Contents.
 *    - /IC: interior fill color. For /FreeText, /C is the BORDER color
 *      and /IC is the fill — different from /Highlight where /C is the
 *      fill.
 *    - /BS /W 0: suppress the default 1pt border viewers draw around
 *      FreeText. Without this we get a dark border around the box.
 *
 *  /DA defaults to /Helv. When the comment text contains RTL/Thaana
 *  codepoints we override it to reference an embedded Faruma alias
 *  (registered in /AcroForm/DR/Font upstream). The /AP /N Form XObject
 *  shipped in the same case is what most viewers actually render —
 *  /DA is just the legacy fallback when /AP is ignored. */
async function buildCommentDict(
  ctx: PDFContext,
  a: CommentAnnotation,
  acroFormSetup: AcroFormSetup,
): Promise<PDFDict> {
  const dict = PDFDict.withContext(ctx);
  setBaseAnnotFields(dict, ctx, annotationBBox(a), a.color, a.text);
  dict.set(PDFName.of("Subtype"), PDFName.of("FreeText"));

  const isThaana = isRtlScript(a.text);
  if (isThaana) {
    const faruma = await acroFormSetup.ensureThaanaFont();
    if (faruma) {
      // Reference the same Faruma alias /AcroForm/DR/Font carries, so
      // viewers that ignore /AP and re-render from /DA still pick up
      // the right font. Single-quote-style PDFName names are fine here
      // — pdf-lib's PDFString.of escapes correctly.
      dict.set(PDFName.of("DA"), PDFString.of(`/${faruma.alias} ${a.fontSize} Tf 0 0 0 rg`));
      const apForm = await buildCommentApForm(ctx, a, faruma);
      if (apForm) {
        const ap = PDFDict.withContext(ctx);
        ap.set(PDFName.of("N"), apForm);
        dict.set(PDFName.of("AP"), ap);
      }
    } else {
      dict.set(PDFName.of("DA"), PDFString.of(`/Helv ${a.fontSize} Tf 0 0 0 rg`));
    }
    dict.set(PDFName.of("Q"), PDFNumber.of(2));
  } else {
    dict.set(PDFName.of("DA"), PDFString.of(`/Helv ${a.fontSize} Tf 0 0 0 rg`));
    dict.set(PDFName.of("Q"), PDFNumber.of(0));
  }

  dict.set(PDFName.of("IC"), colorArray(ctx, a.color));
  const bs = PDFDict.withContext(ctx);
  bs.set(PDFName.of("Type"), PDFName.of("Border"));
  bs.set(PDFName.of("W"), PDFNumber.of(0));
  bs.set(PDFName.of("S"), PDFName.of("S"));
  dict.set(PDFName.of("BS"), bs);
  return dict;
}

/** Resolved Faruma + alias for both the /AcroForm/DR/Font entry and
 *  the per-annotation /AP /N Form XObject. The alias is the resource
 *  name (e.g. `RihaThaana`) we use everywhere consistently — /DA's
 *  font reference, /AP's Form XObject /Resources/Font, and the doc-
 *  level /AcroForm/DR/Font dict all point at the same PDFRef under
 *  this name. */
type ResolvedThaanaFont = {
  pdfFont: PDFFont;
  fontBytes: Uint8Array;
  /** Resource alias (without the leading slash) used in /DA and inside
   *  the appearance stream's /Resources. */
  alias: string;
};

/** Lazy-init AcroForm/DR/Font setup per save: the first Thaana comment
 *  triggers Faruma embedding + AcroForm DR registration; subsequent
 *  comments reuse the same embed. Latin-only saves never touch this. */
type AcroFormSetup = {
  ensureThaanaFont(): Promise<ResolvedThaanaFont | null>;
};

function makeAcroFormSetup(
  doc: { context: PDFContext; catalog: PDFDict },
  getFont: AnnotationFontFactory,
): AcroFormSetup {
  const setup = makeAcroFormFontSetup(doc, getFont, { requireBytes: true });
  return {
    async ensureThaanaFont() {
      const font = await setup.ensureFont();
      if (!font?.fontBytes) return null;
      return {
        pdfFont: font.pdfFont,
        fontBytes: font.fontBytes,
        alias: font.alias,
      };
    },
  };
}

/** Build the /AP /N Form XObject that paints a comment with HarfBuzz-
 *  shaped Thaana glyphs. The XObject's coordinate space is the
 *  comment's /Rect, with origin at the lower-left:
 *    1. yellow background fill across [0,0,width,height] (replicates
 *       the /IC fill viewers draw automatically when /AP is absent —
 *       PDF spec says /AP, when present, supersedes /IC and /BS, so we
 *       have to paint the box ourselves)
 *    2. shaped text at the top of the box, right-aligned for RTL
 *  Returns the registered PDFRef of the appearance stream so the
 *  caller can attach it under the annotation's /AP /N entry. */
async function buildCommentApForm(
  ctx: PDFContext,
  a: CommentAnnotation,
  faruma: ResolvedThaanaFont,
): Promise<PDFRef | null> {
  const padding = 2;
  const baseY = a.pdfHeight - a.fontSize - padding;

  // Right-align shaped Thaana inside the comment box. The emitter's
  // `x` parameter is the *left* edge of the shaped bbox — for an RTL
  // run that's the leftmost glyph's origin. Position it at
  // (boxWidth - padding - shapedWidth) so the rightmost glyph (= first
  // logical character) sits at boxWidth - padding.
  const widthPt = await measureShapedWidth(a.text, faruma.fontBytes, a.fontSize, "rtl");
  const baseX = Math.max(padding, a.pdfWidth - padding - widthPt);

  const shapedOps = await buildShapedTextOps({
    text: a.text,
    font: faruma.pdfFont,
    fontBytes: faruma.fontBytes,
    fontKey: faruma.alias,
    x: baseX,
    y: baseY,
    size: a.fontSize,
    dir: "rtl",
  });

  const ops: PDFOperator[] = [];
  ops.push(pushGraphicsState());
  ops.push(setFillingRgbColor(a.color[0], a.color[1], a.color[2]));
  ops.push(rectangle(0, 0, a.pdfWidth, a.pdfHeight));
  ops.push(fill());
  ops.push(popGraphicsState());
  ops.push(...shapedOps.ops);

  const fontSubdict = PDFDict.withContext(ctx);
  fontSubdict.set(PDFName.of(faruma.alias), faruma.pdfFont.ref);
  const resources = PDFDict.withContext(ctx);
  resources.set(PDFName.of("Font"), fontSubdict);

  const bbox = ctx.obj([
    PDFNumber.of(0),
    PDFNumber.of(0),
    PDFNumber.of(a.pdfWidth),
    PDFNumber.of(a.pdfHeight),
  ]);

  const formStream: PDFContentStream = ctx.formXObject(ops, {
    BBox: bbox,
    Resources: resources,
  });
  return ctx.register(formStream);
}

/** Append every annotation in `list` to its target page's /Annots
 *  array. Pages are looked up by `pageIndex` on the source's doc.
 *
 *  `opts.getFont` is required for Thaana comments — they need a real
 *  embedded font for /AP. Latin-only comment paths and highlight/ink
 *  paths never touch it. */
export async function applyAnnotationsToDoc(
  doc: { context: PDFContext; catalog: PDFDict; getPages: () => PDFPage[] },
  annotations: Annotation[],
  opts: AnnotationSaveOptions,
): Promise<void> {
  const ctx = doc.context;
  const pages = doc.getPages();
  const acroFormSetup = makeAcroFormSetup(doc, opts.getFont);
  for (const a of annotations) {
    const page = pages[a.pageIndex];
    if (!page) continue;
    if (a.kind === "highlight") {
      const ref = ctx.register(buildHighlightDict(ctx, a));
      appendAnnotRef(page, ref);
    } else if (a.kind === "ink") {
      const ref = ctx.register(buildInkDict(ctx, a));
      appendAnnotRef(page, ref);
    } else if (a.kind === "comment") {
      const dict = await buildCommentDict(ctx, a, acroFormSetup);
      const ref = ctx.register(dict);
      appendAnnotRef(page, ref);
    }
  }
}
