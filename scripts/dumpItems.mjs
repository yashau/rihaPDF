// Dump pdf.js raw text items to see exactly what's coming out per item.
// We re-fetch the PDF from inside the live page so it uses the same pdf.js
// the app is using.
//
// Usage: node scripts/dumpItems.mjs [pageNumber]

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
const PAGE_NUM = Number(process.argv[2] ?? "1");

setTimeout(() => process.exit(2), 45_000).unref?.();

const pdfBytes = fs.readFileSync(PDF_PATH);
const pdfBase64 = pdfBytes.toString("base64");

const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
}).then((c) => c.newPage());
page.setDefaultTimeout(8_000);

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
// Make sure the app's pdf.js worker is registered.
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF_PATH);
await page.waitForSelector("[data-page-index]", { timeout: 20_000 });
await page.waitForTimeout(800);

const items = await page.evaluate(
  async ({ b64, pageNum }) => {
    // pdf.js is loaded via the app's bundle; pull from the same module map.
    const mod = await import(
      /* @vite-ignore */ "/node_modules/pdfjs-dist/build/pdf.mjs"
    );
    if (!mod.GlobalWorkerOptions.workerSrc) {
      mod.GlobalWorkerOptions.workerSrc =
        "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    }
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await mod.getDocument({ data }).promise;
    const p = await doc.getPage(pageNum);
    const content = await p.getTextContent({
      disableCombineTextItems: true,
      includeMarkedContent: true,
      disableNormalization: true,
    });
    return content.items.map((it) => {
      if (!("transform" in it) || !it.transform) {
        return { marked: it.type, id: it.id ?? null };
      }
      return {
        str: it.str,
        hasEOL: it.hasEOL,
        x: +it.transform[4].toFixed(2),
        y: +it.transform[5].toFixed(2),
        w: +it.width.toFixed(2),
        h: +Math.abs(it.transform[3]).toFixed(2),
        font: it.fontName,
      };
    });
  },
  { b64: pdfBase64, pageNum: PAGE_NUM },
);

console.log(`page ${PAGE_NUM}: ${items.length} items`);
console.log(
  "idx | text                  | x       y      w     h    | font",
);
console.log("-".repeat(90));
items.forEach((it, i) => {
  if (it.marked) {
    console.log(`${String(i).padStart(3)} | (marked: ${it.marked} id=${it.id})`);
    return;
  }
  const text =
    it.str === "" ? "(empty)" : `"${it.str}"`.padEnd(22, " ").slice(0, 22);
  const codes =
    !it.str
      ? ""
      : "[" +
        Array.from(it.str)
          .map((c) => "U+" + c.codePointAt(0).toString(16).padStart(4, "0"))
          .join(" ") +
        "]";
  const xyhw = `${String(it.x).padStart(7)} ${String(it.y).padStart(6)} ${String(
    it.w,
  ).padStart(5)} ${String(it.h).padStart(4)}`;
  console.log(
    `${String(i).padStart(3)} | ${text} | ${xyhw} | ${it.font} ${codes}`,
  );
});

await browser.close();
process.exit(0);
