// Dump every TextRun on page 2 of the Maldivian fixture along with
// its contentStreamOpIndices, so we can see which Tj ops the strip
// pipeline thinks each run owns.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian.pdf");
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(3_500);

const dump = await page.evaluate(async () => {
  // Pull RenderedPage from the React fiber via a known global hook
  // we can attach in dev. Simpler: walk DOM + sniff data attrs we
  // already export, plus re-extract opIndex on the fly from the
  // actual app modules (importer-by-Function dance to dodge SSR).
  const importer = new Function("p", "return import(p)");
  const sourceFonts = await importer("/src/lib/sourceFonts.ts");
  const res = await fetch(window.location.origin + "/test.pdf");
  const buf = await res.arrayBuffer();
  const shows = await sourceFonts.extractPageFontShows(buf);
  // Per-page snapshot
  const pageDump = [];
  for (let pi = 0; pi < shows.length; pi++) {
    const out = [];
    for (const s of shows[pi]) {
      out.push({
        opIndex: s.opIndex,
        x: s.x,
        y: s.y,
        font: s.fontResource,
        bytesHex: Array.from(s.bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      });
    }
    pageDump.push(out);
  }
  return { showsByPage: pageDump };
});

console.log("=== shows on page 2 ===");
for (const s of dump.showsByPage[1] ?? []) {
  console.log(
    `  op#${s.opIndex.toString().padStart(4)} ${s.font?.padEnd(4)} y=${s.y.toFixed(1).padStart(6)} x=${s.x.toFixed(1).padStart(7)} bytes=${s.bytesHex.slice(0, 40)}`,
  );
}

await browser.close();
process.exit(0);
