// Insert text + change font / size / bold via the formatting toolbar,
// then save and verify the saved PDF reflects all three changes:
//
//   - text exists
//   - font reported by pdf.js for the run is the chosen family
//   - measured glyph height matches the chosen size
//   - bold weight: pdf.js's getTextContent returns the run with the
//     chosen bold StandardFont (TimesRomanBold etc.)
//
// We pick Times New Roman + size 28 + bold so the result is visually
// distinguishable from the default Arial 12 regular.

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

const SENTINEL = "FORMAT_PROBE_xyz";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page
  .locator('input[type="file"][accept="application/pdf"]')
  .setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_500);

console.log("=== insert text ===");
await page.locator("button").filter({ hasText: /^\+ Text$/ }).click();
const pageBox = await page.locator('[data-page-index="0"]').boundingBox();
const cx = pageBox.x + pageBox.width * 0.3;
const cy = pageBox.y + pageBox.height * 0.5;
await page.mouse.click(cx, cy);
await page.waitForTimeout(200);
const insertedInput = page.locator("[data-text-insert-id] input").first();
await insertedInput.fill(SENTINEL);
await page.waitForTimeout(150);

console.log("=== change formatting via toolbar ===");
const toolbar = page.locator("[data-edit-toolbar]");
// Font picker → "Times New Roman".
await toolbar.locator("select").selectOption("Times New Roman");
await page.waitForTimeout(120);
// Font-size input → 28.
const sizeInput = toolbar.locator('input[aria-label="Font size"]');
await sizeInput.fill("28");
await sizeInput.press("Tab");
await page.waitForTimeout(120);
// Bold toggle.
await toolbar.locator('button[aria-pressed]').first().click();
await page.waitForTimeout(150);

// DOM-level checks before save: the live overlay should reflect the
// changes (font-family, font-size, font-weight).
const live = await page.evaluate(() => {
  const el = document.querySelector(
    "[data-text-insert-id] input",
  );
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
  };
});
console.log("  live overlay style:", JSON.stringify(live));

// Click somewhere safe to commit (outside the toolbar + outside the
// insertion's overlay), then save.
await page.mouse.click(pageBox.x + 5, pageBox.y + 5);
await page.waitForTimeout(200);

console.log("=== save + reload ===");
const dlPromise = page.waitForEvent("download", { timeout: 12_000 });
await page.locator("button").filter({ hasText: /^Save \(/ }).click();
const dl = await dlPromise;
const saved = path.join(SCREENSHOTS, "verify-insert-format.pdf");
await dl.saveAs(saved);
console.log(`  saved → ${saved}`);

await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(saved);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_000);

const checks = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pdfMod = await import("/src/lib/pdf.ts");
  const baseFontMod = await import("/src/dev/readBaseFonts.ts");
  const doc = await pdfMod.loadPdf(bytes.buffer.slice(0));
  const p = await doc.getPage(1);
  const content = await p.getTextContent();
  const items = content.items.filter((it) => "str" in it);
  const target = items.find((it) => it.str.includes("FORMAT_PROBE_xyz"));
  if (!target) return { found: false, items: items.length };
  const heightPt = Math.abs(target.transform[3]);
  const baseFontStrings = (
    await baseFontMod.readBaseFonts(bytes.buffer.slice(0))
  )[0] ?? [];
  return {
    found: true,
    text: target.str,
    fontName: target.fontName,
    heightPt,
    baseFontStrings,
  };
}, fs.readFileSync(saved).toString("base64"));

console.log("\n=== verify ===");
console.log("  checks:", JSON.stringify(checks));
const liveFontOk = /Times New Roman/i.test(live?.fontFamily ?? "");
const liveSizeOk = parseFloat(live?.fontSize ?? "0") > 30; // ~28pt × 1.5 scale = 42px
const liveBoldOk = parseInt(live?.fontWeight ?? "400", 10) >= 600;
console.log(
  `  live font ✓: ${liveFontOk}, live size ✓: ${liveSizeOk}, live bold ✓: ${liveBoldOk}`,
);
const savedFound = checks?.found === true;
const savedSizeOk = (checks?.heightPt ?? 0) >= 26 && (checks?.heightPt ?? 0) <= 30;
const savedFontOk = (checks?.baseFontStrings ?? []).some((b) =>
  /times.*bold/i.test(b),
);
console.log(
  `  saved found ✓: ${savedFound}, saved size ✓: ${savedSizeOk} (${checks?.heightPt}pt), saved font ✓: ${savedFontOk} (BaseFonts: ${checks?.baseFontStrings?.join(", ")})`,
);

const pass =
  liveFontOk && liveSizeOk && liveBoldOk && savedFound && savedSizeOk && savedFontOk;
console.log(`\n=== ${pass ? "PASS" : "FAIL"} ===`);
await browser.close();
process.exit(pass ? 0 : 1);
