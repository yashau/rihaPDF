// Screenshot a given page of the test PDF with the run overlays visible.
// Useful for eyeballing how the editable runs line up with the rendered
// canvas — specifically the large multi-line paragraphs on page 2.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(
  root,
  "hn41badsfTXSpmf0opxlFBWgTLAJX5rWubbshJYC.pdf",
);
const pageIdx = Number(process.argv[2] ?? "1");
const SCREENSHOTS = path.join(root, "scripts", "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1900 },
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(3_500);

// Highlight every run with a translucent outline so we can see what's
// editable vs what isn't.
await page.evaluate(() => {
  for (const el of document.querySelectorAll(`[data-run-id]`)) {
    const e = el;
    e.style.outline = "1px solid rgba(255, 0, 0, 0.4)";
    e.style.background = "rgba(255, 200, 0, 0.08)";
  }
});

const target = page.locator(`[data-page-index="${pageIdx}"]`);
await target.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const out = path.join(SCREENSHOTS, `page-${pageIdx + 1}-overlays.png`);
await target.screenshot({ path: out });
console.log("wrote", out);

// Also dump every run's bounds + text snippet for the requested page.
const runs = await page.evaluate((pi) => {
  const host = document.querySelector(`[data-page-index="${pi}"]`);
  if (!host) return [];
  return Array.from(host.querySelectorAll("[data-run-id]")).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.getAttribute("data-run-id"),
      text: el.textContent || "",
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
}, pageIdx);

for (const r of runs) {
  const tt = (r.text || "").replace(/\s+/g, " ").slice(0, 80);
  console.log(
    `${r.id.padEnd(8)} (${String(r.x).padStart(4)},${String(r.y).padStart(4)},w${String(r.w).padStart(4)},h${String(r.h).padStart(3)}) "${tt}"`,
  );
}
console.log(`\n${runs.length} runs on page ${pageIdx + 1}`);

await browser.close();
process.exit(0);
