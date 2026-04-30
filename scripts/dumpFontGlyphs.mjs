// Inspect each embedded font's glyph IDs / PostScript names / cmap mappings
// for the test PDF. Uses the app's own dev module (src/dev/dumpGlyphs.ts)
// so Vite resolves the bundled @pdf-lib/fontkit + pdf-lib correctly.

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
await page.locator('input[type="file"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_000);

const result = await page.evaluate(async () => {
  const mod = await import("/src/dev/dumpGlyphs.ts");
  const res = await fetch(window.location.origin + "/test.pdf");
  if (!res.ok) return { error: "fetch failed" };
  const buf = await res.arrayBuffer();
  return await mod.dumpGlyphs(buf);
});

console.log(JSON.stringify(result, null, 2).slice(0, 18000));
await browser.close();
process.exit(0);
