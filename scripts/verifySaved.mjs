// Load the just-saved PDF and screenshot the title region to verify the
// whiteout + redraw landed in the right spot with the right text.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
// Pick the most recent saved-*.pdf if it exists, else fall back to saved.pdf.
const screenshotsRoot = path.resolve(root, "scripts", "screenshots");
const stamped = fs
  .readdirSync(screenshotsRoot)
  .filter((f) => /^saved-.*\.pdf$/.test(f))
  .sort();
const SAVED = stamped.length
  ? path.join(screenshotsRoot, stamped[stamped.length - 1])
  : path.join(screenshotsRoot, "saved.pdf");
console.log("Verifying:", SAVED);
const OUT = path.resolve(root, "scripts", "screenshots", "verified-title.png");

setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(SAVED);
await page.waitForSelector("[data-page-index]", { timeout: 20_000 });
await page.waitForTimeout(1500);

// Hide overlays so we see only the saved PDF render.
await page.addStyleTag({
  content: `[data-page-index] > div:nth-child(2) { visibility: hidden; }`,
});

// Force every scroll container to the top — React's overflow-auto main
// container can re-scroll itself otherwise.
await page.evaluate(() => {
  document.querySelectorAll("main, [data-page-index]").forEach((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  window.scrollTo(0, 0);
});
await page.waitForTimeout(200);

// Snapshot just the canvas element of page 1 — this captures the actual
// raster of the saved PDF without depending on viewport scroll position.
const canvas = page.locator('[data-page-index="0"] canvas').first();
const canvasBox = await canvas.boundingBox().catch(() => null);
if (canvasBox) {
  await canvas.screenshot({ path: OUT });
} else {
  await page.screenshot({ path: OUT, fullPage: true });
}
await page.screenshot({
  path: path.resolve(root, "scripts", "screenshots", "verified-fullpage.png"),
  fullPage: true,
});

// Also dump all run texts to see if our replacement made it in.
const runTexts = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-run-id]")).map((el) => ({
    id: el.getAttribute("data-run-id"),
    text: el.textContent,
  })),
);
const matchingTitle = runTexts.find((r) => r.text?.includes("ތެސްޓު"));
console.log("Saved-PDF title region:");
console.log("  match:", matchingTitle ?? "(REPLACEMENT NOT FOUND)");
console.log("  snapshot:", OUT);
console.log("  total runs in saved PDF:", runTexts.length);
console.log("  first 8 run texts:");
for (let i = 0; i < Math.min(8, runTexts.length); i++) {
  console.log(`    ${runTexts[i].id}: "${runTexts[i].text}"`);
}

await browser.close();
process.exit(0);
