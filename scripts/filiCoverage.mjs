// For each page of the test PDF, count how many of each Thaana fili
// (U+07A6..U+07B0) end up in the extracted runs. Used as a regression
// check for long-vowel recovery — particularly aabaafili (U+07A7),
// which Office's broken /ToUnicode CMap writes out as U+0020.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian.pdf");
setTimeout(() => process.exit(2), 60_000).unref?.();

const FILI_NAMES = {
  0x07a6: "abafili",
  0x07a7: "aabaafili",
  0x07a8: "ibifili",
  0x07a9: "eebeefili",
  0x07aa: "ubufili",
  0x07ab: "oobofili",
  0x07ac: "ebefili",
  0x07ad: "eybeyfili",
  0x07ae: "obofili",
  0x07af: "oaboafili",
  0x07b0: "sukun",
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(3_500);

const pages = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-page-index]")).map((p, i) => {
    const runs = Array.from(p.querySelectorAll("[data-run-id]")).map((el) => el.textContent || "");
    return { pageIndex: i, runs };
  }),
);

let totalAabaafili = 0;
for (const p of pages) {
  const counts = {};
  for (const cp of Object.keys(FILI_NAMES)) counts[cp] = 0;
  let runsWithAabaafili = 0;
  for (const r of p.runs) {
    let hasAabaafili = false;
    for (const c of r) {
      const cp = c.codePointAt(0);
      if (cp != null && cp in FILI_NAMES) {
        counts[cp]++;
        if (cp === 0x07a7) hasAabaafili = true;
      }
    }
    if (hasAabaafili) runsWithAabaafili++;
  }
  console.log(`\n=== Page ${p.pageIndex + 1} (${p.runs.length} runs) ===`);
  for (const [cp, n] of Object.entries(counts)) {
    const name = FILI_NAMES[cp];
    if (n > 0)
      console.log(`  U+${Number(cp).toString(16).toUpperCase()} ${name.padEnd(10)} : ${n}`);
  }
  totalAabaafili += counts[0x07a7];
  console.log(`  runs containing aabaafili: ${runsWithAabaafili}`);
}

console.log(`\nTotal aabaafili across all pages: ${totalAabaafili}`);

// Show every run that contains any aabaafili so we can eyeball them
console.log("\n=== Every run with aabaafili ===");
for (const p of pages) {
  for (const r of p.runs) {
    if (r.includes(String.fromCodePoint(0x07a7))) {
      console.log(`  p${p.pageIndex + 1}: "${r}"`);
    }
  }
}

await browser.close();
process.exit(0);
