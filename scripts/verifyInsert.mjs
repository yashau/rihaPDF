// End-to-end insert flow:
//   1. Load test PDF
//   2. Click "+ Text", click on the page to drop a text box, type a
//      sentinel string, blur to commit.
//   3. Click "+ Image", upload a tiny PNG via the hidden file input,
//      click on the page to place it.
//   4. Save, reload the saved PDF.
//   5. Verify: extracted text contains the sentinel string AND the
//      saved page now has +1 image vs the original.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "TR_EVisa_903595951719.pdf");
const SCREENSHOTS = path.join(root, "scripts", "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });
setTimeout(() => process.exit(2), 240_000).unref?.();

// 1×1 red PNG — smallest valid bitmap we can hand pdf-lib's embedPng.
const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAFUlEQVR4nGP8z8AARMQDxlGNAxoAAH7vAv9OUszhAAAAAElFTkSuQmCC",
  "base64",
);
const TMP_PNG = path.join(SCREENSHOTS, "verify-insert-pixel.png");
fs.writeFileSync(TMP_PNG, RED_PIXEL_PNG);

const SENTINEL = "INSERTED_TEXT_42";

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

console.log("=== insert text ===");
await page.locator("button").filter({ hasText: /^\+ Text$/ }).click();
const pageEl = page.locator('[data-page-index="0"]');
const pageBox = await pageEl.boundingBox();
const clickX = pageBox.x + pageBox.width * 0.3;
const clickY = pageBox.y + pageBox.height * 0.3;
await page.mouse.click(clickX, clickY);
await page.waitForTimeout(200);
const insertedTextInput = page.locator(
  '[data-text-insert-id] input',
);
await insertedTextInput.first().fill(SENTINEL);
await insertedTextInput.first().press("Enter");
await page.waitForTimeout(200);

console.log("=== insert image ===");
await page.locator("button").filter({ hasText: /^\+ Image/ }).click();
// Wait briefly, then provide the file via the hidden input.
const imageInput = page.locator(
  'input[type="file"][accept*="image"]',
);
await imageInput.setInputFiles(TMP_PNG);
await page.waitForTimeout(400);
const clickX2 = pageBox.x + pageBox.width * 0.6;
const clickY2 = pageBox.y + pageBox.height * 0.6;
await page.mouse.click(clickX2, clickY2);
await page.waitForTimeout(300);

await pageEl.screenshot({
  path: path.join(SCREENSHOTS, "verify-insert-before-save.png"),
});

console.log("=== save + reload ===");
const dlPromise = page.waitForEvent("download", { timeout: 12_000 });
await page.locator("button").filter({ hasText: /^Save \(/ }).click();
const dl = await dlPromise;
const saved = path.join(SCREENSHOTS, "verify-insert.pdf");
await dl.saveAs(saved);
console.log(`  saved → ${saved}`);

await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(saved);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_000);
await pageEl.screenshot({
  path: path.join(SCREENSHOTS, "verify-insert-after-save.png"),
});

console.log("=== verify ===");
// Read the saved PDF directly and check (a) extracted text contains
// SENTINEL, (b) image count = original + 1.
const savedBytes = fs.readFileSync(saved);
const checks = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buf = bytes.buffer;
  const sourceImages = await import("/src/lib/sourceImages.ts");
  const pdfMod = await import("/src/lib/pdf.ts");
  const imagesByPage = await sourceImages.extractPageImages(buf);
  // Count text via pdf.js getTextContent on page 1, using the app's
  // already-configured pdf.js worker.
  const doc = await pdfMod.loadPdf(bytes.buffer.slice(0));
  const p = await doc.getPage(1);
  const content = await p.getTextContent();
  const text = content.items
    .filter((it) => "str" in it)
    .map((it) => it.str)
    .join(" ");
  return {
    page1ImageCount: imagesByPage[0]?.length ?? 0,
    page1TextSnippet: text.slice(0, 4000),
  };
}, savedBytes.toString("base64"));

const sentinelOk = checks.page1TextSnippet.includes(SENTINEL);
const imageCountOk = checks.page1ImageCount >= 5; // original 4 + 1 inserted
console.log(`  text contains "${SENTINEL}": ${sentinelOk}`);
console.log(`  page 1 image count: ${checks.page1ImageCount} (want >= 5)`);
const pass = sentinelOk && imageCountOk;
console.log(`\n=== ${pass ? "PASS" : "FAIL"} ===`);

await browser.close();
process.exit(pass ? 0 : 1);
