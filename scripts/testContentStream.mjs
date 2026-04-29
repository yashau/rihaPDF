// Round-trip test for the content-stream parser. Loads page 1's content
// stream from the test PDF (via Playwright in the running app), parses it,
// serializes back, and prints diagnostics so we can see how well we
// reconstruct.
//
// Also: do an in-place edit (find a Tj op, replace its operand with new
// hex bytes), serialize, write back to the page, and save the resulting
// PDF for visual inspection.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF_PATH = path.resolve(
  root,
  "..",
  "hn41badsfTXSpmf0opxlFBWgTLAJX5rWubbshJYC.pdf",
);

setTimeout(() => process.exit(2), 90_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(PDF_PATH);
await page.waitForSelector("[data-page-index]", { timeout: 20_000 });
await page.waitForTimeout(1500);

// Now run a script that uses our parser to round-trip page 1's content
// stream and report stats.
const result = await page.evaluate(async () => {
  // @ts-expect-error dynamic import in browser context
  const { parseContentStream, serializeContentStream, findTextShows } =
    await import("/src/lib/contentStream.ts");
  const { PDFDocument, decodePDFRawStream, PDFRawStream, PDFArray, PDFName } =
    await import("/node_modules/pdf-lib/es/index.js");
  // Fetch the PDF via our app's already-loaded copy:
  const fileInput = document.querySelector('input[type="file"]');
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) return { error: "no file in input" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  const contentsRef = page.node.Contents();
  if (!contentsRef) return { error: "no Contents on page" };

  // Resolve to raw stream bytes (uncompressed).
  let allBytes = new Uint8Array(0);
  const collect = (raw) => {
    const decoded = decodePDFRawStream(raw).decode();
    const merged = new Uint8Array(allBytes.length + decoded.length + 1);
    merged.set(allBytes, 0);
    merged.set([0x0a], allBytes.length);
    merged.set(decoded, allBytes.length + 1);
    allBytes = merged;
  };

  if (contentsRef instanceof PDFRawStream) {
    collect(contentsRef);
  } else if (contentsRef instanceof PDFArray) {
    for (const item of contentsRef.asArray()) {
      const resolved = doc.context.lookup(item);
      if (resolved instanceof PDFRawStream) collect(resolved);
    }
  }

  const ops = parseContentStream(allBytes);
  const shows = findTextShows(ops);
  const reser = serializeContentStream(ops);

  return {
    rawSize: allBytes.length,
    opCount: ops.length,
    showCount: shows.length,
    firstShows: shows.slice(0, 10).map((s) => ({
      idx: s.index,
      op: s.op.op,
      font: s.fontName,
      fontSize: s.fontSize,
      x: s.textMatrix[4],
      y: s.textMatrix[5],
      operandKinds: s.op.operands.map((o) => o.kind),
    })),
    reserSize: reser.length,
    sizeDelta: reser.length - allBytes.length,
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(0);
