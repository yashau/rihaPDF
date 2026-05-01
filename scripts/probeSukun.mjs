// Probe sukun handling in maldivian2.pdf:
//
//   1. List every font and its ToUnicode mappings.
//   2. For each font, list every CID that maps to U+0020 (the symptom
//      we see — sukun-as-space). For each, show the immediate-neighbour
//      CIDs and what *they* map to. The Office "fili gap" recovery
//      patches a CID-to-U+0020 only when its neighbours are consecutive
//      Thaana fili — so the report tells us if maldivian2 fits that
//      pattern, or if it's a different shape we need to handle.
//   3. Also probe the GlyphMap the app actually builds.

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian2.pdf");
setTimeout(() => process.exit(2), 90_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console-err]", msg.text());
});
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
// We don't actually need the file picker — we just need a page where
// the dev modules resolve. Pass the bytes in via base64.
await page.waitForTimeout(500);

const b64 = fs.readFileSync(PDF).toString("base64");

const result = await page.evaluate(async (b64) => {
  const importer = new Function("p", "return import(p)");
  const dumpMod = await importer("/src/dev/dumpToUnicode.ts");
  const glyphMod = await importer("/src/lib/glyphMap.ts");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

  const fonts = await dumpMod.dumpToUnicode(bytes);

  // Also dump the per-page font resource names so we can correlate
  // which fonts are actually used on the page where the screenshot
  // came from.
  const pdfLib = await importer("pdf-lib");
  const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageFontNames = [];
  for (let i = 0; i < doc.getPages().length; i++) {
    try {
      const m = glyphMod.extractPageGlyphMaps(doc, i);
      const names = [...m.keys()].sort();
      pageFontNames.push({ page: i, fonts: names });
    } catch (e) {
      pageFontNames.push({ page: i, error: String(e) });
    }
  }

  // Build the GlyphMap the app uses for page 0, with the actual
  // patched values, so we can verify what `cid=0x77` resolves to.
  let glyphMap0 = null;
  try {
    const m = glyphMod.extractPageGlyphMaps(doc, 0);
    const out = {};
    for (const [name, gm] of m) {
      const entries = [...gm.toUnicode.entries()];
      const sukun = entries.filter(([, u]) => u === 0x07b0).map(([c]) => c);
      const aabaa = entries.filter(([, u]) => u === 0x07a7).map(([c]) => c);
      const space = entries.filter(([, u]) => u === 0x20).map(([c]) => c);
      out[name] = {
        total: entries.length,
        sukunCids: sukun.map((c) => "0x" + c.toString(16)),
        aabaaCids: aabaa.map((c) => "0x" + c.toString(16)),
        spaceCids: space.map((c) => "0x" + c.toString(16)),
      };
    }
    glyphMap0 = out;
  } catch (e) {
    glyphMap0 = { error: String(e) };
  }
  return { fonts, glyphMap0, pageFontNames };
}, b64);

if (result.error) {
  console.log("ERROR:", result.error);
  await browser.close();
  process.exit(1);
}

for (const f of result.fonts) {
  console.log("=".repeat(70));
  console.log("resource:", f.resource, "  baseFont:", f.baseFont);
  console.log("hasToUnicode:", f.hasToUnicode);
  if (!f.hasToUnicode || !f.parsedMappings) continue;

  const byCid = new Map(f.parsedMappings.map((m) => [m.cid, m.codePoints]));
  const spaceCids = [...byCid.entries()].filter(([_, cps]) => cps[0] === 0x20).map(([cid]) => cid);
  console.log(`  total mappings: ${f.parsedMappings.length}, → U+0020: ${spaceCids.length}`);
  if (spaceCids.length === 0) continue;

  console.log("  CIDs mapping to U+0020 (and their neighbours):");
  const fmt = (cps) =>
    cps ? cps.map((c) => "U+" + c.toString(16).padStart(4, "0")).join(",") : "—";
  for (const cid of spaceCids.slice(0, 40)) {
    const prev = byCid.get(cid - 1);
    const next = byCid.get(cid + 1);
    console.log(
      `    cid=0x${cid.toString(16).padStart(4, "0")}  prev=${fmt(prev)}  next=${fmt(next)}`,
    );
  }
  if (spaceCids.length > 40) console.log(`    …${spaceCids.length - 40} more`);

  // Also surface CIDs near the Thaana fili block that are NOT in the
  // CMap (orphan CIDs — pdf.js drops these entirely).
  const filiBlockCids = [];
  for (const [cid, cps] of byCid.entries()) {
    if (cps[0] >= 0x07a6 && cps[0] <= 0x07b0) filiBlockCids.push(cid);
  }
  filiBlockCids.sort((a, b) => a - b);
  if (filiBlockCids.length > 0) {
    console.log(`  fili-block CIDs in this font: ${filiBlockCids.length}`);
    console.log(
      `    range: 0x${filiBlockCids[0].toString(16)}..0x${filiBlockCids[filiBlockCids.length - 1].toString(16)}`,
    );
  }
}

console.log("\n=== GlyphMap built by the app for PAGE 0 ===");
if (result.glyphMap0 && !result.glyphMap0.error) {
  for (const [name, info] of Object.entries(result.glyphMap0)) {
    console.log(
      `  ${name}: total=${info.total}, sukun=${info.sukunCids.join(",") || "—"}, aabaa=${info.aabaaCids.join(",") || "—"}, space=${info.spaceCids.join(",") || "—"}`,
    );
  }
} else {
  console.log("  (failed:", result.glyphMap0?.error, ")");
}

console.log("\n=== Per-page font resource names (only fonts with usable map) ===");
for (const p of result.pageFontNames) {
  if (p.error) {
    console.log(`  page ${p.page}: error: ${p.error}`);
  } else {
    console.log(`  page ${p.page}: ${p.fonts.join(", ")}`);
  }
}

await browser.close();
process.exit(0);
