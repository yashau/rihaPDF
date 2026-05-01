// One-off probe: load maldivian2.pdf into the running app and dump
// what the app extracts — page count, runs per page (with text + codes),
// images per page. Used to design e2e tests against this fixture.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian2.pdf");
setTimeout(() => process.exit(2), 90_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console-err]", msg.text());
});
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[data-testid="open-pdf-input"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 30_000 });

// Wait for stable page count + canvases.
let lastReady = -1;
let stableSince = Date.now();
const DEADLINE = Date.now() + 30_000;
while (Date.now() < DEADLINE) {
  const counts = await page.evaluate(() => {
    const pages = document.querySelectorAll("[data-page-index]");
    let withCanvas = 0;
    for (const p of pages) if (p.querySelector("canvas")) withCanvas++;
    return { total: pages.length, ready: withCanvas };
  });
  if (counts.ready !== lastReady) {
    lastReady = counts.ready;
    stableSince = Date.now();
  } else if (counts.ready > 0 && counts.ready === counts.total && Date.now() - stableSince >= 1500) {
    break;
  }
  await page.waitForTimeout(200);
}
await page.waitForTimeout(800);

const summary = await page.evaluate(() => {
  const pages = document.querySelectorAll("[data-page-index]");
  const out = [];
  for (const p of pages) {
    const idx = Number(p.getAttribute("data-page-index"));
    const runs = [];
    for (const el of p.querySelectorAll("[data-run-id]")) {
      const t = el.textContent || "";
      const r = el.getBoundingClientRect();
      runs.push({
        id: el.getAttribute("data-run-id"),
        text: t,
        codes: Array.from(t)
          .map((c) => "U+" + c.codePointAt(0).toString(16).padStart(4, "0"))
          .join(" "),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
      });
    }
    const imgs = [];
    for (const el of p.querySelectorAll("[data-image-id]")) {
      imgs.push({ id: el.getAttribute("data-image-id") });
    }
    out.push({ idx, runs, imgs });
  }
  return out;
});

console.log(`PAGE COUNT: ${summary.length}`);
for (const p of summary) {
  console.log(`\n=== PAGE ${p.idx} ===`);
  console.log(`  runs: ${p.runs.length}, images: ${p.imgs.length}`);
  for (const r of p.runs.slice(0, 30)) {
    console.log(`  ${(r.id || "").padEnd(10)} (${String(r.x).padStart(4)},${String(r.y).padStart(4)},w${String(r.w).padStart(4)}) "${r.text}"`);
  }
  if (p.runs.length > 30) console.log(`  …${p.runs.length - 30} more runs`);
}

await browser.close();
process.exit(0);
