// Redaction round-trip on maldivian2.
//
// Verifies the saved PDF has *no recoverable text* under a redaction:
//
//   1. pdf.js `getTextContent()` (which honours /ToUnicode and
//      /ActualText) does not return the redacted run's text.
//   2. The raw saved bytes don't carry the redacted text in any
//      common literal encoding (UTF-8, UTF-16BE-hex). This catches
//      stray /ActualText leaks or /ToUnicode regressions even if
//      pdf.js' extractor happens to skip them.
//
// Both checks must pass — annotation-style markup would fail (1)
// because the underlying glyphs would still be in the content stream
// and pdf.js would extract them straight through the visible black
// box. The redaction pipeline strips those Tj/TJ ops on save AND
// paints an opaque rect into the content stream.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  FIXTURE,
  SCREENSHOTS,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

const PAGES = 14;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("redaction round-trip (maldivian2)", () => {
  test("redacted run's text is gone from saved PDF text + raw bytes", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: PAGES });

    // Pick page-0's first text run with ≥5 chars — short runs (single
    // backticks etc.) make the absence assertion meaningless.
    const target = await h.page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-page-index="0"] [data-run-id]')) {
        const t = (el.textContent ?? "").trim();
        if (t.length >= 5) {
          return { id: el.getAttribute("data-run-id")!, text: t };
        }
      }
      return null;
    });
    expect(target, "page-0 should have at least one substantial text run").not.toBeNull();
    const originalText = target!.text;

    // Activate redact tool, then click the run.
    await h.page.locator('[data-testid="tool-redact"]').click();
    await h.page.waitForTimeout(100);
    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    await h.page.waitForTimeout(150);

    // The in-editor preview should now have a black rectangle on
    // page 0 (selectable / resizable, but here we just save).
    const redactionCount = await h.page.locator('[data-redaction-id]').count();
    expect(redactionCount, "exactly one redaction overlay after one click").toBe(1);

    const dlPromise = h.page.waitForEvent("download", { timeout: 15_000 });
    await h.page.locator("header button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "redact-maldivian2.pdf");
    await dl.saveAs(saved);

    // (1) pdf.js text extraction on page 1 should no longer carry the
    // redacted text. We check the WHOLE doc's first page; the source
    // run we picked lived on page 0 of maldivian2, which becomes
    // page 1 in the 1-indexed pdf.js API.
    const text = await firstPageText(saved);
    expect(text, "redacted run's text must be absent from pdf.js extraction").not.toContain(
      originalText,
    );

    // (2) Raw byte search across the entire saved file. Tries both
    // UTF-8 and UTF-16BE-hex (the encoding the /Highlight + /FreeText
    // /Contents fields use for non-ASCII) so a stray /ActualText
    // marker carrying the original Thaana would surface here even
    // if pdf.js silently dropped it.
    const bytes = fs.readFileSync(saved);
    const utf8 = Buffer.from(originalText, "utf-8");
    expect(
      indexOfBytes(bytes, utf8),
      "saved bytes must not contain the redacted text as raw UTF-8",
    ).toBe(-1);
    const utf16beHex = Buffer.from(toUtf16BEHex(originalText), "utf-8");
    expect(
      indexOfBytes(bytes, utf16beHex),
      "saved bytes must not contain the redacted text as UTF-16BE hex",
    ).toBe(-1);
  });
});

async function firstPageText(pdfPath: string): Promise<string> {
  const bytes = fs.readFileSync(pdfPath);
  return h.page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdfMod = (await importer("/src/lib/pdf.ts")) as typeof import("../../src/lib/pdf");
    const doc = await pdfMod.loadPdf(bytes.buffer.slice(0));
    const p = await doc.getPage(1);
    const content = await p.getTextContent();
    return content.items
      .filter((it) => "str" in it)
      .map((it) => (it as { str: string }).str)
      .join(" ");
  }, bytes.toString("base64"));
}

/** Boyer-Moore-Horspool would be faster, but the bytes are < 2 MB
 *  here and we only do two searches per test — `indexOf` on Buffer
 *  uses a SIMD path internally and is plenty quick. */
function indexOfBytes(haystack: Buffer, needle: Buffer): number {
  return haystack.indexOf(needle);
}

/** UTF-16BE hex encoding of `s`, matching the format /Contents
 *  PDFHexString fields use (each codepoint is 4 hex chars; surrogate
 *  pairs for SMP). No BOM prefix here — the search wouldn't care
 *  about the BOM and including it would only narrow the match. */
function toUtf16BEHex(s: string): string {
  const parts: string[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      parts.push(cp.toString(16).padStart(4, "0"));
    } else {
      const off = cp - 0x10000;
      const hi = 0xd800 + (off >> 10);
      const lo = 0xdc00 + (off & 0x3ff);
      parts.push(hi.toString(16).padStart(4, "0"));
      parts.push(lo.toString(16).padStart(4, "0"));
    }
  }
  return parts.join("");
}
