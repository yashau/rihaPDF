// For each loaded PDF, dump every text run with its detected family +
// original BaseFont hint so we can see whether English text routes to
// Arial / Times and Thaana routes to Faruma.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDFS = process.argv.slice(2);
if (!PDFS.length) {
  console.log("usage: node scripts/dumpRunFonts.mjs <pdf1> [<pdf2> …]");
  process.exit(2);
}

setTimeout(() => process.exit(2), 120_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1900 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });

for (const rel of PDFS) {
  const abs = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
  if (!fs.existsSync(abs)) {
    console.log(`!! ${abs} not found`);
    continue;
  }
  console.log(`\n=== ${path.basename(abs)} ===`);
  await page.locator('input[type="file"]').setInputFiles(abs);
  await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
  await page.waitForTimeout(2_500);

  const dump = await page.evaluate(() => {
    const out = [];
    for (const host of document.querySelectorAll("[data-page-index]")) {
      const pi = Number(host.getAttribute("data-page-index"));
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const id = el.getAttribute("data-run-id");
        const text = el.textContent || "";
        const family = el.dataset.fontFamily ?? "?";
        const base = el.dataset.baseFont ?? "";
        out.push({ pageIndex: pi, id, text: text.slice(0, 60), family, base });
      }
    }
    return out;
  });
  // Group by (family, baseFont) so we see how each base maps.
  const buckets = new Map();
  for (const r of dump) {
    const key = `${r.family}  ←  ${r.base || "(no hint)"}`;
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  for (const [key, runs] of buckets) {
    console.log(`  ${key}  (${runs.length} runs)`);
    for (const r of runs.slice(0, 3)) {
      console.log(`    p${r.pageIndex + 1} ${r.id}  "${r.text}"`);
    }
    if (runs.length > 3) console.log(`    … +${runs.length - 3} more`);
  }
}

await browser.close();
process.exit(0);
