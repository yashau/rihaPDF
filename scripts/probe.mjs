// Multi-spot probe: load app, open PDF, then for each of several runs
// (covering title, label, paragraph, number, body) click it and verify:
//   - the popup input mounts
//   - the input's value === the run's text
//   - the input visually overlaps the run's bounding box
// Optionally tests the save round-trip when called with `save`.
//
// Usage:  node scripts/probe.mjs [load|edit|save]

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const screenshotsDir = path.join(root, "scripts", "screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });

const PDF_PATH = path.resolve(
  root,
  "..",
  "hn41badsfTXSpmf0opxlFBWgTLAJX5rWubbshJYC.pdf",
);
const URL = "http://localhost:5173/";
const STEP = process.argv[2] ?? "load";

const HARD_TIMEOUT_MS = 90_000;
setTimeout(() => {
  console.error(`!! HARD TIMEOUT after ${HARD_TIMEOUT_MS}ms — forcing exit`);
  process.exit(2);
}, HARD_TIMEOUT_MS).unref?.();

const consoleLog = [];
const networkErrors = [];
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(8_000);

page.on("console", (msg) => {
  consoleLog.push(`[${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => {
  pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ""}`);
});
page.on("requestfailed", (req) => {
  networkErrors.push(
    `${req.method()} ${req.url()} -> ${req.failure()?.errorText ?? "?"}`,
  );
});

async function snap(name) {
  await page.screenshot({
    path: path.join(screenshotsDir, name),
    fullPage: true,
  });
}

async function snapClipped(name, box, pad = 30) {
  await page.screenshot({
    path: path.join(screenshotsDir, name),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(1400, box.width + pad * 2),
      height: Math.min(1000, box.height + pad * 2),
    },
  });
}

console.log(`-> opening ${URL}`);
await page.goto(URL, { waitUntil: "networkidle", timeout: 12_000 });

console.log(`-> uploading PDF`);
await page.locator('input[type="file"]').setInputFiles(PDF_PATH);

await page.waitForSelector("[data-page-index]", { timeout: 20_000 });
await page.waitForTimeout(1500);
await snap("01-loaded.png");

// Pick a varied set of candidate runs to probe.
// Strategy: gather all runs page-1, then choose: longest Thaana, the title-
// looking one, an "agenda number" line, a numeric one, and a body paragraph
// from page 2.
const runMeta = await page.evaluate(() => {
  const out = [];
  const els = document.querySelectorAll("[data-run-id]");
  for (const el of els) {
    const r = el.getBoundingClientRect();
    out.push({
      id: el.getAttribute("data-run-id"),
      text: el.textContent ?? "",
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
    });
  }
  return out;
});

console.log(`-> total runs: ${runMeta.length}`);

const isThaana = (s) => /[ހ-޿]/.test(s);
const candidates = [];
const longest = [...runMeta]
  .filter((r) => isThaana(r.text) && r.text.length > 5)
  .sort((a, b) => b.text.length - a.text.length)[0];
if (longest) candidates.push({ label: "longest Thaana run", run: longest });

const onPage1 = runMeta.filter((r) => r.id?.startsWith("p1-"));
const titleish = onPage1
  .filter((r) => isThaana(r.text) && r.h > 20)
  .sort((a, b) => b.h - a.h)[0];
if (titleish && titleish.id !== longest?.id) {
  candidates.push({ label: "tallest Thaana run (title)", run: titleish });
}

const numeric = runMeta.find((r) => /^\d+(\/\d+)*$/.test(r.text.trim()));
if (numeric) candidates.push({ label: "numeric", run: numeric });

const labelish = runMeta.find((r) => /:$/.test(r.text.trim()) && isThaana(r.text));
if (labelish) candidates.push({ label: "labelled (ends with :)", run: labelish });

const onPage2 = runMeta.find(
  (r) => r.id?.startsWith("p2-") && isThaana(r.text) && r.text.length > 8,
);
if (onPage2) candidates.push({ label: "page 2 paragraph", run: onPage2 });

console.log(`-> ${candidates.length} candidate(s):`);
for (const c of candidates) {
  console.log(
    `   - ${c.label}: id=${c.run.id} text="${c.run.text.slice(0, 60)}" box=${[c.run.x, c.run.y, c.run.w, c.run.h].map((n) => Math.round(n)).join(",")}`,
  );
}

if (STEP === "load") {
  await browser.close();
  console.log("\n=== Stats ===");
  console.log(`pages=3 (assumed) runs=${runMeta.length}`);
  process.exit(0);
}

