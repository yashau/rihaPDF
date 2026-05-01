// Capture before/after screenshots of the toolbar around clicking the
// Bold button on the 18/2014 run (the run from the user's screenshot).
// If the unselected and selected visuals are the SAME, we have a styling
// bug. If they differ, the user was misreading the icons as "pressed"
// when they weren't.
//
// Renders at devicePixelRatio=2 (most user laptops) so the screenshot
// matches what they actually see.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian2.pdf");
setTimeout(() => process.exit(2), 90_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.emulateMedia({ colorScheme: "light" });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[data-testid="open-pdf-input"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 30_000 });
let lastReady = -1, stableSince = Date.now();
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

const target = await page.evaluate(() => {
  const host = document.querySelector('[data-page-index="1"]');
  if (!host) return null;
  for (const el of host.querySelectorAll("[data-run-id]")) {
    if ((el.textContent || "").includes("18/2014"))
      return { id: el.getAttribute("data-run-id"), text: el.textContent };
  }
  return null;
});
if (!target) {
  console.log("18/2014 run not found");
  process.exit(1);
}

await page.locator(`[data-run-id="${target.id}"]`).scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.locator(`[data-run-id="${target.id}"]`).click();
await page.waitForTimeout(500);

// Move mouse to a NEUTRAL spot so no button is hover/pressed.
await page.mouse.move(50, 50);
await page.waitForTimeout(300);

async function snap(name) {
  const tbBox = await page.evaluate(() => {
    const r = document.querySelector("[data-edit-toolbar]");
    return r
      ? (() => {
          const b = r.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        })()
      : null;
  });
  if (!tbBox) return;
  const out = path.resolve(root, `test/e2e/screenshots/probe-toolbar-toggle-light-${name}.png`);
  await page.screenshot({
    path: out,
    clip: {
      x: Math.max(0, tbBox.x - 8),
      y: Math.max(0, tbBox.y - 8),
      width: Math.min(1500 - Math.max(0, tbBox.x - 8), tbBox.w + 16),
      height: Math.min(1900 - Math.max(0, tbBox.y - 8), tbBox.h + 16),
    },
  });
  // Also dump aria-pressed for the three style buttons.
  const state = await page.evaluate(() => {
    const root = document.querySelector("[data-edit-toolbar]");
    return Array.from(root.querySelectorAll("button[aria-label]"))
      .filter((b) => /^(Bold|Italic|Underline)$/.test(b.getAttribute("aria-label") ?? ""))
      .map((b) => ({
        label: b.getAttribute("aria-label"),
        ariaPressed: b.getAttribute("aria-pressed"),
        dataSelected: b.getAttribute("data-selected"),
        bg: getComputedStyle(b).backgroundColor,
      }));
  });
  console.log(`[${name}]`, JSON.stringify(state));
  console.log(`  → ${out}`);
}

await snap("before");

// Click the Bold button.
await page.locator('[data-edit-toolbar] button[aria-label="Bold"]').click();
await page.waitForTimeout(300);
await page.mouse.move(50, 50);
await page.waitForTimeout(200);
await snap("after-bold");

// Toggle bold off again to confirm round trip.
await page.locator('[data-edit-toolbar] button[aria-label="Bold"]').click();
await page.waitForTimeout(300);
await page.mouse.move(50, 50);
await page.waitForTimeout(200);
await snap("after-bold-off");

await browser.close();
process.exit(0);
