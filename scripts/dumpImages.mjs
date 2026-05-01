// Dump every image instance per page, with PDF-space position + size
// and the index of the Tj-equivalent (Do) op + the cm op we'll rewrite
// when the image is dragged.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian.pdf");
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_500);

const out = await page.evaluate(async () => {
  const mod = await import("/src/lib/sourceImages.ts");
  const res = await fetch(window.location.origin + "/test.pdf");
  const buf = await res.arrayBuffer();
  return await mod.extractPageImages(buf);
});

for (let pi = 0; pi < out.length; pi++) {
  console.log(`=== page ${pi + 1}: ${out[pi].length} images ===`);
  for (const img of out[pi]) {
    console.log(
      `  ${img.id} ${img.subtype.padEnd(7)} /${img.resourceName.padEnd(8)}` +
        ` pos=(${img.pdfX.toFixed(1)}, ${img.pdfY.toFixed(1)})` +
        ` size=${img.pdfWidth.toFixed(1)}×${img.pdfHeight.toFixed(1)}` +
        ` cmOp=${img.cmOpIndex} doOp=${img.doOpIndex}` +
        ` ctm=[${img.ctm.map((n) => n.toFixed(2)).join(", ")}]`,
    );
  }
}

await browser.close();
process.exit(0);
