// Vector-shape delete: clicking on the overlay for a detected source
// shape (line / filled rect / path) selects it, pressing Del flags it,
// and the saved PDF no longer paints it.
//
// Fixture is `with-shapes.pdf` — synthetic A4 with a horizontal rule
// at y≈600pt and a filled rectangle at y≈300pt. The test deletes the
// rectangle and asserts (a) the rule survives in the saved PDF, (b)
// the rectangle no longer appears as a detected shape on reload.

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
import { extractPageShapes } from "../../src/lib/sourceShapes";

let h: Harness;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("vector-shape delete", () => {
  test("clicking a shape overlay then Del strips its q…Q from the saved PDF", async () => {
    await loadFixture(h.page, FIXTURE.withShapes);

    // Pre-condition: the loader detected exactly the two shapes the
    // builder emitted.
    const initialShapeCount = await h.page.locator("[data-shape-id]").count();
    expect(initialShapeCount, "expected exactly 2 detected shapes on load").toBe(2);

    // The fixture is 595×842 PDF user space, top-left CSS-y at the
    // page top. Page renders at scale 1.5. The rectangle's PDF y-range
    // is 300..380; viewport top = (842 - 380) * 1.5 ≈ 693. Centre
    // x is (100 + 200)/2 = 200pt → CSS 300px.
    //
    // Identify the rectangle's overlay by hit-testing at that point.
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    const rectCenterClient = {
      x: pageBox!.x + 200 * 1.5,
      y: pageBox!.y + (842 - 340) * 1.5, // y midpoint = 340pt
    };
    const rectShapeId = await h.page.evaluate((p) => {
      const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      return el?.closest("[data-shape-id]")?.getAttribute("data-shape-id") ?? null;
    }, rectCenterClient);
    expect(rectShapeId, "expected a shape overlay under the rectangle's centre").not.toBeNull();

    // Click to select, then Del to delete.
    await h.page.mouse.click(rectCenterClient.x, rectCenterClient.y);
    await h.page.waitForTimeout(120);
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);

    // Live overlay should be gone for the deleted shape; the other
    // shape stays.
    const afterDeleteCount = await h.page.locator("[data-shape-id]").count();
    expect(
      afterDeleteCount,
      "overlay for the deleted shape should disappear; the other survives",
    ).toBe(1);

    // Save and reload.
    const dlPromise = h.page.waitForEvent("download", { timeout: 8_000 });
    await h.page.locator("button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "delete-shape.pdf");
    await dl.saveAs(saved);

    // Reopen the saved PDF and confirm the detector now finds 1 shape
    // (the rule), not 2.
    const reloadedShapes = await extractPageShapes(fs.readFileSync(saved).buffer.slice(0));
    expect(reloadedShapes.length, "saved PDF should still have one page").toBeGreaterThanOrEqual(1);
    expect(
      reloadedShapes[0].length,
      "saved PDF should retain exactly the rule (1 shape), with the rectangle stripped",
    ).toBe(1);
  }, 25_000);
});
