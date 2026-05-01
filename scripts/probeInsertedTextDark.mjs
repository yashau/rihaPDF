// Verify the dark-mode invisible-ink fix on InsertedTextOverlay's input:
// open the app in dark mode, drop a text insertion, type into it, then
// read the input's computed `color` + screenshot.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const FIXTURE = path.resolve(root, "test/fixtures/maldivian.pdf");
const OUT = path.resolve(root, "test/e2e/screenshots/probe-inserted-text-dark.png");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1700 },
  colorScheme: "dark",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console]", m.text());
});

// Pin theme to "dark" before any app code runs so .dark is on <html>
// before the editor mounts.
await page.addInitScript(() => {
  try {
    localStorage.setItem("rihaPDF.theme", "dark");
  } catch {}
});

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page
  .locator('input[data-testid="open-pdf-input"]')
  .setInputFiles(FIXTURE);
await page.waitForSelector("[data-page-index]", { timeout: 30_000 });

// Wait for the canvas to render.
await page.waitForFunction(
  () => !!document.querySelector("[data-page-index] canvas"),
  null,
  { timeout: 30_000 },
);
await page.waitForTimeout(800);

// Confirm dark mode is actually on.
const isDark = await page.evaluate(() =>
  document.documentElement.classList.contains("dark"),
);
console.log("dark class present:", isDark);

// Click the "Text" insert tool by aria-label or visible text.
const textBtn = page.getByRole("button", { name: /add text|^\+\s*text/i }).first();
await textBtn.click();
await page.waitForTimeout(150);

// Click somewhere on the first page canvas to drop the inserted text.
const canvas = page.locator("[data-page-index] canvas").first();
const box = await canvas.boundingBox();
if (!box) throw new Error("no canvas bounding box");
await page.mouse.click(box.x + 120, box.y + 80);
await page.waitForTimeout(400);

// Find the freshly opened inserted-text input.
const insertedInput = page
  .locator("[data-inserted-text-id] input, [data-inserted-text] input")
  .first();
let inputHandle = null;
try {
  await insertedInput.waitFor({ timeout: 3000 });
  inputHandle = insertedInput;
} catch {}

if (!inputHandle) {
  // Fallback: grab any focused input that isn't the file picker.
  inputHandle = page.locator("input:focus");
  await inputHandle.waitFor({ timeout: 3000 });
}

await inputHandle.fill("asdsddasdasdsdsa");
await page.waitForTimeout(250);

const computed = await inputHandle.evaluate((el) => {
  const cs = getComputedStyle(el);
  return {
    color: cs.color,
    background: cs.backgroundColor,
    colorScheme: cs.colorScheme,
    webkitTextFillColor: cs.webkitTextFillColor,
  };
});
console.log("computed style:", JSON.stringify(computed, null, 2));

const ibox = await inputHandle.boundingBox();
console.log("input rect:", ibox);

const cropX = Math.max(0, Math.floor((ibox?.x ?? 80) - 40));
const cropY = Math.max(0, Math.floor((ibox?.y ?? 80) - 40));
await page.screenshot({
  path: OUT,
  clip: { x: cropX, y: cropY, width: 700, height: 220 },
});
console.log("screenshot:", OUT);

await ctx.close();
await browser.close();
process.exit(0);
