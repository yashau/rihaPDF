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
  test("partial redaction strips per-glyph, not the whole run", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: PAGES });

    // Need a substantial run so a SHRUNK rect leaves meaningful glyphs
    // outside it. ≥10 chars + the test still works on Thaana RTL where
    // getTextContent returns logical order.
    const target = await h.page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-page-index="0"] [data-run-id]')) {
        const t = (el.textContent ?? "").trim();
        if (t.length >= 10) {
          return { id: el.getAttribute("data-run-id")!, text: t };
        }
      }
      return null;
    });
    expect(target, "page-0 should have at least one ≥10-char run").not.toBeNull();
    const originalText = target!.text;

    const targetRun = h.page.locator(`[data-run-id="${target!.id}"]`);
    await h.page.locator('[data-testid="tool-redact"]').click();
    await h.page.waitForTimeout(100);
    const redactionEl = await dropRedactionOverRun(targetRun);

    // Select the rect so its resize handles render.
    const redBox = await redactionEl.boundingBox();
    expect(redBox, "redaction overlay should have a bbox").not.toBeNull();
    await h.page.mouse.click(redBox!.x + redBox!.width / 2, redBox!.y + redBox!.height / 2);
    await h.page.waitForTimeout(150);

    // Drag the bottom-right corner ~80% of the way toward the bottom-
    // left. Result: the rect now covers only the LEFT ~20% of its
    // original area, so most glyphs in the run sit OUTSIDE the rect
    // and (under per-glyph stripping) survive into the saved file.
    // Per-RUN stripping would remove the whole run regardless of the
    // rect's final size — that's the bug this case proves is fixed.
    const handle = redactionEl.locator('[data-resize-handle="br"]');
    const handleBox = await handle.boundingBox();
    expect(handleBox, "BR resize handle should be visible after select").not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const targetX = redBox!.x + redBox!.width * 0.2;
    const targetY = startY;
    await h.page.mouse.move(startX, startY);
    await h.page.mouse.down();
    await h.page.mouse.move((startX + targetX) / 2, targetY, { steps: 5 });
    await h.page.mouse.move(targetX, targetY, { steps: 5 });
    await h.page.mouse.up();
    await h.page.waitForTimeout(150);

    const newBox = await redactionEl.boundingBox();
    expect(newBox!.width, "rect should have actually shrunk").toBeLessThan(redBox!.width * 0.5);

    const dlPromise = h.page.waitForEvent("download", { timeout: 15_000 });
    await h.page.locator("header button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "redact-partial-maldivian2.pdf");
    await dl.saveAs(saved);

    const text = await firstPageText(saved);

    // (a) The full original text must NOT survive — we did strip
    //     something, just not everything.
    expect(text, "redacted glyphs must be missing from the saved doc").not.toContain(originalText);

    // (b) At least one 4-char window from the original should still
    //     appear. Per-glyph strip removes only middle chars, leaving
    //     contiguous prefix + suffix segments. Per-run strip would
    //     remove the whole run → no 4-char window from `originalText`
    //     would land in the saved page (except by coincidence elsewhere
    //     on the page, which is rare for Thaana fragments).
    let preservedWindow: string | null = null;
    for (let i = 0; i + 4 <= originalText.length; i++) {
      const sub = originalText.slice(i, i + 4);
      if (text.includes(sub)) {
        preservedWindow = sub;
        break;
      }
    }
    expect(
      preservedWindow,
      `at least one 4-char window of the original run must survive partial redaction; original was ${JSON.stringify(originalText)}`,
    ).not.toBeNull();
  });

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

    // Activate redact tool, then place a redaction over the run.
    await h.page.locator('[data-testid="tool-redact"]').click();
    await h.page.waitForTimeout(100);
    await dropRedactionOverRun(h.page.locator(`[data-run-id="${target!.id}"]`));

    // The in-editor preview should now have a black rectangle on
    // page 0 (selectable / resizable, but here we just save).
    const redactionCount = await h.page.locator("[data-redaction-id]").count();
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

async function dropRedactionOverRun(run: ReturnType<Harness["page"]["locator"]>) {
  const runBox = await run.boundingBox();
  expect(runBox, "target text run should have a bbox").not.toBeNull();
  const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
  expect(pageBox, "page should have a bbox").not.toBeNull();

  const x = Math.max(pageBox!.x + 2, runBox!.x - 6);
  const y = Math.max(pageBox!.y + 2, runBox!.y - 8);
  await h.page.mouse.click(x, y);
  await h.page.waitForTimeout(150);

  const redactionEl = h.page.locator("[data-redaction-id]").first();
  const redBox = await redactionEl.boundingBox();
  expect(redBox, "redaction overlay should be created").not.toBeNull();

  const desiredRight = Math.min(pageBox!.x + pageBox!.width - 2, runBox!.x + runBox!.width + 6);
  const desiredBottom = Math.min(pageBox!.y + pageBox!.height - 2, runBox!.y + runBox!.height + 8);
  if (redBox!.x + redBox!.width < desiredRight || redBox!.y + redBox!.height < desiredBottom) {
    const handle = redactionEl.locator('[data-resize-handle="br"]');
    const handleBox = await handle.boundingBox();
    expect(handleBox, "BR resize handle should be visible after placement").not.toBeNull();
    await h.page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await h.page.mouse.down();
    await h.page.mouse.move(desiredRight, desiredBottom, { steps: 8 });
    await h.page.mouse.up();
    await h.page.waitForTimeout(150);
  }

  return redactionEl;
}

async function firstPageText(pdfPath: string): Promise<string> {
  const bytes = fs.readFileSync(pdfPath);
  return h.page.evaluate(async (b64) => {
    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdfMod = (await importer(
      "/src/pdf/render/pdf.ts",
    )) as typeof import("../../src/pdf/render/pdf");
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