const results = [];
for (const { label, run } of candidates) {
  console.log(`\n=== probing: ${label} (${run.id}) ===`);
  const target = page.locator(`[data-run-id="${run.id}"]`);
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 3_000 });
  } catch {
    /* page-2 runs may not be visible at default scroll, that's fine */
  }
  const beforeBox = await target.boundingBox();
  if (!beforeBox) {
    results.push({ label, run, error: "no bounding box" });
    continue;
  }

  await target.click({ timeout: 3_000 });
  await page.waitForTimeout(400);

  const editor = page.locator(`input[data-editor][data-run-id="${run.id}"]`);
  let editorMounted = false;
  let editorValue = null;
  let editorBox = null;
  try {
    await editor.waitFor({ state: "attached", timeout: 2_000 });
    editorMounted = true;
    editorValue = await editor.inputValue();
    editorBox = await editor.boundingBox();
  } catch {
    /* editor didn't mount */
  }

  const valueMatch = editorValue === run.text;
  const overlapsBefore = editorBox
    ? !(
        editorBox.x + editorBox.width < beforeBox.x ||
        beforeBox.x + beforeBox.width < editorBox.x ||
        editorBox.y + editorBox.height < beforeBox.y ||
        beforeBox.y + beforeBox.height < editorBox.y
      )
    : false;

  const verdict =
    editorMounted && valueMatch && overlapsBefore ? "OK" : "FAIL";
  results.push({
    label,
    run,
    editorMounted,
    editorValue,
    editorBox,
    beforeBox,
    valueMatch,
    overlapsBefore,
    verdict,
  });

  if (editorBox) {
    await snapClipped(`probe-${run.id}.png`, editorBox);
  }

  // Dismiss the input
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

if (STEP === "save") {
  // Round-trip: edit several runs to exercise the save pipeline at
  // varying lengths / positions (RTL Thaana title, label with colon,
  // mid-paragraph long Thaana). Save, verify download.
  const targets = [
    { id: "p1-r2", text: "ތެސްޓު ބަދަލު" },
    { id: "p1-r5", text: "ބަދަލުކޮށްފި:" },
    { id: "p1-r10", text: "ބަދަލު މަޖިލިސް ތާނަ" },
  ];
  for (const t of targets) {
    const target = page.locator(`[data-run-id="${t.id}"]`);
    if ((await target.count()) === 0) {
      console.log(`-> save: skipping missing run ${t.id}`);
      continue;
    }
    await target.scrollIntoViewIfNeeded();
    await target.click({ timeout: 3_000 });
    await page.waitForTimeout(200);
    const editorInput = page
      .locator(`input[data-editor][data-run-id="${t.id}"]`)
      .first();
    console.log(`-> save: ${t.id} ← "${t.text}"`);
    await editorInput.fill(t.text);
    await editorInput.press("Enter");
    await page.waitForTimeout(200);
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page
    .locator("button")
    .filter({ hasText: /Save/ })
    .click({ timeout: 3_000 });
  try {
    const dl = await downloadPromise;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPdf = path.join(screenshotsDir, `saved-${stamp}.pdf`);
    await dl.saveAs(outPdf);
    // Also keep a stable "latest" alias for convenience.
    try {
      fs.copyFileSync(outPdf, path.join(screenshotsDir, "saved.pdf"));
    } catch {
      /* viewer might hold the file open; ignore */
    }
    const stat = fs.statSync(outPdf);
    console.log(`-> save: wrote ${outPdf} (${stat.size} bytes)`);
  } catch (e) {
    console.log(`!! save failed: ${String(e).split("\n")[0]}`);
  }
}

await browser.close();

console.log("\n=== RESULTS ===");
for (const r of results) {
  console.log(`[${r.verdict ?? "ERR"}] ${r.label} (${r.run.id})`);
  console.log(`   run.text  = "${r.run.text.slice(0, 60)}"`);
  console.log(
    `   editor    = mounted:${r.editorMounted} value:"${(r.editorValue ?? "(none)").slice(0, 60)}"`,
  );
  console.log(
    `   match     = textsEqual:${r.valueMatch} overlap:${r.overlapsBefore}`,
  );
  if (r.beforeBox) {
    console.log(
      `   span box  = ${[r.beforeBox.x, r.beforeBox.y, r.beforeBox.width, r.beforeBox.height].map((n) => Math.round(n)).join(",")}`,
    );
  }
  if (r.editorBox) {
    console.log(
      `   input box = ${[r.editorBox.x, r.editorBox.y, r.editorBox.width, r.editorBox.height].map((n) => Math.round(n)).join(",")}`,
    );
  }
}

if (pageErrors.length) {
  console.log("\n=== PAGE ERRORS ===");
  for (const e of pageErrors) console.log(e);
}
if (networkErrors.length) {
  console.log("\n=== NETWORK ERRORS ===");
  for (const e of networkErrors) console.log(e);
}

console.log("\nScreenshots saved to:", screenshotsDir);
process.exit(0);
