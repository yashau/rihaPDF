// Save: real text replacement.
//
// 1. Parse the page's content stream into typed operations.
// 2. For each edit, find Tj/TJ operators whose text matrix lies inside the
//    edited run's bounding box and remove them — this deletes the original
//    glyphs from the PDF, so text selection / search returns the new text,
//    not the original.
// 3. Embed the bundled Dhivehi font (full, not subsetted, so HarfBuzz's
//    glyph IDs match what pdf-lib writes) and append new text-show
//    operators positioned at the run's baseline with the shaped glyphs.
//
// Multi-font: each edit can pick its own family from the registry. The
// embedded fonts are cached per family across the doc so only the actually-
// used fonts ship in the saved PDF.

import {
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFRef,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { RenderedPage, TextRun } from "./pdf";
import { parseContentStream, serializeContentStream, findTextShows } from "./contentStream";
import { getPageContentBytes, setPageContentBytes } from "./pageContent";
import { DEFAULT_FONT_FAMILY, FONTS, loadFontBytes } from "./fonts";

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
};

export type Edit = {
  pageIndex: number;
  runId: string;
  newText: string;
  style?: EditStyle;
  /** Move offset in viewport pixels — translates the new draw position
   *  by (dx / scale, -dy / scale) in PDF user space (y-flipped). */
  dx?: number;
  dy?: number;
  /** Cross-page move target. When set and != pageIndex, the run is
   *  stripped from `pageIndex` (the origin) and re-drawn on the target
   *  page at (targetPdfX, targetPdfY). Same-page moves use dx/dy and
   *  leave these undefined. */
  targetPageIndex?: number;
  /** Baseline x on the target page in PDF user space (y-up). */
  targetPdfX?: number;
  /** Baseline y on the target page in PDF user space (y-up). */
  targetPdfY?: number;
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
  pageIndex: number;
  imageId: string;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  /** Cross-page move target. When set and != pageIndex, the image is
   *  stripped from origin (its q…Q block removed) and a fresh
   *  q cm /Name Do Q is appended to the target page, replicating the
   *  XObject reference into the target's resources. */
  targetPageIndex?: number;
  /** Bottom-left x on target page in PDF user space (y-up). */
  targetPdfX?: number;
  /** Bottom-left y on target page in PDF user space (y-up). */
  targetPdfY?: number;
  /** Width on target page in PDF user space. */
  targetPdfWidth?: number;
  /** Height on target page in PDF user space. */
  targetPdfHeight?: number;
};

/** Net-new text the user typed at a fresh position on the page. Saved
 *  by appending a draw call to the page's content stream — no
 *  modification of existing ops. */
export type TextInsert = {
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
  pageIndex: number;
  /** Bottom-left in PDF user space (y-up). */
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  bytes: Uint8Array;
  format: "png" | "jpeg";
};

export type PageOp =
  | { kind: "remove"; pageIndex: number }
  | { kind: "insertBlank"; afterPageIndex: number };

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

