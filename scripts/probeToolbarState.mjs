// Probe the toolbar's INTERNAL state when editing a run on maldivian2:
//
//   * the run-level inferred styles (run.bold / run.italic / run.fontFamily)
//   * the toolbar input values that are actually rendered (font dropdown
//     value, B/I/U aria-pressed)
//
// We do this for two runs:
//   1. The 18/2014 paragraph the user reported (page 1, looks "all
//      toggled, font empty")
//   2. The page-0 title address line (a normal run for comparison)
// And we also grab the page-0 plain title from maldivian.pdf so we
// know what a healthy run looks like.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
setTimeout(() => process.exit(2), 240_000).unref?.();

const SCEN = [
  {
    name: "maldivian2-18-2014",
    pdf: path.resolve(root, "test/fixtures/maldivian2.pdf"),
    pageIndex: 1,
    matchText: "18/2014",
  },
  {
    name: "maldivian2-page0-title",
    pdf: path.resolve(root, "test/fixtures/maldivian2.pdf"),
    pageIndex: 0,
    matchText: "ދިވެހިރާއްޖެ",
  },
  {
    name: "maldivian-title",
    pdf: path.resolve(root, "test/fixtures/maldivian.pdf"),
    pageIndex: 0,
    matchText: "ރައްޔިތުންގެ",
  },
];

const browser = await chromium.launch({ headless: true });
for (const sc of SCEN) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[err]", e.message));
  // Match the user's likely theme — system follows OS, but force "light"
  // matches their screenshot's bright backdrop. We grab both for sanity.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.locator('input[data-testid="open-pdf-input"]').setInputFiles(sc.pdf);
  await page.waitForSelector("[data-page-index]", { timeout: 30_000 });
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

  // Find the run on the requested page that contains matchText.
  const target = await page.evaluate(({ pageIndex, matchText }) => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return null;
    for (const el of host.querySelectorAll("[data-run-id]")) {
      const t = el.textContent || "";
      if (t.includes(matchText)) {
        return {
          id: el.getAttribute("data-run-id"),
          text: t,
          fontFamily: el.getAttribute("data-font-family") ?? "",
          baseFont: el.getAttribute("data-base-font") ?? "",
        };
      }
    }
    return null;
  }, sc);
  if (!target) {
    console.log(
      `[${sc.name}] run with text containing "${sc.matchText}" not found on page ${sc.pageIndex}`,
    );
    await ctx.close();
    continue;
  }
  console.log(`\n=== ${sc.name} ===`);
  console.log(`run id=${target.id} text="${target.text.slice(0, 60)}"`);
  console.log(
    `run-attr: data-font-family="${target.fontFamily}" data-base-font="${target.baseFont}"`,
  );

  await page.locator(`[data-run-id="${target.id}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.locator(`[data-run-id="${target.id}"]`).click();
  await page.waitForTimeout(400);

  const tb = await page.evaluate(() => {
    const root = document.querySelector("[data-edit-toolbar]");
    if (!root) return null;
    const fontSelect = root.querySelector("select[aria-label='Font']");
    const sizeInput = root.querySelector("input[aria-label='Font size']");
    const fontVal = fontSelect ? fontSelect.value : null;
    const fontOpts = fontSelect ? Array.from(fontSelect.options).map((o) => o.value) : [];
    const styleButtons = Array.from(root.querySelectorAll("button[aria-label]")).map((b) => ({
      label: b.getAttribute("aria-label"),
      ariaPressed: b.getAttribute("aria-pressed"),
      dataSelected: b.getAttribute("data-selected"),
    }));
    return {
      fontVal,
      fontOptsKnown: fontOpts.includes(fontVal ?? ""),
      sizeVal: sizeInput ? sizeInput.value : null,
      styleButtons,
    };
  });
  console.log("toolbar state:", JSON.stringify(tb, null, 2));
  // Screenshot the toolbar zone for visual inspection.
  const tbBox = await page.evaluate(() => {
    const r = document.querySelector("[data-edit-toolbar]");
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  if (tbBox) {
    const out = path.resolve(root, `test/e2e/screenshots/probe-toolbar-state-${sc.name}.png`);
    await page.screenshot({
      path: out,
      clip: {
        x: Math.max(0, tbBox.x - 8),
        y: Math.max(0, tbBox.y - 8),
        width: Math.min(1500 - Math.max(0, tbBox.x - 8), tbBox.w + 16),
        height: Math.min(1900 - Math.max(0, tbBox.y - 8), tbBox.h + 16),
      },
    });
    console.log("toolbar screenshot:", out);
  }
  await ctx.close();
}
await browser.close();
process.exit(0);
