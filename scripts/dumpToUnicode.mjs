// Dump each font's ToUnicode CMap raw text + parsed (CID → unicode) entries.
// We need this to understand exactly which CIDs the source PDF flags as
// mapped, vs which it leaves orphan (and pdf.js drops).

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(
  root,
  "test/fixtures/maldivian.pdf",
);
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_000);

const result = await page.evaluate(async () => {
  const mod = await import("/src/dev/dumpToUnicode.ts");
  const res = await fetch(window.location.origin + "/test.pdf");
  if (!res.ok) return { error: "fetch failed" };
  const buf = await res.arrayBuffer();
  return await mod.dumpToUnicode(buf);
});

for (const f of result) {
  console.log("=".repeat(70));
  console.log("resource:", f.resource, "  baseFont:", f.baseFont);
  console.log("hasToUnicode:", f.hasToUnicode);
  if (!f.hasToUnicode) continue;
  console.log("--- raw CMap text (truncated to 2000) ---");
  console.log(f.cmapText?.slice(0, 2000));
  console.log("--- parsed mappings:", f.parsedMappings?.length, "---");
  for (const m of f.parsedMappings ?? []) {
    const cps = m.codePoints
      .map((c) => "U+" + c.toString(16).padStart(4, "0"))
      .join(" ");
    console.log(
      `  cid=0x${m.cid.toString(16).padStart(4, "0")} → ${cps}`,
    );
  }
}
await browser.close();
process.exit(0);
