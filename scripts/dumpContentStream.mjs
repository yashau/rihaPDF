// Dump raw content-stream Tj/TJ ops for page 1 (active font, position,
// raw operand bytes) so we can see which Tj draws the long fili in the
// source PDF and whether they live on the main page or in a Form XObject.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(
  root,
  "test/fixtures/maldivian.pdf",
);
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/");
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_000);

const out = await page.evaluate(async () => {
  // Use the app's already-loaded source-fonts module.
  const mod = await import("/src/lib/sourceFonts.ts");
  const res = await fetch(window.location.origin + "/test.pdf");
  if (!res.ok) return { error: "no test.pdf served" };
  const buf = await res.arrayBuffer();
  const shows = await mod.extractPageFontShows(buf);
  return {
    pageCount: shows.length,
    page1: shows[0]?.map((s) => ({
      x: s.x,
      y: s.y,
      base: s.baseFont,
      bytes: Array.from(s.bytes).map((b) => b.toString(16).padStart(2, "0")).join(""),
    })) ?? [],
  };
});
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
await browser.close();
process.exit(0);
