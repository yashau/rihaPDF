// Dump the AcroForm fields the new extractor finds on a PDF. Drives
// the running dev server through Playwright (same pattern as
// dumpRuns.mjs) so Vite handles TS resolution end-to-end. Connects to
// http://localhost:5173 — Ibrahim keeps the dev server up, do not
// start one here.
//
//   node scripts/dumpFormFields.mjs            # MNU job-app fixture
//   node scripts/dumpFormFields.mjs path.pdf   # any other PDF

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF =
  process.argv[2] !== undefined
    ? path.resolve(process.cwd(), process.argv[2])
    : path.resolve(root, "test/fixtures/mnu-job-application.pdf");
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(1_500);

// Each form-field overlay carries `data-form-field=<fullName>`. For
// radios we also tag the on-state via `data-form-on-state` so the
// dump can show both. We resolve the field's *kind* by sniffing the
// element type (input[type=text|checkbox|radio|password] / textarea /
// select).
const fields = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("[data-form-field]"));
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const type = el instanceof HTMLInputElement ? el.type : tag;
    const name = el.getAttribute("data-form-field");
    const onState = el.getAttribute("data-form-on-state");
    const value =
      el instanceof HTMLInputElement
        ? type === "checkbox" || type === "radio"
          ? el.checked
            ? "checked"
            : ""
          : el.value
        : el instanceof HTMLTextAreaElement
          ? el.value
          : el instanceof HTMLSelectElement
            ? Array.from(el.selectedOptions)
                .map((o) => o.value)
                .join("|")
            : "";
    return {
      name,
      kind: tag === "select" ? "choice" : type,
      onState,
      value,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
});

console.log(`PDF: ${PDF}`);
console.log(`Form-field overlays rendered: ${fields.length}`);
for (const f of fields) {
  const tag = `[${f.kind}${f.onState ? ":" + f.onState : ""}]`.padEnd(14);
  const pos = `(${String(f.x).padStart(4)},${String(f.y).padStart(4)} ${String(f.w).padStart(3)}×${String(f.h).padStart(3)})`;
  console.log(`${tag} ${pos}  ${f.name}  V="${f.value}"`);
}

await browser.close();
process.exit(0);
