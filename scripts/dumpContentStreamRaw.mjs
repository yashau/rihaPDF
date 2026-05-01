// Dump the raw content-stream operators per page so we can see what's
// actually drawing the non-text content (images, vector paths, form
// XObjects, inline images).

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian.pdf");
const PAGE = Number(process.argv[2] ?? "1");
setTimeout(() => process.exit(2), 60_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(2_500);

const out = await page.evaluate(async (pageIdx) => {
  const pdfLib = await import("pdf-lib");
  const cs = await import("/src/lib/contentStream.ts");
  const pc = await import("/src/lib/pageContent.ts");
  const res = await fetch(window.location.origin + "/test.pdf");
  const buf = await res.arrayBuffer();
  const doc = await pdfLib.PDFDocument.load(buf);
  const p = doc.getPages()[pageIdx];
  if (!p) return { error: "no page" };
  const bytes = pc.getPageContentBytes(doc.context, p.node);
  const ops = cs.parseContentStream(bytes);
  // Walk Resources for XObjects
  const xobjectsList = [];
  let node = p.node;
  while (node) {
    const r = node.lookup(pdfLib.PDFName.of("Resources"));
    if (r instanceof pdfLib.PDFDict) {
      const xo = r.lookup(pdfLib.PDFName.of("XObject"));
      if (xo instanceof pdfLib.PDFDict) {
        for (const [n] of xo.entries()) {
          const x = xo.lookup(n);
          const name = n.toString();
          let subtype = null;
          let dict = null;
          if (x instanceof pdfLib.PDFDict) dict = x;
          else if (x?.dict instanceof pdfLib.PDFDict) dict = x.dict;
          if (dict) {
            const s = dict.lookup(pdfLib.PDFName.of("Subtype"));
            subtype = s ? String(s) : null;
          }
          xobjectsList.push({ name, subtype });
        }
      }
    }
    const par = node.lookup(pdfLib.PDFName.of("Parent"));
    if (par instanceof pdfLib.PDFDict) node = par;
    else if (par instanceof pdfLib.PDFRef) {
      const r2 = doc.context.lookup(par);
      node = r2 instanceof pdfLib.PDFDict ? r2 : null;
    } else node = null;
  }
  return {
    xobjectsList,
    summary: ops.slice(0, 200).map((o) => ({
      op: o.op,
      operandsPreview: o.operands
        .slice(0, 6)
        .map((t) => {
          if (t.kind === "number") return t.raw;
          if (t.kind === "name") return "/" + t.value;
          if (t.kind === "literal-string") return `(${t.bytes.length}b)`;
          if (t.kind === "hex-string") return `<${t.bytes.length}b>`;
          if (t.kind === "array") return `[${t.items.length}]`;
          return t.kind;
        })
        .join(" "),
    })),
  };
}, PAGE - 1);

console.log("=== XObjects on page", PAGE, "===");
for (const x of out.xobjectsList ?? []) {
  console.log(" ", x.name, x.subtype);
}
console.log("\n=== ops (first 200) ===");
for (let i = 0; i < (out.summary?.length ?? 0); i++) {
  const o = out.summary[i];
  if (
    /^(BT|ET|Tj|TJ|Tf|Tm|Td|TD|T\*|Tr|Tc|Tw|TL|Ts|m|l|c|h|v|y|S|s|f|F|B|b|f\*|B\*|b\*|n)$/.test(
      o.op,
    )
  ) {
    // Compact text + path drawing ops to a single column.
    if (i < 200) console.log(`  ${i.toString().padStart(3)}  ${o.op}`);
  } else {
    console.log(`  ${i.toString().padStart(3)}  ${o.op}  ${o.operandsPreview}`);
  }
}

await browser.close();
process.exit(0);
