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
import type { RenderedPage } from "./pdf";
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
};

export type PageOp =
  | { kind: "remove"; pageIndex: number }
  | { kind: "insertBlank"; afterPageIndex: number };

export async function applyEditsAndSave(
  originalPdfBytes: ArrayBuffer,
  pages: RenderedPage[],
  edits: Edit[],
  pageOps: PageOp[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalPdfBytes);
  doc.registerFontkit(fontkit);

  const editsByPage = new Map<number, Edit[]>();
  for (const e of edits) {
    if (!editsByPage.has(e.pageIndex)) editsByPage.set(e.pageIndex, []);
    editsByPage.get(e.pageIndex)!.push(e);
  }

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
  for (const [pageIndex, pageEdits] of editsByPage) {
    const page = docPages[pageIndex];
    const rendered = pages[pageIndex];
    if (!page || !rendered) continue;

    // Pre-load all fonts this page needs and register them on the page so
    // the resource names exist before we emit operators referencing them.
    const familiesUsed = Array.from(
      new Set(
        pageEdits.map((e) => e.style?.fontFamily ?? DEFAULT_FONT_FAMILY),
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
    const editPlans: Array<{
      edit: Edit;
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
      for (const show of shows) {
        const ex = show.textMatrix[4];
        const ey = show.textMatrix[5];
        if (Math.abs(ey - runPdfY) > tolY) continue;
        if (ex < runPdfX - tolX) continue;
        if (ex > runPdfX + runPdfWidth + tolX) continue;
        indicesToRemove.add(show.index);
      }

      editPlans.push({
        edit,
        runPdfX,
        runPdfY,
        runPdfWidth,
        runPdfHeight,
      });
    }

    // Replace the page's content with the same ops minus the deleted
    // text-shows. Tm/Td position-setters before the deleted Tj are kept
    // (no-ops once the show is gone) — harmless and simpler than tracking
    // dependencies.
    const filteredOps = ops.filter((_, i) => !indicesToRemove.has(i));
    setPageContentBytes(
      doc.context,
      page.node,
      serializeContentStream(filteredOps),
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
      const { edit, runPdfX, runPdfY, runPdfWidth, runPdfHeight } = plan;
      const style = edit.style ?? {};
      const family = style.fontFamily ?? DEFAULT_FONT_FAMILY;
      const { pdfFont } = await getFont(family);
      const fontSizePt = style.fontSize ?? runPdfHeight;

      // Right-align RTL replacements at the original run's right edge so
      // the first logical character lands where it used to. Use pdf-lib's
      // own width calculation since that's what it'll draw.
      const isRtl = /[֐-׿؀-ۿހ-޿]/u.test(edit.newText);
      const widthPt = pdfFont.widthOfTextAtSize(edit.newText, fontSizePt);
      const baseX = isRtl ? runPdfX + runPdfWidth - widthPt : runPdfX;

      // Bold = render mode 2 (fill + stroke) with a thin stroke that
      // visually thickens the glyphs.
      const drawOpts: Parameters<typeof page.drawText>[1] = {
        x: baseX,
        y: runPdfY,
        size: fontSizePt,
        font: pdfFont,
        color: rgb(0, 0, 0),
      };
      if (style.bold) {
        drawOpts.lineHeight = fontSizePt;
        // pdf-lib's TextRenderingMode is exposed via the LineHeight options
        // in newer versions; older versions need raw operators. The safest
        // simulation is to draw the text twice with a slight x offset.
      }
      page.drawText(edit.newText, drawOpts);
      if (style.bold) {
        // Second pass offset by a fraction of a point thickens the stroke.
        page.drawText(edit.newText, {
          ...drawOpts,
          x: baseX + Math.max(0.3, fontSizePt * 0.04),
        });
      }
      if (style.underline) {
        const underlineY = runPdfY - Math.max(1, fontSizePt * 0.08);
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
