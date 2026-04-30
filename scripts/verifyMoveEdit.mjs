// Comprehensive move+edit verification probe.
//
// Workflow:
//   1. Load the test PDF, capture original run texts and per-run bounds
//      (this is the source of truth for what should be preserved).
//   2. Move-only: drag the title, save, reload the saved PDF, check that
//      every original run is still present and the title's bounds shifted
//      by the drag delta.
//   3. Move + edit: same as above but also retype the title text. Verify
//      the new text is present + at the moved position, all OTHER runs
//      are byte-identical to the original.
//   4. Edit-only: retype the title without moving. Verify text is present
//      at the original position, all other runs unchanged.
// Reports a per-test PASS / FAIL summary.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF_PATH = path.resolve(
  root,
  "hn41badsfTXSpmf0opxlFBWgTLAJX5rWubbshJYC.pdf",
);
const URL = "http://localhost:5173/";
const SCREENSHOTS = path.join(root, "scripts", "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const HARD_TIMEOUT_MS = 180_000;
setTimeout(() => {
  console.error("!! HARD TIMEOUT — forcing exit");
  process.exit(2);
}, HARD_TIMEOUT_MS).unref?.();

/** Snapshot every visible run on page 1 — id, text, x, y, w, h. */
async function captureRuns(page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-page-index="0"] [data-run-id]'),
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-run-id"),
        text: el.textContent || "",
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }),
  );
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1400 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);
page.on("pageerror", (e) => console.log("[err]", e.message));

console.log("\n=== SETUP: load original ===");
await page.goto(URL, { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(PDF_PATH);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_000);

const originalRuns = await captureRuns(page);
console.log(`   captured ${originalRuns.length} runs from source`);
const titleRun = originalRuns.find(
  (r) => r.text === "ރައްޔިތުންގެ މަޖިލިސް",
);
if (!titleRun) {
  console.log("!! no title run found — this PDF doesn't match expectations");
  process.exit(1);
}
console.log(
  `   title @ (${titleRun.x}, ${titleRun.y})  text="${titleRun.text}"`,
);

const results = [];

async function runScenario({
  name,
  drag,
  edit,
  expectMovedTitle,
  expectTitleText,
}) {
  console.log(`\n=== ${name} ===`);
  // Reset to a fresh load each time so previous edits don't bleed.
  await page.locator('input[type="file"]').setInputFiles(PDF_PATH);
  await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
  await page.waitForTimeout(2_000);

  if (drag) {
    const target = page.locator('[data-run-id="p1-r2"]');
    const box = await target.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + (drag.dx * i) / 8, cy + (drag.dy * i) / 8);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  if (edit) {
    await page.locator('[data-run-id="p1-r2"]').click();
    await page.waitForTimeout(200);
    const inp = page.locator("input[data-editor]").first();
    await inp.fill(edit);
    await inp.press("Enter");
    await page.waitForTimeout(300);
  }

  const dlPromise = page.waitForEvent("download", { timeout: 12_000 });
  await page
    .locator("button")
    .filter({ hasText: /Save/ })
    .click();
  const dl = await dlPromise;
  const out = path.join(SCREENSHOTS, `verify-${name}.pdf`);
  await dl.saveAs(out);

  // Reload saved PDF and capture runs.
  await page.locator('input[type="file"]').setInputFiles(out);
  await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
  await page.waitForTimeout(2_000);
  const savedRuns = await captureRuns(page);

  // Snapshot for visual review.
  await page
    .locator('[data-page-index="0"] canvas')
    .first()
    .screenshot({ path: path.join(SCREENSHOTS, `verify-${name}.png`) });

  // Verify unchanged runs are byte-identical to original.
  const drift = [];
  for (const orig of originalRuns) {
    if (orig.id === "p1-r2") continue; // title is the one we modified
    const match = savedRuns.find((s) => s.text === orig.text);
    if (!match) {
      drift.push(`MISSING: "${orig.text}"`);
      continue;
    }
    if (
      Math.abs(match.x - orig.x) > 2 ||
      Math.abs(match.y - orig.y) > 2 ||
      Math.abs(match.w - orig.w) > 2
    ) {
      drift.push(
        `MOVED: "${orig.text.slice(0, 30)}" orig=(${orig.x},${orig.y},${orig.w}) → (${match.x},${match.y},${match.w})`,
      );
    }
  }

  // Verify the title-related expectation. For RTL Thaana the meaningful
  // anchor is the run's RIGHT edge (= x + width) because shorter
  // replacement text shifts bounds.left rightward but keeps the first
  // logical character at the same visual right-edge.
  let titleOk = false;
  let titleNote = "";
  if (expectTitleText) {
    const titleNow = savedRuns.find((s) => s.text === expectTitleText);
    if (!titleNow) {
      titleNote = `expected title "${expectTitleText}" not found in saved PDF`;
    } else {
      const isRtl = /[ހ-޿]/u.test(expectTitleText);
      const origRight = titleRun.x + titleRun.w;
      const nowRight = titleNow.x + titleNow.w;
      const dxExp = drag?.dx ?? 0;
      const dyExp = drag?.dy ?? 0;
      let dx, dy;
      if (isRtl) {
        // RTL: anchor is right edge.
        dx = nowRight - origRight - dxExp;
        dy = titleNow.y - titleRun.y - dyExp;
      } else {
        dx = titleNow.x - titleRun.x - dxExp;
        dy = titleNow.y - titleRun.y - dyExp;
      }
      const off = Math.hypot(dx, dy);
      if (off > 8) {
        titleNote = `title misplaced: drift (${dx.toFixed(1)}, ${dy.toFixed(1)}) from expected (off ${off.toFixed(1)})`;
      } else {
        titleOk = true;
      }
    }
  }

  const pass = titleOk && drift.length === 0;
  results.push({ name, pass, titleNote, drift });
  console.log(`   ${pass ? "PASS" : "FAIL"}: ${name}`);
  if (titleNote) console.log(`   title: ${titleNote}`);
  if (drift.length) {
    console.log(`   drift: ${drift.length} runs`);
    for (const d of drift.slice(0, 6)) console.log(`     · ${d}`);
  }
}

await runScenario({
  name: "move-only",
  drag: { dx: 60, dy: 30 },
  edit: null,
  expectMovedTitle: true,
  expectTitleText: titleRun.text,
});

await runScenario({
  name: "edit-only",
  drag: null,
  edit: "ތެސްޓު",
  expectMovedTitle: false,
  expectTitleText: "ތެސްޓު",
});

await runScenario({
  name: "move-then-edit",
  drag: { dx: 80, dy: 40 },
  edit: "ތެސްޓު",
  expectMovedTitle: true,
  expectTitleText: "ތެސްޓު",
});

console.log("\n=== SUMMARY ===");
let allPass = true;
for (const r of results) {
  console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name}`);
  if (!r.pass) allPass = false;
}

await browser.close();
process.exit(allPass ? 0 : 1);
