// Compare each pdf.js item's str against the CID-decoded bytes from the
// matching content-stream show. Useful to diagnose where fixMisextractedChars
// is producing unexpected output.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(
  root,
  "hn41badsfTXSpmf0opxlFBWgTLAJX5rWubbshJYC.pdf",
);
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_500);

const PAGE_IDX = Number(process.argv[2] ?? "0");
const out = await page.evaluate(async (pageIndex) => {
  globalThis._DUMP_PAGE_INDEX = pageIndex;
  const mod = await import("/src/dev/dumpDecodeTrace.ts");
  const res = await fetch(window.location.origin + "/test.pdf");
  const buf = await res.arrayBuffer();
  return await mod.dumpDecodeTrace(buf);
}, PAGE_IDX);

for (const t of out) {
  if (typeof t.i !== "number") continue;
  console.log(
    `i=${String(t.i).padStart(3)} (${String(t.x).padStart(6)},${String(t.y).padStart(6)})  pdf="${t.str}"  decoded="${t.decoded}"`,
  );
  console.log(
    `       pdfHex=${t.strHex}  decHex=${t.decodedHex}  font=${t.fontResource}  dist=${t.bestDist?.toFixed(2)}`,
  );
}

await browser.close();
process.exit(0);
