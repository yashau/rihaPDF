// End-to-end image-move check.
//
//   1. Load TR_EVisa_*.pdf, snapshot every image's source position.
//   2. Drag image #0 by (60, 30) viewport pixels.
//   3. Save, reload the saved PDF.
//   4. Assert the moved image shows up at the expected new PDF-space
//      position and every OTHER image stays put.
// Logs PASS/FAIL with the exact deltas so we can see drift.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "TR_EVisa_903595951719.pdf");
const SCREENSHOTS = path.join(root, "scripts", "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });
setTimeout(() => process.exit(2), 180_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_500);

async function captureImages(pdfPath) {
  const bytes = fs.readFileSync(pdfPath);
  const b64 = bytes.toString("base64");
  return page.evaluate(async (b64) => {
    const mod = await import("/src/lib/sourceImages.ts");
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const all = await mod.extractPageImages(buf);
    return all.map((perPage) =>
      perPage.map((i) => ({
        id: i.id,
        resourceName: i.resourceName,
        pdfX: i.pdfX,
        pdfY: i.pdfY,
        w: i.pdfWidth,
        h: i.pdfHeight,
      })),
    );
  }, b64);
}

console.log("=== SETUP: load TR_EVisa ===");
const before = await captureImages(PDF);
console.log(`  page 1: ${before[0].length} images`);
for (const i of before[0]) {
  console.log(
    `    ${i.id} /${i.resourceName} @ (${i.pdfX.toFixed(1)}, ${i.pdfY.toFixed(1)}) ${i.w.toFixed(1)}×${i.h.toFixed(1)}`,
  );
}
const target = before[0]?.[0];
if (!target) {
  console.log("!! no images on page 1");
  process.exit(1);
}

// Find the on-screen image element + drag.
const dragLoc = page.locator(`[data-image-id="${target.id}"]`);
const box = await dragLoc.boundingBox();
if (!box) {
  console.log("!! image overlay not in DOM");
  process.exit(1);
}
console.log(
  `  overlay box: (${box.x.toFixed(1)},${box.y.toFixed(1)}) ${box.width.toFixed(1)}×${box.height.toFixed(1)}`,
);
// Inspect what's actually on top at the centroid.
const topHit = await page.evaluate(({ cx, cy }) => {
  const els = document.elementsFromPoint(cx, cy);
  return els.slice(0, 6).map((e) => {
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName,
      id: e.dataset?.runId ?? e.dataset?.imageId ?? null,
      pe: getComputedStyle(e).pointerEvents,
      rect: `${r.width.toFixed(0)}x${r.height.toFixed(0)}`,
    };
  });
}, { cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
console.log("  topHit:", JSON.stringify(topHit));
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
const DRAG_DX = 60;
const DRAG_DY = 30;
console.log(`\n=== DRAG ${target.id} by (${DRAG_DX}, ${DRAG_DY}) viewport px ===`);
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(cx + (DRAG_DX * i) / 8, cy + (DRAG_DY * i) / 8);
  await page.waitForTimeout(20);
}
await page.mouse.up();
await page.waitForTimeout(300);

// After-drag DOM inspection.
const afterDrag = await page.evaluate((tid) => {
  const el = document.querySelector(`[data-image-id="${tid}"]`);
  if (!el) return null;
  return { left: el.style.left, top: el.style.top, bg: el.style.backgroundImage?.slice(0, 30) };
}, target.id);
console.log("  after-drag DOM:", JSON.stringify(afterDrag));

// Screenshot mid-drag-state (rendered sprite at new position).
await page
  .locator('[data-page-index="0"]')
  .screenshot({ path: path.join(SCREENSHOTS, "image-move-after-drag.png") });

console.log("\n=== SAVE + RELOAD ===");
const dlPromise = page.waitForEvent("download", { timeout: 12_000 });
await page
  .locator("button")
  .filter({ hasText: /Save/ })
  .click();
const dl = await dlPromise;
const saved = path.join(SCREENSHOTS, "image-move.pdf");
await dl.saveAs(saved);
console.log(`  saved → ${saved}`);

await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(saved);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_000);

const after = await captureImages(saved);

console.log("\n=== VERIFY ===");
let allOk = true;
const renderScale = 1.5;
const expectedDx = DRAG_DX / renderScale;
const expectedDy = -DRAG_DY / renderScale;
for (let i = 0; i < before[0].length; i++) {
  const b = before[0][i];
  const a = after[0]?.[i];
  if (!a) {
    console.log(`  [FAIL] ${b.id}: missing in saved PDF`);
    allOk = false;
    continue;
  }
  const dx = a.pdfX - b.pdfX;
  const dy = a.pdfY - b.pdfY;
  const isTarget = b.id === target.id;
  const wantDx = isTarget ? expectedDx : 0;
  const wantDy = isTarget ? expectedDy : 0;
  const drift = Math.hypot(dx - wantDx, dy - wantDy);
  const verdict = drift < 1.0 ? "PASS" : "FAIL";
  if (verdict === "FAIL") allOk = false;
  console.log(
    `  [${verdict}] ${b.id}${isTarget ? " (target)" : ""}: ` +
      `before=(${b.pdfX.toFixed(1)},${b.pdfY.toFixed(1)})  ` +
      `after=(${a.pdfX.toFixed(1)},${a.pdfY.toFixed(1)})  ` +
      `Δ=(${dx.toFixed(2)},${dy.toFixed(2)})  ` +
      `expected=(${wantDx.toFixed(2)},${wantDy.toFixed(2)})  ` +
      `drift=${drift.toFixed(2)}`,
  );
}

await page
  .locator('[data-page-index="0"]')
  .screenshot({ path: path.join(SCREENSHOTS, "image-move-saved.png") });

console.log(`\n=== ${allOk ? "ALL PASS" : "FAILURES PRESENT"} ===`);
await browser.close();
process.exit(allOk ? 0 : 1);
