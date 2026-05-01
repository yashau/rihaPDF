// Reproduce the "weird toolbar layout" reported on maldivian2.pdf:
// for both maldivian and maldivian2 fixtures, open a paragraph run +
// screenshot the editor + toolbar in viewport. Dumps geometry so we
// can see exactly what's misaligned.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SCEN = [
  {
    name: "maldivian2-paragraph-under-url",
    pdf: path.resolve(root, "test/fixtures/maldivian2.pdf"),
    pageIndex: 1,
    // The paragraph that sits just BELOW the URL run — this is the
    // run the user's screenshot showed, where the 42px-tall toolbar
    // at `top - 48` reaches up into the URL above.
    matchText: "ރަޖިސްޓްރީ ކުރަންވާނީ މަތީގައިވާ",
    matchHint: "paragraph directly below the URL (toolbar overlap case)",
  },
  {
    name: "maldivian2-url",
    pdf: path.resolve(root, "test/fixtures/maldivian2.pdf"),
    pageIndex: 1,
    matchText: "forms.office.com",
    matchHint: "URL run",
  },
];
const OUTDIR = path.resolve(root, "test/e2e/screenshots");
fs.mkdirSync(OUTDIR, { recursive: true });
setTimeout(() => process.exit(2), 240_000).unref?.();

const browser = await chromium.launch({ headless: true });

for (const sc of SCEN) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[err]", e.message));
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.locator('input[data-testid="open-pdf-input"]').setInputFiles(sc.pdf);
  await page.waitForSelector("[data-page-index]", { timeout: 30_000 });
  // Wait for stable canvases
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
    } else if (
      counts.ready > 0 &&
      counts.ready === counts.total &&
      Date.now() - stableSince >= 1500
    ) {
      break;
    }
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(800);

  // Find the longest run on page sc.pageIndex containing matchText.
  const target = await page.evaluate(({ pageIndex, matchText }) => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return null;
    let best = null;
    for (const el of host.querySelectorAll("[data-run-id]")) {
      const t = el.textContent || "";
      if (!t.includes(matchText)) continue;
      const r = el.getBoundingClientRect();
      if (!best || r.width > best.rect.w) {
        best = {
          id: el.getAttribute("data-run-id"),
          text: t,
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        };
      }
    }
    return best;
  }, sc);
  if (!target) {
    console.log(`[${sc.name}] target not found (${sc.matchHint})`);
    await ctx.close();
    continue;
  }
  console.log(
    `\n=== ${sc.name} (${sc.matchHint}) ===\nrun id=${target.id} text="${target.text.slice(0, 60)}" rect=${JSON.stringify(target.rect)}`,
  );

  await page.locator(`[data-run-id="${target.id}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.locator(`[data-run-id="${target.id}"]`).click();
  await page.waitForTimeout(400);

  const geo = await page.evaluate(() => {
    const tb = document.querySelector("[data-edit-toolbar]");
    const ed = document.querySelector("input[data-editor]");
    const fmt = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    };
    return { toolbar: fmt(tb), editor: fmt(ed) };
  });
  console.log(`geometry: ${JSON.stringify(geo, null, 2)}`);

  // Capture a screenshot of the visible viewport (already scrolled).
  const out = path.resolve(OUTDIR, `probe-toolbar-${sc.name}.png`);
  // Centre the crop on whatever was scrolled into view: editor y is the
  // anchor we trust most. If editor lies in the upper half, use 0..edY+200.
  const edY = geo.editor?.y ?? 800;
  const cropY = Math.max(0, edY - 200);
  const cropH = Math.min(1900 - cropY, 500);
  await page.screenshot({ path: out, clip: { x: 100, y: cropY, width: 1300, height: cropH } });
  console.log(`screenshot: ${out}`);

  await ctx.close();
}

await browser.close();
process.exit(0);
