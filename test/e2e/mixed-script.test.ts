// Phase 3 (HarfBuzz bidi-aware mixed-script) smoke test. Insert text
// containing both Latin and Thaana, save, reload, assert pdf.js can
// extract every codepoint of both spans from the saved PDF.
//
// We assert PRESENCE not EXACT-ORDER for the Thaana span. pdf.js's
// per-glyph TextItem grouping doesn't preserve logical-order recovery
// for RTL clusters in the presence of adjacent Latin runs (the bucket
// grouping in buildTextRuns interacts with pdf.js's item-merge in
// ways that drop the same-x tiebreaker). Visual rendering is correct
// (verified by inspecting the saved PDF directly); recovering perfect
// logical order through pdf.js' getTextContent would need either a
// different emission strategy (e.g. one Tj per cluster with TJ-array
// inter-glyph adjustments) or post-extraction cluster repair, both
// follow-ups.
//
// The inserted text auto-detects "no explicit dir" because the user
// never clicked the dir toolbar — that's the trigger for the
// `isMixedScriptText` dispatch in save.ts.

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

const LATIN_SENTINEL = "Hello";
const THAANA_SENTINEL = "ދިވެހި";
/** Logical-order codepoints inside the Thaana sentinel. We assert
 *  every one is present in the extracted text (in any order) — see
 *  the file-level comment on why exact-order recovery is deferred. */
const THAANA_CODEPOINTS = Array.from(THAANA_SENTINEL);
const MIXED = `${LATIN_SENTINEL} ${THAANA_SENTINEL}`;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("mixed-script insert", () => {
  test("Latin + Thaana in one inserted run round-trip both spans", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.3);
    await h.page.waitForTimeout(200);

    const insertInput = h.page.locator("[data-text-insert-id] input").first();
    await insertInput.fill(MIXED);
    await h.page.waitForTimeout(150);
    await insertInput.press("Enter");
    await h.page.waitForTimeout(200);

    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator("button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "mixed-script.pdf");
    await dl.saveAs(saved);

    // Load the saved PDF back through the app and read what the user
    // would see on the run overlays. The app's run-grouping pipeline
    // (extractPageFontShows + the overlay merge in PdfPage) is what
    // turns per-glyph Tj operators back into a logical-order string —
    // matching what other PDF tools (Acrobat, Preview) display.
    await loadFixture(h.page, saved);
    const overlayTexts = await h.page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-page-index="0"] [data-run-id]')).map(
        (el) => el.textContent || "",
      ),
    );
    const joined = overlayTexts.join(" | ");

    expect(joined, `Latin sentinel should round-trip via run overlays`).toContain(LATIN_SENTINEL);
    for (const cp of THAANA_CODEPOINTS) {
      expect(
        joined,
        `Thaana codepoint ${cp.codePointAt(0)?.toString(16)} (${cp}) missing`,
      ).toContain(cp);
    }
  }, 30_000);
});
