// Dev-only: re-run the per-page text extraction the app uses, then for each
// item dump the str pdf.js returned alongside the CID-decoded bytes from
// the matching content-stream show. We use this to understand why the
// fixMisextractedChars override path emits unexpected output.

import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PDFDocument } from "pdf-lib";
import { extractPageGlyphMaps, decodeShowBytes } from "../lib/glyphMap";
import { extractPageFontShows } from "../lib/sourceFonts";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function dumpDecodeTrace(pdfBytes: ArrayBuffer): Promise<unknown> {
  const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  const plDoc = await PDFDocument.load(pdfBytes.slice(0));
  const fontShowsAll = await extractPageFontShows(pdfBytes.slice(0));
  const pageIndexParam = (globalThis as { _DUMP_PAGE_INDEX?: number })
    ._DUMP_PAGE_INDEX ?? 0;
  const glyphMap = extractPageGlyphMaps(plDoc, pageIndexParam);
  const page = await doc.getPage(pageIndexParam + 1);
  const viewport = page.getViewport({ scale: 1.5 });
  const content = await page.getTextContent({
    disableCombineTextItems: true,
  } as Parameters<typeof page.getTextContent>[0]);

  // We don't compose with viewport here (matches how the dump expects to
  // map back to PDF user space).
  const itemTrace: unknown[] = [];
  for (let i = 0; i < content.items.length; i++) {
    const it = content.items[i] as {
      str: string;
      transform: number[];
      width: number;
      hasEOL: boolean;
    };
    const x = +it.transform[4].toFixed(2);
    const y = +it.transform[5].toFixed(2);
    // Find matching show.
    let bestShow: { fontResource: string | null; bytes: Uint8Array } | null =
      null;
    let bestDist = Infinity;
    for (const s of fontShowsAll[pageIndexParam] ?? []) {
      const d = Math.abs(s.x - x) + Math.abs(s.y - y) * 10;
      if (d < bestDist) {
        bestDist = d;
        bestShow = s;
      }
    }
    let decoded = "";
    if (bestShow && bestShow.fontResource) {
      const m = glyphMap.get(bestShow.fontResource);
      if (m) decoded = decodeShowBytes(bestShow.bytes, m);
    }
    itemTrace.push({
      i,
      str: it.str,
      strHex: Array.from(it.str)
        .map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0"))
        .join(" "),
      x,
      y,
      decoded,
      decodedHex: Array.from(decoded)
        .map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0"))
        .join(" "),
      bestDist,
      fontResource: bestShow?.fontResource ?? null,
    });
  }
  void viewport;
  return itemTrace;
}
