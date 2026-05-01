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

import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { RenderedPage, TextRun } from "./pdf";
import {
  parseContentStream,
  serializeContentStream,
  findTextShows,
} from "./contentStream";
import { getPageContentBytes, setPageContentBytes } from "./pageContent";
import {
  DEFAULT_FONT_FAMILY,
  FONTS,
  loadFontBytes,
} from "./fonts";

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
  const pagesToRewrite = new Set<number>([
    ...editsByPage.keys(),
    ...imageMovesByPage.keys(),
  ]);

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
  const getFont = async (
    family: string,
    bold: boolean = false,
    italic: boolean = false,
  ) => {
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
  for (const pageIndex of pagesToRewrite) {
    const pageEdits = editsByPage.get(pageIndex) ?? [];
    const pageImageMoves = imageMovesByPage.get(pageIndex) ?? [];
    const page = docPages[pageIndex];
    const rendered = pages[pageIndex];
    if (!page || !rendered) continue;

    // Pre-load all fonts this page needs and register them on the page so
    // the resource names exist before we emit operators referencing them.
    const familiesUsed = Array.from(
      new Set(
        pageEdits.map((e) => {
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
    const moveOps: Array<{ tjIndex: number; newTx: number; newTy: number }> =
      [];
    const editPlans: Array<{
      edit: Edit;
      run: TextRun;
      runPdfX: number;
      runPdfY: number;
      runPdfWidth: number;
      runPdfHeight: number;
    }> = [];

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
      let matched = shows.filter((s) =>
        run.contentStreamOpIndices.includes(s.index),
      );
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

      // Move-only path: text is unchanged AND there's no formatting
      // override AND we have a non-zero offset. Keep the original glyphs
      // so we get pixel-perfect rendering — just inject a new Tm before
      // each matched Tj/TJ that translates by (dx_pdf, -dy_pdf) from its
      // original text-matrix position.
      const isMoveOnly =
        edit.newText === run.text &&
        !edit.style &&
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
        continue; // don't go through the rerender path
      }

      // Otherwise: full edit (text changed, formatting overridden, or
      // both). Remove the matched ops and rerender below.
      for (const s of matched) indicesToRemove.add(s.index);

      editPlans.push({
        edit,
        run,
        runPdfX,
        runPdfY,
        runPdfWidth,
        runPdfHeight,
      });
    }

    // Build the new op list:
    //  1. Drop ops we marked for removal (full edits).
    //  2. For each move-only target, insert a fresh `Tm` op right before
    //     the original Tj/TJ that translates the text matrix to the new
    //     absolute position. The original glyphs follow unchanged so
    //     rendering is pixel-perfect — no rerender via drawText needed.
    const moveByTjIndex = new Map<
      number,
      { newTx: number; newTy: number }
    >();
    for (const m of moveOps) {
      moveByTjIndex.set(m.tjIndex, { newTx: m.newTx, newTy: m.newTy });
    }
    // For each moved image, queue a translate `cm` to inject right
    // after the image's opening `q`. That makes the move the
    // OUTERMOST transform in the chain — composing as
    // (existing image cms) × T_translate, which produces a clean
    // (origin + dx, origin + dy) under PDF's row-vector convention.
    // Modifying an existing cm in place fails when there are
    // multiple cm ops in the block (pdf-lib emits 4: translate /
    // identity / scale / identity) because pre-multiplying onto the
    // last identity gets mixed by the preceding scale.
    // Each entry holds the 6 operands of the outer cm to inject
    // right after the image's q. The composed transform takes the
    // unit-square corner `(u_pdf, v_pdf)` produced by the existing
    // image chain and maps it to `(sx*u + ex, sy*v + ey)`.
    const insertAfterQ = new Map<
      number,
      [number, number, number, number, number, number]
    >();
    for (const move of pageImageMoves) {
      const img = rendered.images.find((i) => i.id === move.imageId);
      if (!img || img.qOpIndex == null) continue;
      // Convert viewport-pixel deltas to PDF user space.
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
    setPageContentBytes(
      doc.context,
      page.node,
      serializeContentStream(newOps),
    );

    // Append the replacement text via pdf-lib's drawText so its internal
    // Unicode→CID encoding matches the font it embedded. (Bypassing it
    // and writing raw CIDs from HarfBuzz fails because pdf-lib still
    // renumbers glyphs in its embed pipeline; the saved file would map
    // our CIDs to wrong glyphs.) For Thaana we lose proper GPOS mark
    // positioning — combining marks rely on the font's hmtx zero-advance
    // entry to stack on top of the base. NotoSansThaana / Faruma do
    // ship those, so simple drawText still renders correctly visually
    // for most Dhivehi text.
    for (const plan of editPlans) {
      const { edit, run, runPdfX, runPdfY, runPdfWidth, runPdfHeight } = plan;
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
      // the first logical character lands where it used to. Use pdf-lib's
      // own width calculation since that's what it'll draw. Then apply
      // the user's drag-move offset on top.
      const isRtl = /[֐-׿؀-ۿހ-޿]/u.test(edit.newText);
      const widthPt = pdfFont.widthOfTextAtSize(edit.newText, fontSizePt);
      const moveX = (edit.dx ?? 0) / rendered.scale;
      const moveY = -(edit.dy ?? 0) / rendered.scale;
      const baseX =
        (isRtl ? runPdfX + runPdfWidth - widthPt : runPdfX) + moveX;
      const drawY = runPdfY + moveY;

      // Use pdf-lib's drawText for the actual glyph rendering — it owns
      // the Unicode → CID encoding pipeline and handcrafted Tj operands
      // misrender (the embedded font's CIDToGIDMap doesn't match raw
      // encodeText output for subset:false fonts). Bold is simulated
      // with a second drawText call offset by ~5% of the font size, the
      // same trick web browsers use for synthetic bold. Italic in the
      // saved PDF needs a sheared Tm before Tj — deferred until we have
      // a working raw-ops path; for now it's editor-preview only.
      page.drawText(edit.newText, {
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
        page.drawLine({
          start: { x: baseX, y: underlineY },
          end: { x: baseX + widthPt, y: underlineY },
          thickness: Math.max(0.5, fontSizePt * 0.05),
          color: rgb(0, 0, 0),
        });
      }
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
  const embeddedImageCache = new Map<
    Uint8Array,
    Awaited<ReturnType<typeof doc.embedPng>>
  >();
  for (const ins of imageInserts) {
    const page = docPages[ins.pageIndex];
    if (!page) continue;
    let embedded = embeddedImageCache.get(ins.bytes);
    if (!embedded) {
      embedded =
        ins.format === "png"
          ? await doc.embedPng(ins.bytes)
          : await doc.embedJpg(ins.bytes);
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
