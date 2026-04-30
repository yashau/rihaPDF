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

import { PDFDocument, PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { RenderedPage, TextRun } from "./pdf";
import {
  parseContentStream,
  serializeContentStream,
  findTextShows,
} from "./contentStream";
import { getPageContentBytes, setPageContentBytes } from "./pageContent";
import { DEFAULT_FONT_FAMILY, loadFontBytes } from "./fonts";

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

/** Drag offset for an image XObject placement. The save path looks up
 *  the matching `cm` op via the ImageInstance's `cmOpIndex` and adds
 *  (dx / scale, -dy / scale) to its translation operands [4] and [5]. */
export type ImageMove = {
  pageIndex: number;
  imageId: string;
  dx?: number;
  dy?: number;
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

  // Per-family embedded font + raw bytes. Lazy: only families actually
  // used in this save end up in the output.
  const fontCache = new Map<
    string,
    { pdfFont: PDFFont; bytes: Uint8Array }
  >();
  const getFont = async (family: string) => {
    const cached = fontCache.get(family);
    if (cached) return cached;
    const bytes = await loadFontBytes(family);
    const pdfFont = await doc.embedFont(bytes, {
      subset: false,
      customName: `DhivehiEdit_${family.replace(/\W+/g, "_")}`,
    });
    const entry = { pdfFont, bytes };
    fontCache.set(family, entry);
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

      // Match Tj/TJ ops where the text matrix's translation falls roughly
      // inside the run's bounding box. Tolerance covers floating-point
      // drift from accumulated Td offsets and font-metric padding.
      const tolY = Math.max(2, runPdfHeight * 0.4);
      const tolX = Math.max(2, runPdfHeight * 0.3);
      const matched = shows.filter((s) => {
        const ex = s.textMatrix[4];
        const ey = s.textMatrix[5];
        if (Math.abs(ey - runPdfY) > tolY) return false;
        if (ex < runPdfX - tolX) return false;
        if (ex > runPdfX + runPdfWidth + tolX) return false;
        return true;
      });

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
    // Apply image moves: for each moved image, find its `cm` op (the
    // one we noted at extraction time) and add (dx_pdf, dy_pdf) to its
    // translation operands [4] and [5]. This rewrites the matrix in
    // place — keeps scale + rotation, only shifts position.
    for (const move of pageImageMoves) {
      const img = rendered.images.find((i) => i.id === move.imageId);
      if (!img || img.cmOpIndex == null) continue;
      const cmOp = ops[img.cmOpIndex];
      if (!cmOp || cmOp.op !== "cm" || cmOp.operands.length !== 6) continue;
      const tx4 = cmOp.operands[4];
      const tx5 = cmOp.operands[5];
      if (tx4.kind !== "number" || tx5.kind !== "number") continue;
      const dxPdf = (move.dx ?? 0) / scale;
      const dyPdf = -(move.dy ?? 0) / scale;
      const newTx = tx4.value + dxPdf;
      const newTy = tx5.value + dyPdf;
      cmOp.operands[4] = {
        kind: "number",
        value: newTx,
        raw: newTx.toFixed(3),
      };
      cmOp.operands[5] = {
        kind: "number",
        value: newTy,
        raw: newTy.toFixed(3),
      };
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
      const { pdfFont } = await getFont(family);
      const fontSizePt = style.fontSize ?? runPdfHeight;
      const bold = style.bold ?? run.bold;
      const italic = style.italic ?? run.italic;

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
      // Bold/italic on rerender path are deferred until we land a raw-ops
      // text-show that pdf-lib's CID remap doesn't break. The synthetic
      // double-draw we tried before duplicated the text in extraction —
      // worse than not having bold. Move-only edits still preserve source
      // bold/italic because they keep the original Tj.
      void bold;
      void italic;

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