export async function applyEditsAndSave(
  originalPdfBytes: ArrayBuffer,
  pages: RenderedPage[],
  edits: Edit[],
  pageOps: PageOp[],
  imageMoves: ImageMove[] = [],
  textInserts: TextInsert[] = [],
  imageInserts: ImageInsert[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalPdfBytes);
  doc.registerFontkit(fontkit);

  const editsByPage = new Map<number, Edit[]>();
  for (const e of edits) {
    if (!editsByPage.has(e.pageIndex)) editsByPage.set(e.pageIndex, []);
    editsByPage.get(e.pageIndex)!.push(e);
  }
  const imageMovesByPage = new Map<number, ImageMove[]>();
  for (const m of imageMoves) {
    if (!imageMovesByPage.has(m.pageIndex)) imageMovesByPage.set(m.pageIndex, []);
    imageMovesByPage.get(m.pageIndex)!.push(m);
  }
  // Pages that need a content-stream rewrite even if there are no text
  // edits — image-only moves still go through the stream surgery path.
  const pagesToRewrite = new Set<number>([...editsByPage.keys(), ...imageMovesByPage.keys()]);

  // Per-(family, bold, italic) embedded font. Lazy: only the families
  // and weight/style combinations actually used end up in the saved
  // file. For Latin StandardFonts we pick the matching standard-14
  // variant (Helvetica-Bold, Times-BoldItalic, ...). For Thaana fonts
  // we ignore bold/italic — those families don't ship paired bold or
  // italic variants in our registry, so we just use the regular bytes.
  const fontCache = new Map<string, { pdfFont: PDFFont }>();
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
  const getFont = async (family: string, bold: boolean = false, italic: boolean = false) => {
    const cacheKey = `${family}|${bold ? "b" : ""}${italic ? "i" : ""}`;
    const cached = fontCache.get(cacheKey);
    if (cached) return cached;
    const def = FONTS.find((f) => f.family === family);
    let pdfFont: PDFFont;
    if (def?.standardFont) {
      const variant = standardFontVariants[def.standardFont][variantKey(bold, italic)];
      pdfFont = await doc.embedFont(variant);
    } else {
      const bytes = await loadFontBytes(family);
      pdfFont = await doc.embedFont(bytes, {
        subset: false,
        customName: `DhivehiEdit_${family.replace(/\W+/g, "_")}`,
      });
    }
    const entry = { pdfFont };
    fontCache.set(cacheKey, entry);
    return entry;
  };

  const docPages = doc.getPages();
  // Cross-page draws collected across the per-origin loop and emitted in
  // a final phase, after every origin page has been stripped:
  //   - drawPlans: one per text edit that needs a fresh drawText, tagged
  //     with the page to draw on (origin for same-page edits, target for
  //     cross-page moves).
  //   - imageDrawPlans: one per cross-page image move — needs the origin
  //     XObject ref replicated into the target page's resources, then a
  //     `q cm /Name Do Q` block appended.
  type DrawPlan = {
    edit: Edit;
    run: TextRun;
    /** Page where drawText runs. */
    targetPageIndex: number;
    /** Box-left x in PDF user space on the target page. */
    boxLeftPdf: number;
    /** Baseline y in PDF user space on the target page (y-up). */
    baselineYPdf: number;
    /** Original run width in PDF pts — used as the box width for RTL
     *  right-edge anchoring (text content is unchanged on a pure move,
     *  but if the user also edited text, the new widthPt still
     *  right-anchors against this original box-right). */
    runPdfWidth: number;
    runPdfHeight: number;
  };
  type ImageDrawPlan = {
    move: ImageMove;
    /** PDFRef of the source XObject on the origin page. */
    xobjectRef: PDFRef;
    targetPageIndex: number;
    /** cm operands placing the unit square at (x, y, w, h) on target. */
    cm: [number, number, number, number, number, number];
  };
  const drawPlans: DrawPlan[] = [];
  const imageDrawPlans: ImageDrawPlan[] = [];

  for (const pageIndex of pagesToRewrite) {
    const pageEdits = editsByPage.get(pageIndex) ?? [];
    const pageImageMoves = imageMovesByPage.get(pageIndex) ?? [];
    const page = docPages[pageIndex];
    const rendered = pages[pageIndex];
    if (!page || !rendered) continue;

    // Pre-load all fonts this page needs and register them on the page so
    // the resource names exist before we emit operators referencing them.
    // (Cross-page edits register their font on the TARGET page later via
    // drawText's internal setFont call — handled in the post-loop phase.)
    const familiesUsed = Array.from(
      new Set(
        pageEdits
          .filter((e) => e.targetPageIndex === undefined || e.targetPageIndex === pageIndex)
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
    /** For move-only edits: the indices of the Tj/TJ ops we need to
     *  reposition + the new text-matrix to insert before them. */
    const moveOps: Array<{ tjIndex: number; newTx: number; newTy: number }> = [];

    for (const edit of pageEdits) {
      const run = rendered.textRuns.find((r) => r.id === edit.runId);
      if (!run) continue;
      const runPdfX = run.bounds.left / scale;
      const runPdfY = pageHeight - run.baselineY / scale;
      const runPdfWidth = run.bounds.width / scale;
      const runPdfHeight = run.height / scale;

      // Use the authoritative op-index list propagated from FontShow
      // through TextItem to TextRun (see pdf.ts:applyShowDecodes).
      // Falls back to position-matching only if the run has no
      // recorded op indices (shouldn't happen for source-extracted
      // runs but the fallback keeps old PDFs working).
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

      const isCrossPage = edit.targetPageIndex !== undefined && edit.targetPageIndex !== pageIndex;

      if (isCrossPage) {
        // Cross-page: strip on origin, schedule drawText on target. The
        // Tm-injection pixel-perfect path doesn't apply here because
        // target page has no matching text matrix to translate from.
        for (const s of matched) indicesToRemove.add(s.index);
        drawPlans.push({
          edit,
          run,
          targetPageIndex: edit.targetPageIndex!,
          boxLeftPdf: edit.targetPdfX ?? 0,
          baselineYPdf: edit.targetPdfY ?? 0,
          runPdfWidth,
          runPdfHeight,
        });
        continue;
      }

      // Move-only path: text is unchanged AND there's no formatting
      // override AND we have a non-zero offset. Keep the original glyphs
      // so we get pixel-perfect rendering — just inject a new Tm before
      // each matched Tj/TJ that translates by (dx_pdf, -dy_pdf) from its
      // original text-matrix position.
      const isMoveOnly =
        edit.newText === run.text && !edit.style && ((edit.dx ?? 0) !== 0 || (edit.dy ?? 0) !== 0);
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
        continue; // don't go through the rerender path
      }

      // Otherwise: full edit (text changed, formatting overridden, or
      // both). Remove the matched ops and rerender below.
      for (const s of matched) indicesToRemove.add(s.index);

      const moveX = (edit.dx ?? 0) / scale;
      const moveY = -(edit.dy ?? 0) / scale;
      drawPlans.push({
        edit,
        run,
        targetPageIndex: pageIndex,
        boxLeftPdf: runPdfX + moveX,
        baselineYPdf: runPdfY + moveY,
        runPdfWidth,
        runPdfHeight,
      });
    }

    // Build the new op list:
    //  1. Drop ops we marked for removal (full edits + cross-page moves).
    //  2. For each move-only target, insert a fresh `Tm` op right before
    //     the original Tj/TJ that translates the text matrix to the new
    //     absolute position. The original glyphs follow unchanged so
    //     rendering is pixel-perfect — no rerender via drawText needed.
    const moveByTjIndex = new Map<number, { newTx: number; newTy: number }>();
    for (const m of moveOps) {
      moveByTjIndex.set(m.tjIndex, { newTx: m.newTx, newTy: m.newTy });
    }
    // For each SAME-page moved image, queue a translate `cm` to inject
    // right after the image's opening `q`. That makes the move the
    // OUTERMOST transform in the chain — composing as
    // (existing image cms) × T_translate, which produces a clean
    // (origin + dx, origin + dy) under PDF's row-vector convention.
    // Modifying an existing cm in place fails when there are
    // multiple cm ops in the block (pdf-lib emits 4: translate /
    // identity / scale / identity) because pre-multiplying onto the
    // last identity gets mixed by the preceding scale.
    // For CROSS-page moves, instead remove the entire q…Q block on
    // origin and queue an imageDrawPlan that emits a fresh
    // `q cm /Name Do Q` on the target page.
    const insertAfterQ = new Map<number, [number, number, number, number, number, number]>();
    for (const move of pageImageMoves) {
      const img = rendered.images.find((i) => i.id === move.imageId);
      if (!img || img.qOpIndex == null) continue;

      const isCrossPage = move.targetPageIndex !== undefined && move.targetPageIndex !== pageIndex;

      if (isCrossPage) {
        // Origin: strip the whole q…Q block so the image vanishes from
        // its source page. Walk forward tracking nested q/Q depth to
        // find the matching Q.
        const matchingQ = findMatchingQ(ops, img.qOpIndex);
        if (matchingQ != null) {
          for (let k = img.qOpIndex; k <= matchingQ; k++) indicesToRemove.add(k);
        }
        // Find the source XObject ref on the origin page so we can
        // hand it to the target page later.
        const ref = lookupPageXObjectRef(doc, page.node, img.resourceName);
        if (!ref) continue; // can't replicate without a ref — skip move
        const w = move.targetPdfWidth ?? img.pdfWidth;
        const h = move.targetPdfHeight ?? img.pdfHeight;
        const tx = move.targetPdfX ?? img.pdfX;
        const ty = move.targetPdfY ?? img.pdfY;
        imageDrawPlans.push({
          move,
          xobjectRef: ref,
          targetPageIndex: move.targetPageIndex!,
          cm: [w, 0, 0, h, tx, ty],
        });
        continue;
      }

      // Same-page: cm injection (existing path).
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
      // Avoid div-by-zero when the source image was already 0×0
      // (shouldn't happen — sourceImages skips those — but guard anyway).
      const sx = oldW > 1e-6 ? newW / oldW : 1;
      const sy = oldH > 1e-6 ? newH / oldH : 1;
      // ex/ey solve `oldX * sx + ex = newX` (and same for y) so the
      // bottom-left lands at (newX, newY) under the prepended cm.
      const ex = newX - oldX * sx;
      const ey = newY - oldY * sy;
      insertAfterQ.set(img.qOpIndex, [sx, 0, 0, sy, ex, ey]);
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
      // After we push a `q` op that an image-move targets, inject the
      // translate cm so it becomes the outermost transform in the
      // image's chain.
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

  // Cross-page image draws: replicate the source XObject onto each target
  // page's resources and append a `q cm /Name Do Q` block. Done after the
  // origin strip so the strip mutations are committed before we touch
  // anything else on the target page.
  for (const plan of imageDrawPlans) {
    const targetPage = docPages[plan.targetPageIndex];
    if (!targetPage) continue;
    // newXObject auto-picks a non-conflicting name on the target page's
    // Resources/XObject dict and returns the chosen PDFName.
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

  // Append the replacement text via pdf-lib's drawText so its internal
  // Unicode→CID encoding matches the font it embedded. (Bypassing it
  // and writing raw CIDs from HarfBuzz fails because pdf-lib still
  // renumbers glyphs in its embed pipeline; the saved file would map
  // our CIDs to wrong glyphs.) For Thaana we lose proper GPOS mark
  // positioning — combining marks rely on the font's hmtx zero-advance
  // entry to stack on top of the base. NotoSansThaana / Faruma do
  // ship those, so simple drawText still renders correctly visually
  // for most Dhivehi text.
  for (const plan of drawPlans) {
    const { edit, run, targetPageIndex, boxLeftPdf, baselineYPdf, runPdfWidth, runPdfHeight } =
      plan;
    const targetPage = docPages[targetPageIndex];
    if (!targetPage) continue;
    const style = edit.style ?? {};
    // Default the formatting to whatever the original run carried —
    // the user can still override any of these via the toolbar but
    // doing nothing should preserve the source's look.
    const family = style.fontFamily ?? run.fontFamily ?? DEFAULT_FONT_FAMILY;
    const fontSizePt = style.fontSize ?? runPdfHeight;
    // `??` (not `||`) so an explicit `style.bold = false` overrides
    // a `run.bold = true` source detection — that's the
    // toggle-off-an-already-bold-run flow.
    const bold = style.bold ?? run.bold;
    const italic = style.italic ?? run.italic;
    // For Latin StandardFonts (Helvetica / Times / Courier) getFont
    // can pick the bold/italic variant. Thaana fonts in the registry
    // don't ship paired variants so getFont silently falls back to
    // the regular bytes — bold/italic on Dhivehi runs remains
    // editor-preview only for now (documented limitation).
    const { pdfFont } = await getFont(family, bold, italic);

    // Right-align RTL replacements at the original run's right edge so
    // the first logical character lands where it used to. boxLeftPdf
    // already incorporates same-page (dx/scale) or cross-page (target
    // box-left) positioning — RTL just shifts the draw start so the
    // right edge of the new text matches the box-right.
    const isRtl = /[֐-׿؀-ۿހ-޿]/u.test(edit.newText);
    const widthPt = pdfFont.widthOfTextAtSize(edit.newText, fontSizePt);
    const baseX = isRtl ? boxLeftPdf + runPdfWidth - widthPt : boxLeftPdf;
    const drawY = baselineYPdf;

    // Use pdf-lib's drawText for the actual glyph rendering — it owns
    // the Unicode → CID encoding pipeline and handcrafted Tj operands
    // misrender (the embedded font's CIDToGIDMap doesn't match raw
    // encodeText output for subset:false fonts). Bold is simulated
    // with a second drawText call offset by ~5% of the font size, the
    // same trick web browsers use for synthetic bold. Italic in the
    // saved PDF needs a sheared Tm before Tj — deferred until we have
    // a working raw-ops path; for now it's editor-preview only.
    targetPage.drawText(edit.newText, {
      x: baseX,
      y: drawY,
      size: fontSizePt,
      font: pdfFont,
      color: rgb(0, 0, 0),
    });
    // bold/italic are now baked into the font choice via getFont
    // above (Latin StandardFonts only). For Thaana we keep using the
    // regular variant — synthetic double-draw broke text extraction
    // and the registry doesn't ship paired variants.

    if (style.underline) {
      const underlineY = drawY - Math.max(1, fontSizePt * 0.08);
      targetPage.drawLine({
        start: { x: baseX, y: underlineY },
        end: { x: baseX + widthPt, y: underlineY },
        thickness: Math.max(0.5, fontSizePt * 0.05),
        color: rgb(0, 0, 0),
      });
    }
  }

  // Net-new insertions (text the user typed at fresh positions, images
  // dropped from disk). These don't touch existing content streams —
  // pdf-lib's page.drawText / drawImage helpers append to the page's
  // existing Contents.
  for (const ins of textInserts) {
    const page = docPages[ins.pageIndex];
    if (!page) continue;
    if (!ins.text || ins.text.trim().length === 0) continue;
    const family =
      ins.style?.fontFamily ??
      // default per-script: Thaana → Faruma, otherwise Arial
      (/[֐-׿؀-ۿހ-޿]/u.test(ins.text) ? DEFAULT_FONT_FAMILY : "Arial");
    const bold = !!ins.style?.bold;
    const italic = !!ins.style?.italic;
    const { pdfFont } = await getFont(family, bold, italic);
    const fontSizePt = ins.fontSize;
    // For RTL, anchor the draw at the right edge by subtracting
    // pdf-lib's measured width from the click position so the first
    // logical character ends up roughly where the user clicked.
    const isRtl = /[֐-׿؀-ۿހ-޿]/u.test(ins.text);
    const widthPt = pdfFont.widthOfTextAtSize(ins.text, fontSizePt);
    const baseX = isRtl ? ins.pdfX - widthPt : ins.pdfX;
    page.drawText(ins.text, {
      x: baseX,
      y: ins.pdfY,
      size: fontSizePt,
      font: pdfFont,
      color: rgb(0, 0, 0),
    });
    if (ins.style?.underline) {
      const underlineY = ins.pdfY - Math.max(1, fontSizePt * 0.08);
      page.drawLine({
        start: { x: baseX, y: underlineY },
        end: { x: baseX + widthPt, y: underlineY },
        thickness: Math.max(0.5, fontSizePt * 0.05),
        color: rgb(0, 0, 0),
      });
    }
  }

  // Embed each unique image once, then draw at its placement. Different
  // insertions sharing the same byte buffer reuse the embedded XObject
  // so the saved file stays small.
  const embeddedImageCache = new Map<Uint8Array, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const ins of imageInserts) {
    const page = docPages[ins.pageIndex];
    if (!page) continue;
    let embedded = embeddedImageCache.get(ins.bytes);
    if (!embedded) {
      embedded =
        ins.format === "png" ? await doc.embedPng(ins.bytes) : await doc.embedJpg(ins.bytes);
      embeddedImageCache.set(ins.bytes, embedded);
    }
    page.drawImage(embedded, {
      x: ins.pdfX,
      y: ins.pdfY,
      width: ins.pdfWidth,
      height: ins.pdfHeight,
    });
  }

  // Page operations applied last; sort removals high-to-low so they don't
  // shift later indices.
  const sortedOps = [...pageOps].sort((a, b) => {
    const ai = a.kind === "remove" ? a.pageIndex : a.afterPageIndex;
    const bi = b.kind === "remove" ? b.pageIndex : b.afterPageIndex;
    return bi - ai;
  });
  for (const op of sortedOps) {
    if (op.kind === "remove") {
      doc.removePage(op.pageIndex);
    } else {
      const ref = docPages[op.afterPageIndex];
      const size = ref
        ? ([ref.getWidth(), ref.getHeight()] as [number, number])
        : ([595.28, 841.89] as [number, number]);
      doc.insertPage(op.afterPageIndex + 1, size);
    }
  }

  return doc.save();
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
