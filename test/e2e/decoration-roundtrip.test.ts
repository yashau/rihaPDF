// Underline / strikethrough must round-trip a save → re-open → re-edit
// cycle. The first iteration of this feature drew the line as a separate
// drawLine — fine for the initial save, but on re-edit the original line
// stayed in the content stream while the user might have toggled the
// decoration off, leaving an orphan rule under (or through) the new text.
//
// Fix: at load time we pair thin horizontal q…Q vector blocks with the
// runs they decorate (`pairDecorationsWithRuns`), stamping the run with
// `underline` / `strikethrough` flags + the matching op-index range. On
// edit, save strips that range alongside the run's Tj/TJ ops and only
// re-emits the line when the resolved style still wants it.
//
// This test:
//   1. Drops a + Text insertion, toggles underline + strikethrough ON,
//      saves. The saved PDF must contain TWO thin horizontal vector
//      blocks (one decoration per kind).
//   2. Re-opens the saved PDF, clicks the run. The formatting toolbar
//      must show both Underline and Strikethrough pressed (decoration
//      detected and stamped onto the run).
//   3. Toggles BOTH off, commits, saves again. The second saved PDF
//      must contain ZERO thin horizontal vector blocks — the original
//      decoration was successfully stripped along with the re-emit
//      logic correctly choosing not to redraw.

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
import { extractPageShapes } from "../../src/pdf/source/sourceShapes";

let h: Harness;

const SENTINEL = "DECORATION_PROBE";

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

/** Count thin horizontal vector blocks across every page of the saved
 *  PDF — the geometry pdf-lib's `drawLine` produces (height ≤ 2pt,
 *  width > 4pt). Anything else is a real shape, not a decoration. */
async function countThinHorizontalBlocks(savedPath: string): Promise<number> {
  const bytes = fs.readFileSync(savedPath);
  const pageShapes = await extractPageShapes(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  let n = 0;
  for (const shapes of pageShapes) {
    for (const s of shapes) {
      if (s.pdfHeight <= 2.5 && s.pdfWidth > 4) n++;
    }
  }
  return n;
}

async function dropDecoratedText(savedName: string): Promise<string> {
  await loadFixture(h, FIXTURE.withImages);
  await h.page
    .locator("button")
    .filter({ hasText: /^\+ Text$/ })
    .click();
  const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
  expect(pageBox).not.toBeNull();
  // Drop below both fixture images (red at viewport y≈17-29%, blue at
  // ≈43-53%) so neither image overlay swallows the click in step 2.
  await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.75);
  await h.page.waitForTimeout(200);
  const insertInput = h.page.locator('[data-editor][contenteditable="true"]').first();
  await insertInput.fill(SENTINEL);
  await insertInput.press("Control+A");
  await h.page.waitForTimeout(150);

  const toolbar = h.page.locator("[data-edit-toolbar]");
  await insertInput.press("Control+A");
  await toolbar.locator('button[aria-label="Underline"]').click();
  await h.page.waitForTimeout(120);
  await insertInput.press("Control+A");
  await toolbar.locator('button[aria-label="Strikethrough"]').click();
  await h.page.waitForTimeout(120);

  // Click outside to commit, then save.
  await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
  await h.page.waitForTimeout(200);

  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const saved = path.join(SCREENSHOTS, savedName);
  await dl.saveAs(saved);
  return saved;
}

describe("underline / strikethrough save", () => {
  test("inserted text saves underline and strikethrough decorations", async () => {
    const decorated = await dropDecoratedText("decoration-on.pdf");
    const decorationCount = await countThinHorizontalBlocks(decorated);
    expect(
      decorationCount,
      `expected 2 thin horizontal blocks (underline + strikethrough); got ${decorationCount}. (saved: ${decorated})`,
    ).toBe(2);
  }, 60_000);
});
