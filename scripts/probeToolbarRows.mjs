// Probe the mobile EditTextToolbar's row layout. Loads maldivian2.pdf,
// taps a text run to open the editor, and inspects each toolbar child's
// `top` to count distinct rows. Also asserts the X / "Cancel edit"
// button is gone.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const HARD_DEADLINE = setTimeout(() => {
  console.error("[fail] hard timeout — probe exceeded 90s");
  process.exit(2);
}, 90_000);
HARD_DEADLINE.unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.emulateMedia({ colorScheme: "light" });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page
  .locator('input[data-testid="open-pdf-input"]')
  .setInputFiles(path.resolve(root, "test/fixtures/maldivian2.pdf"));
await page.waitForSelector("[data-page-index]", { timeout: 30_000 });

// Wait for runs to mount.
await page.waitForFunction(
  () => document.querySelectorAll("[data-run-id]").length > 0,
  { timeout: 20_000 },
);

// Find a run, tap its centre.
const target = await page.evaluate(() => {
  const els = document.querySelectorAll("[data-run-id]");
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 12 && r.height > 12 && (el.textContent || "").trim()) {
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
  }
  return null;
});
if (!target) {
  console.error("[fail] no editable run found");
  process.exit(1);
}
await page.touchscreen.tap(target.x, target.y);

await page.waitForSelector("[data-edit-toolbar]", { timeout: 5_000 });

const layout = await page.evaluate(() => {
  const tb = document.querySelector("[data-edit-toolbar]");
  if (!tb) return { rows: 0, items: [], hasCancel: false, totalHeight: 0 };
  const tbRect = tb.getBoundingClientRect();
  // Walk leaf-ish children — direct flex items + the inputs inside the
  // sub-flex wrapper (the wrapper has display:flex on mobile).
  const items = [];
  const collect = (parent) => {
    for (const child of parent.children) {
      const r = child.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (
        child.tagName === "DIV" &&
        child !== tb &&
        getComputedStyle(child).flexBasis === "100%"
      ) {
        // Sub-flex wrapper around font picker + size — recurse into it
        // so we see the picker and the size input as separate items.
        collect(child);
        continue;
      }
      items.push({
        tag: child.tagName.toLowerCase(),
        aria: child.getAttribute("aria-label") || "",
        type: child.getAttribute("type") || "",
        top: Math.round(r.top - tbRect.top),
        left: Math.round(r.left - tbRect.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  };
  collect(tb);
  // Bucket items by approx top (within 4px).
  const rowTops = [];
  for (const it of items) {
    const match = rowTops.find((t) => Math.abs(t - it.top) <= 4);
    if (!match) rowTops.push(it.top);
  }
  rowTops.sort((a, b) => a - b);
  const hasCancel = !!tb.querySelector('[aria-label="Cancel edit"]');
  return {
    rows: rowTops.length,
    rowTops,
    items,
    hasCancel,
    totalHeight: Math.round(tbRect.height),
  };
});

console.log(JSON.stringify(layout, null, 2));
await browser.close();
clearTimeout(HARD_DEADLINE);

// Verdicts
let exit = 0;
if (layout.hasCancel) {
  console.error("[fail] Cancel/X button still present");
  exit = 1;
}
if (layout.rows > 2) {
  console.error(`[fail] toolbar has ${layout.rows} rows (want ≤ 2)`);
  exit = 1;
}
// Also confirm font picker and font size landed on the SAME row.
const picker = layout.items.find((it) => it.aria === "Font");
const size = layout.items.find((it) => it.aria === "Font size");
if (picker && size && Math.abs(picker.top - size.top) > 4) {
  console.error("[fail] Font picker and Font size are on different rows");
  exit = 1;
}
if (exit === 0) console.log("[ok] toolbar rows ≤ 2, picker+size aligned, no X button");
process.exit(exit);
