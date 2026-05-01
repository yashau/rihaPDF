// Visual diff probe: for each candidate run, take three screenshots clipped
// to the same bounding box:
//   1. PDF render only (overlay hidden) — canonical truth
//   2. Span overlay visible (no edit) — shows hit-target alignment
//   3. Edit input open — shows what user sees while editing
// All saved to scripts/screenshots/diff/<runId>-{render,overlay,edit}.png
//
// Usage: node scripts/diff.mjs

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "scripts", "screenshots", "diff");
fs.mkdirSync(outDir, { recursive: true });

const PDF_PATH = path.resolve(root, "..", "test/fixtures/maldivian.pdf");

setTimeout(() => process.exit(2), 90_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1100 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(PDF_PATH);
await page.waitForSelector("[data-page-index]", { timeout: 20_000 });
await page.waitForTimeout(1500);

// Pick varied candidates.
const runs = await page.evaluate(() => {
  const list = Array.from(document.querySelectorAll("[data-run-id]"))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-run-id"),
        text: el.textContent ?? "",
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    })
    .filter((r) => r.text.length > 0);
  return list;
});
const isThaana = (s) => /[ހ-޿]/.test(s);
const candidates = [];
const titleish = runs
  .filter((r) => r.id?.startsWith("p1-") && isThaana(r.text) && r.h > 30)
  .sort((a, b) => b.h - a.h)[0];
if (titleish) candidates.push(titleish);
const dateLabel = runs.find((r) => r.text.startsWith("ތ") && r.text.includes(":"));
if (dateLabel) candidates.push(dateLabel);
const venueRow = runs.find(
  (r) => r.text.includes("ރައ") && r.id?.startsWith("p1-") && r.id !== titleish?.id,
);
if (venueRow) candidates.push(venueRow);
const longParagraph = runs
  .filter((r) => r.id?.startsWith("p2-") && isThaana(r.text) && r.text.length > 25)
  .sort((a, b) => b.text.length - a.text.length)[0];
if (longParagraph) candidates.push(longParagraph);
const shortLabel = runs.find((r) => isThaana(r.text) && r.text.endsWith(":"));
if (shortLabel) candidates.push(shortLabel);

console.log(`Will probe ${candidates.length} runs`);

// Probe-only styling: when we want a "PDF only" snap, hide every overlay
// span. When we want the "overlay" snap, draw a visible red outline + tint
// on every span so hit-targets appear on screen (otherwise they're
// transparent by design).
await page.addStyleTag({
  content: `
    [data-page-index] > div:nth-child(2) {
      visibility: var(--probe-overlay-visible, visible);
    }
    body[data-probe-mode="overlay"] [data-run-id] {
      outline: 1px solid rgba(255, 30, 30, 0.9);
      background-color: rgba(255, 220, 30, 0.18) !important;
    }
  `,
});

async function setProbeMode(mode) {
  // mode: "render" (no overlays), "overlay" (visible outlines), "edit" (default)
  await page.evaluate((m) => {
    document.body.setAttribute("data-probe-mode", m);
    if (m === "render") {
      document.documentElement.style.setProperty("--probe-overlay-visible", "hidden");
    } else {
      document.documentElement.style.setProperty("--probe-overlay-visible", "visible");
    }
  }, mode);
}

async function unionClip(boxes, pad = 12) {
  const valid = boxes.filter(Boolean);
  if (valid.length === 0) return null;
  const minX = Math.min(...valid.map((b) => b.x));
  const minY = Math.min(...valid.map((b) => b.y));
  const maxX = Math.max(...valid.map((b) => b.x + b.width));
  const maxY = Math.max(...valid.map((b) => b.y + b.height));
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

for (const run of candidates) {
  const target = page.locator(`[data-run-id="${run.id}"]`);
  await target.scrollIntoViewIfNeeded({ timeout: 3_000 });
  await page.waitForTimeout(150);
  const spanBox = await target.boundingBox({ timeout: 3_000 });
  if (!spanBox) continue;

  // 1. PDF only — overlays hidden.
  await setProbeMode("render");
  const renderClip = await unionClip([spanBox]);
  await page.screenshot({
    path: path.join(outDir, `${run.id}-1-render.png`),
    clip: renderClip,
  });

  // 2. Overlay visible with red outline + yellow tint.
  await setProbeMode("overlay");
  await page.waitForTimeout(50);
  await page.screenshot({
    path: path.join(outDir, `${run.id}-2-overlay.png`),
    clip: renderClip,
  });

  // 3. Edit input open. Snap a clip that covers BOTH the original span box
  //    AND the floating toolbar above it (which mounts ~48px above).
  await setProbeMode("edit");
  await target.click({ timeout: 3_000 });
  await page.waitForTimeout(400);
  const editorLoc = page.locator(`input[data-editor][data-run-id="${run.id}"]`);
  const editorBox = await editorLoc.boundingBox().catch(() => null);
  const toolbarBox = await page
    .locator("[data-edit-toolbar]")
    .boundingBox()
    .catch(() => null);
  const editClip = await unionClip([spanBox, editorBox, toolbarBox], 12);
  await page.screenshot({
    path: path.join(outDir, `${run.id}-3-edit.png`),
    clip: editClip,
  });
  const editVal = await editorLoc.inputValue().catch(() => "(no editor)");
  console.log(`-> ${run.id}: text="${run.text}"`);
  console.log(`             editor="${editVal}"`);
  console.log(
    `             match=${editVal === run.text}, spanBox=${[spanBox.x, spanBox.y, spanBox.width, spanBox.height].map(Math.round).join(",")}, editorBox=${editorBox ? [editorBox.x, editorBox.y, editorBox.width, editorBox.height].map(Math.round).join(",") : "(none)"}`,
  );

  // 4. Type a replacement, press Enter, snap the post-commit state — this
  //    is what the user sees while editing. The new text should now be
  //    visible in place of the original (opaque white background + black
  //    Thaana text covers the original glyphs underneath).
  const replacement = "ތެސްޓު!";
  await editorLoc.fill(replacement);
  await editorLoc.press("Enter");
  await page.waitForTimeout(300);
  const postClip = await unionClip([spanBox, editorBox], 18);
  await page.screenshot({
    path: path.join(outDir, `${run.id}-4-post-commit.png`),
    clip: postClip,
  });
  // Also a much wider clip so we can see if any glyphs from the original
  // run are leaking around the white-cover.
  const widePostClip = await unionClip([spanBox, editorBox], 80);
  await page.screenshot({
    path: path.join(outDir, `${run.id}-5-post-commit-wide.png`),
    clip: widePostClip,
  });

  // Reset for next iteration.
  await target.click({ timeout: 3_000 });
  await page.waitForTimeout(200);
  const editorAgain = page.locator(`input[data-editor][data-run-id="${run.id}"]`);
  await editorAgain.fill(run.text);
  await editorAgain.press("Enter");
  await page.waitForTimeout(150);
}

await browser.close();
console.log(`\nWrote screenshots to: ${outDir}`);
process.exit(0);
