// Build pdf-lib annotation dicts from our Annotation values and append
// them to a page's /Annots array. pdf-lib has no first-class annotation
// builder, so we construct PDFDict / PDFArray directly. Each annotation
// kind maps to a single PDF /Subtype:
//   highlight → /Highlight (text-markup with /QuadPoints)
//   comment   → /FreeText  (visible inline text box on the annot layer)
//   ink       → /Ink        (freehand strokes via /InkList)
//
// We don't generate /AP appearance streams — Acrobat, Preview, Chrome,
// and pdf.js all auto-render appearances for these subtypes from the
// shape fields (/QuadPoints, /Rect, /InkList, /C). Some legacy readers
// won't, which is the documented v1 trade-off.

import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFString,
} from "pdf-lib";
import {
  annotationBBox,
  type Annotation,
  type AnnotationColor,
  type CommentAnnotation,
  type HighlightAnnotation,
  type InkAnnotation,
} from "./annotations";

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

/** PDF text strings supporting Unicode use a UTF-16BE byte sequence
 *  prefixed with the BOM 0xFEFF, written as a hex string. /Contents on
 *  /Text and /Highlight comment fields needs this encoding to carry
 *  Thaana / emoji / any non-PDFDocEncoding codepoint. */
function encodeUtf16BE(s: string): PDFHexString {
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      bytes.push((cp >> 8) & 0xff, cp & 0xff);
    } else {
      const off = cp - 0x10000;
      const hi = 0xd800 + (off >> 10);
      const lo = 0xdc00 + (off & 0x3ff);
      bytes.push((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return PDFHexString.of(hex);
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

/** Build a /FreeText annotation: a visible inline text box on the
 *  annotation layer. Required for FreeText:
 *    - /DA: default appearance string. "/Helv NN Tf 0 0 0 rg" tells
 *      the viewer to render in NN-pt Helvetica, black. Most readers
 *      (Acrobat, Preview, Chrome, pdf.js) auto-resolve /Helv to
 *      Helvetica even without a /DR entry.
 *    - /Contents: the body text (UTF-16BE for non-ASCII).
 *    - /BS /W 0: suppress the default 1pt border viewers draw around
 *      FreeText. Without this we get a dark border around the box
 *      that doesn't match the on-screen editor's appearance.
 *    - /IC: interior fill color. For /FreeText, /C is the BORDER color
 *      and /IC is the fill — they're separate keys (different from
 *      /Highlight where /C is the fill). With /BS /W 0 the border
 *      isn't drawn, but we still set /IC so the box body fills yellow.
 *  We don't ship an /AP appearance stream — viewers regenerate one
 *  from /DA + /Contents. Some legacy readers won't, which is the
 *  v1 trade-off documented in the plan. */
function buildCommentDict(ctx: PDFContext, a: CommentAnnotation): PDFDict {
  const dict = PDFDict.withContext(ctx);
  setBaseAnnotFields(dict, ctx, annotationBBox(a), a.color, a.text);
  dict.set(PDFName.of("Subtype"), PDFName.of("FreeText"));
  dict.set(PDFName.of("DA"), PDFString.of(`/Helv ${a.fontSize} Tf 0 0 0 rg`));
  // /Q = quadding (text alignment): 0 = left.
  dict.set(PDFName.of("Q"), PDFNumber.of(0));
  dict.set(PDFName.of("IC"), colorArray(ctx, a.color));
  const bs = PDFDict.withContext(ctx);
  bs.set(PDFName.of("Type"), PDFName.of("Border"));
  bs.set(PDFName.of("W"), PDFNumber.of(0));
  bs.set(PDFName.of("S"), PDFName.of("S"));
  dict.set(PDFName.of("BS"), bs);
  return dict;
}

/** Append every annotation in `list` to its target page's /Annots
 *  array. Pages are looked up by `pageIndex` on the source's doc. */
export function applyAnnotationsToDoc(
  doc: { context: PDFContext; getPages: () => PDFPage[] },
  annotations: Annotation[],
): void {
  const ctx = doc.context;
  const pages = doc.getPages();
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
      const ref = ctx.register(buildCommentDict(ctx, a));
      appendAnnotRef(page, ref);
    }
  }
}
