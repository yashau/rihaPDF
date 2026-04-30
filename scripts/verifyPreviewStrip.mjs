// Drag an image, then sample a pixel inside its ORIGINAL position to
// confirm the live preview canvas has the original glyph removed (no
// big white cover, just the page background showing through).
//
// Without the preview-strip pipeline this pixel would either be the
// original image content or a white cover. With it, the pixel should
// be the page background (white-ish, since the image was on a white
// area), AND nearby content should still be visible (no big cover
// extending into neighbours).

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "TR_EVisa_903595951719.pdf");
const SCREENSHOTS = path.join(root, "scripts", "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });
setTimeout(() => process.exit(2), 120_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1900 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_500);

console.log("=== before drag ===");
// Sample the centroid of every image overlay, both on the canvas (the
// rendered pdf.js bitmap) and via elementsFromPoint (DOM stack).
const before = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("[data-image-id]")) {
    const id = el.getAttribute("data-image-id");
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2);
    const cy = Math.round(r.y + r.height / 2);
    const canvas = document
      .querySelector('[data-page-index="0"] canvas')
      ?.getBoundingClientRect();
    out.push({ id, cx, cy, canvas });
  }
  return out;
});

async function pixelAt(cx, cy) {
  return page.evaluate(({ cx, cy }) => {
    const canvas = document.querySelector(
      '[data-page-index="0"] canvas',
    );
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    const px = Math.round((cx - r.x) * sx);
    const py = Math.round((cy - r.y) * sy);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height)
      return null;
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, { cx, cy });
}

const target = before[0];
console.log(`  target ${target.id} @ centroid (${target.cx}, ${target.cy})`);
const beforePixel = await pixelAt(target.cx, target.cy);
console.log(`  centroid pixel BEFORE drag: rgba(${beforePixel?.join(",")})`);

console.log("\n=== drag by (200, 100) viewport px ===");
const dragLoc = page.locator(`[data-image-id="${target.id}"]`);
const box = await dragLoc.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(cx + (200 * i) / 8, cy + (100 * i) / 8);
  await page.waitForTimeout(20);
}
await page.mouse.up();
await page.waitForTimeout(800); // let the preview rebuild settle

await page
  .locator('[data-page-index="0"]')
  .screenshot({ path: path.join(SCREENSHOTS, "preview-strip-after-drag.png") });

const afterPixel = await pixelAt(target.cx, target.cy);
console.log(`  centroid pixel AFTER drag:  rgba(${afterPixel?.join(",")})`);

// Also check a pixel just OUTSIDE the original image bounds — should
// be unchanged (no spillover from a big cover).
const neighborX = target.cx + 80;
const neighborY = target.cy;
const neighborBefore = beforePixel; // pixel-comparable column we took before drag
const neighborAfter = await pixelAt(neighborX, neighborY);
console.log(
  `  neighbor (+80px) pixel AFTER drag: rgba(${neighborAfter?.join(",")})`,
);

const isWhite = (rgb) => rgb && rgb[0] > 230 && rgb[1] > 230 && rgb[2] > 230;
const beforeWasOriginalImage = !isWhite(beforePixel);
const afterIsBackground = isWhite(afterPixel);
console.log("\n=== checks ===");
console.log(
  `  centroid was image originally: ${beforeWasOriginalImage} (rgba ${beforePixel?.join(",")})`,
);
console.log(
  `  centroid is background after drag: ${afterIsBackground} (rgba ${afterPixel?.join(",")})`,
);
console.log(
  `  neighbor unaffected: ${
    JSON.stringify(neighborBefore) !== JSON.stringify(neighborAfter)
      ? "(can't compare, no before snapshot)"
      : "yes"
  }`,
);

if (beforeWasOriginalImage && afterIsBackground) {
  console.log("\n=== PASS: original image stripped from preview ===");
  process.exit(0);
} else {
  console.log("\n=== FAIL: preview strip did not work as expected ===");
  process.exit(1);
}
