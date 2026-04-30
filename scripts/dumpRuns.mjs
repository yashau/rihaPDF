// Dump the current text runs the app extracts on page 1 of the test PDF —
// id, text, codepoints, position. We use this to confirm long-fili recovery.

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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_500);

const runs = await page.evaluate(() =>
  Array.from(
    document.querySelectorAll('[data-page-index="0"] [data-run-id]'),
  ).map((el) => {
    const r = el.getBoundingClientRect();
    const t = el.textContent || "";
    return {
      id: el.getAttribute("data-run-id"),
      text: t,
      codes: Array.from(t)
        .map((c) => "U+" + c.codePointAt(0).toString(16).padStart(4, "0"))
        .join(" "),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
    };
  }),
);

for (const r of runs) {
  console.log(
    `${r.id.padEnd(8)} (${String(r.x).padStart(4)},${String(r.y).padStart(4)},w${String(r.w).padStart(4)}) "${r.text}"  ${r.codes}`,
  );
}
console.log(`\n${runs.length} runs total`);

await browser.close();
process.exit(0);
