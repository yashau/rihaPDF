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
  const insertInput = h.page.locator("[data-text-insert-id] input").first();
  await insertInput.fill(SENTINEL);
  await h.page.waitForTimeout(150);

  const toolbar = h.page.locator("[data-edit-toolbar]");
  await toolbar.locator('button[aria-label="Underline"]').click();
  await h.page.waitForTimeout(120);
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

describe("underline / strikethrough round-trip", () => {
  test("save → reopen → toolbar reflects state → toggle off → save → no decoration", async () => {
    // 1. Save a fresh PDF with both decorations on.
    const decorated = await dropDecoratedText("decoration-on.pdf");
    const decorationCount = await countThinHorizontalBlocks(decorated);
    expect(
      decorationCount,
      `expected 2 thin horizontal blocks (underline + strikethrough); got ${decorationCount}. (saved: ${decorated})`,
    ).toBe(2);

    // 2. Re-open the saved PDF and click the inserted text run. The
    //    toolbar must show both Underline and Strikethrough pressed —
    //    the load-time pairing stamped them onto run.underline /
    //    run.strikethrough, and the EditField defaults the toolbar
    //    state from those when the user hasn't overridden them.
    await loadFixture(h, decorated);
    // Find a run containing our sentinel text — drawText splits long
    // text into multiple Tj's but the sentinel should land in one run.
    const runId = await h.page.evaluate((needle: string) => {
      const els = Array.from(document.querySelectorAll<HTMLElement>("[data-run-id]"));
      for (const el of els) {
        if ((el.textContent ?? "").includes(needle)) {
          return el.getAttribute("data-run-id");
        }
      }
      return null;
    }, SENTINEL);
    expect(runId, "decorated run not in DOM after reload").toBeTruthy();
    await h.page.locator(`[data-run-id="${runId}"]`).click();
    await h.page.waitForTimeout(300);

    const underlinePressed = await h.page
      .locator('[data-edit-toolbar] button[aria-label="Underline"]')
      .getAttribute("aria-pressed");
    const strikePressed = await h.page
      .locator('[data-edit-toolbar] button[aria-label="Strikethrough"]')
      .getAttribute("aria-pressed");
    expect(underlinePressed, "underline button should reflect run.underline").toBe("true");
    expect(strikePressed, "strikethrough button should reflect run.strikethrough").toBe("true");

    // 3. Toggle both OFF, commit, save again.
    await h.page.locator('[data-edit-toolbar] button[aria-label="Underline"]').click();
    await h.page.waitForTimeout(120);
    await h.page.locator('[data-edit-toolbar] button[aria-label="Strikethrough"]').click();
    await h.page.waitForTimeout(120);
    await h.page.locator("input[data-editor]").press("Enter");
    await h.page.waitForTimeout(300);

    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator("button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const cleared = path.join(SCREENSHOTS, "decoration-off.pdf");
    await dl.saveAs(cleared);

    const remaining = await countThinHorizontalBlocks(cleared);
    expect(
      remaining,
      `expected 0 thin horizontal blocks after toggling decoration off; got ${remaining}. (saved: ${cleared})`,
    ).toBe(0);
  }, 60_000);
});
