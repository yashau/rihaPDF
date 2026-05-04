// End-to-end round-trip probe for AcroForm fills.
//
// Loads the MNU job-application fixture in the running dev server,
// types a Latin sample value into a text field (via DV→Thaana
// transliteration on mobile we'd get Thaana — desktop probe just
// types ASCII, which still round-trips through /V correctly), saves
// the PDF, parses the downloaded bytes with pdf-lib, and asserts /V
// on the same field.
//
//   node scripts/probeFormRoundTrip.mjs

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import { readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/mnu-job-application.pdf");
setTimeout(() => process.exit(2), 90_000).unref?.();

const TARGET_FIELD_LATIN = "fill_1";
const TARGET_VALUE_LATIN = "Ibrahim Yashau";
// Pick a Thaana field too — the transliteration wouldn't be active
// on desktop, so we type the Thaana codepoints directly to mimic a
// fully-typed Dhivehi name.
const TARGET_FIELD_THAANA = "fill_86";
const TARGET_VALUE_THAANA = "ހުވަދުމަތި"; // Huvadhumathi (atoll name)

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 1400 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(1_000);

// Fill both fields. `fill()` sets the controlled-input value through
// the DOM event the React handler subscribes to.
const latinInput = page.locator(`[data-form-field="${TARGET_FIELD_LATIN}"]`).first();
await latinInput.click();
await latinInput.fill(TARGET_VALUE_LATIN);
const thaanaInput = page.locator(`[data-form-field="${TARGET_FIELD_THAANA}"]`).first();
await thaanaInput.click();
await thaanaInput.fill(TARGET_VALUE_THAANA);
// Pause to let coalesce window settle.
await page.waitForTimeout(300);

// Trigger Save (the toolbar button uses aria-label "Save"). Wait for
// the download event before reading the bytes.
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: /^Save/i }).click(),
]);
const tmpOut = path.join(tmpdir(), `riha-form-roundtrip-${Date.now()}.pdf`);
await download.saveAs(tmpOut);
console.log(`Saved to: ${tmpOut}`);

await browser.close();

// Parse the saved file with pdf-lib and walk the AcroForm tree to
// find both targeted fields.
const { PDFDocument, PDFArray, PDFDict, PDFHexString, PDFName, PDFString } =
  await import("pdf-lib");
const bytes = readFileSync(tmpOut);
const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
if (!(acroForm instanceof PDFDict)) {
  console.error("FAIL: saved PDF has no /AcroForm");
  process.exit(1);
}
const fields = acroForm.lookup(PDFName.of("Fields"));
if (!(fields instanceof PDFArray) || fields.size() === 0) {
  console.error("FAIL: /AcroForm has no /Fields");
  process.exit(1);
}
console.log(`/AcroForm/Fields top-level count: ${fields.size()}`);
const need = acroForm.lookup(PDFName.of("NeedAppearances"));
console.log(`/AcroForm/NeedAppearances: ${need?.toString() ?? "absent"}`);

function decodeText(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return null;
}
function partialName(d) {
  const t = d.lookup(PDFName.of("T"));
  return decodeText(t);
}
function findFieldByName(fullName) {
  const parts = fullName.split(".");
  function walk(d, idx) {
    const partial = partialName(d);
    let next = idx;
    if (partial !== null) {
      if (partial !== parts[idx]) return null;
      next = idx + 1;
    }
    if (next === parts.length) return d;
    const kids = d.lookup(PDFName.of("Kids"));
    if (!(kids instanceof PDFArray)) return null;
    for (let i = 0; i < kids.size(); i++) {
      const k = kids.lookup(i);
      if (k instanceof PDFDict) {
        const f = walk(k, next);
        if (f) return f;
      }
    }
    return null;
  }
  for (let i = 0; i < fields.size(); i++) {
    const top = fields.lookup(i);
    if (top instanceof PDFDict) {
      const f = walk(top, 0);
      if (f) return f;
    }
  }
  return null;
}

let failed = 0;
function check(name, expected) {
  const f = findFieldByName(name);
  if (!f) {
    console.error(`FAIL: field ${name} not in /Fields tree`);
    failed += 1;
    return;
  }
  const v = decodeText(f.lookup(PDFName.of("V")));
  if (v === expected) {
    console.log(`OK: ${name} /V = "${v}"`);
  } else {
    console.error(`FAIL: ${name} /V = "${v}" (wanted "${expected}")`);
    failed += 1;
  }
}
check(TARGET_FIELD_LATIN, TARGET_VALUE_LATIN);
check(TARGET_FIELD_THAANA, TARGET_VALUE_THAANA);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed — bytes left at ${tmpOut} for inspection`);
  process.exit(1);
}
console.log("\nRound-trip OK.");
process.exit(0);
