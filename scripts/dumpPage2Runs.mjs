// Dump every page-2 run with its text + bounds + opIndices so we
// can see which runs the parens / slash ended up in and why the
// run-builder didn't merge them with the line they belong to.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian.pdf");
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(3_500);

const dump = await page.evaluate(() => {
  const host = document.querySelector('[data-page-index="1"]');
  if (!host) return [];
  const out = [];
  for (const el of host.querySelectorAll("[data-run-id]")) {
    const r = el.getBoundingClientRect();
    out.push({
      id: el.getAttribute("data-run-id"),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: el.textContent || "",
    });
  }
  return out;
});

for (const r of dump) {
  console.log(
    `${r.id.padEnd(8)} (${String(r.x).padStart(4)},${String(r.y).padStart(4)},w${String(r.w).padStart(4)},h${String(r.h).padStart(3)}) "${r.text.slice(0, 80)}"`,
  );
}

await browser.close();
process.exit(0);
