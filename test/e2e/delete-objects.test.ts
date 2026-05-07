// End-to-end deletion: every object type can be removed from the saved
// PDF. Source images go via select-then-Delete-key; inserted images via
// select-then-Delete-key; source text runs via the EditField's trash
// button; inserted text via the same trash button (also covers the
// existing empty-then-close auto-delete path).

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

const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAFUlEQVR4nGP8z8AARMQDxlGNAxoAAH7vAv9OUszhAAAAAElFTkSuQmCC",
  "base64",
);

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("deletion", () => {
  test("source image: click + Delete key strips the q…Q block from save", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const before = await imageCount(FIXTURE.withImages, 0);
    expect(before, "fixture should have at least one image to delete").toBeGreaterThanOrEqual(1);

    // Click the first source-image overlay → app marks it selected.
    const firstImage = h.page.locator("[data-image-id]").first();
    await firstImage.waitFor({ state: "visible" });
    await firstImage.click();
    await h.page.waitForTimeout(50);
    // Press the Delete key. The window-level handler fires
    // setImageMoves(...deleted=true), strip pipeline removes the
    // overlay + canvas pixels.
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(200);

    // Save + reload the output.
    const dl = await downloadSave(h);
    const saved = path.join(SCREENSHOTS, "delete-source-image.pdf");
    await dl.saveAs(saved);

    const after = await imageCount(saved, 0);
    expect(after, "saved PDF should have one fewer image").toBe(before - 1);
  });

  test("inserted image: click + Backspace removes the entry; Save resets to clean", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    // Drop an image, then immediately delete it via select + Backspace.
    const tmpPng = path.join(SCREENSHOTS, "delete-inserted-pixel.png");
    fs.writeFileSync(tmpPng, RED_PIXEL_PNG);
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Image/ })
      .click();
    await h.page.locator('input[type="file"][accept*="image"]').setInputFiles(tmpPng);
    await h.page.waitForTimeout(300);
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.5, pageBox!.y + pageBox!.height * 0.5);
    await h.page.waitForTimeout(200);

    // Confirm the overlay is on the page first.
    expect(await h.page.locator("[data-image-insert-id]").count()).toBe(1);

    // Click + Backspace.
    const inserted = h.page.locator("[data-image-insert-id]").first();
    await inserted.click();
    await h.page.waitForTimeout(50);
    await h.page.keyboard.press("Backspace");
    await h.page.waitForTimeout(150);

    // Overlay gone.
    expect(
      await h.page.locator("[data-image-insert-id]").count(),
      "inserted-image overlay should be gone",
    ).toBe(0);

    // No edits remain — Save button reverts to disabled.
    const saveDisabled = await h.page
      .locator("header button")
      .filter({ hasText: /^Save/ })
      .isDisabled();
    expect(saveDisabled, "insert-then-delete should leave no work for save").toBe(true);
  });

  test("source text: trash button strips the run from save", async () => {
    await loadFixture(h.page, FIXTURE.maldivian);

    // Pick the first text run on page 1, capture its text, click to
    // open the editor, click the trash button, save.
    const firstRun = h.page.locator('[data-page-index="0"] [data-run-id]').first();
    await firstRun.waitFor({ state: "visible" });
    const originalText = (await firstRun.textContent()) ?? "";
    expect(originalText.length, "fixture's first run should contain text").toBeGreaterThanOrEqual(
      1,
    );

    await firstRun.click();
    await h.page.waitForTimeout(150);
    // Trash button has aria-label "Delete text".
    const trash = h.page.locator('button[aria-label^="Delete text"]');
    await trash.waitFor({ state: "visible" });
    await trash.click();
    await h.page.waitForTimeout(150);

    const dl = await downloadSave(h);
    const saved = path.join(SCREENSHOTS, "delete-source-text.pdf");
    await dl.saveAs(saved);

    // Saved output's page 1 text should NOT include the deleted text.
    const text = await firstPageText(saved);
    // Strict: no substring match. Trim original since pdf.js text
    // extraction sometimes adds incidental spacing.
    const trimmed = originalText.trim();
    if (trimmed.length >= 3) {
      expect(text, "deleted run's text should be absent from saved output").not.toContain(trimmed);
    }
  });

  test("inserted text: trash button removes the overlay and resets save state", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const SENTINEL = "DELETED_INSERT_001";

    // Drop a text box, type sentinel.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.4, pageBox!.y + pageBox!.height * 0.4);
    await h.page.waitForTimeout(200);
    const insertedInput = h.page.locator("[data-text-insert-id] input").first();
    await insertedInput.fill(SENTINEL);
    // Don't press Enter (closes); click the trash button.
    const trash = h.page.locator('button[aria-label^="Delete text"]');
    await trash.waitFor({ state: "visible" });
    await trash.click();
    await h.page.waitForTimeout(150);

    // Overlay should be gone.
    expect(
      await h.page.locator("[data-text-insert-id]").count(),
      "inserted-text overlay should be gone",
    ).toBe(0);

    // Save resets to disabled.
    const saveDisabled = await h.page
      .locator("header button")
      .filter({ hasText: /^Save/ })
      .isDisabled();
    expect(saveDisabled, "insert-then-delete should leave no work for save").toBe(true);
  });

  test("Escape clears selection — Delete after that is a no-op", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const before = await imageCount(FIXTURE.withImages, 0);

    const firstImage = h.page.locator("[data-image-id]").first();
    await firstImage.waitFor({ state: "visible" });
    await firstImage.click();
    await h.page.keyboard.press("Escape");
    await h.page.waitForTimeout(50);
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);

    // Save button should still be disabled (no edits).
    const saveDisabled = await h.page
      .locator("header button")
      .filter({ hasText: /^Save/ })
      .isDisabled();
    expect(saveDisabled, "Save should be disabled — Escape cleared selection").toBe(true);

    // Sanity: image count unchanged in the fixture (no save attempted).
    const after = await imageCount(FIXTURE.withImages, 0);
    expect(after).toBe(before);
  });
});

async function downloadSave(h: Harness) {
  const dlPromise = h.page.waitForEvent("download", { timeout: 15_000 });
  await h.page.locator("header button").filter({ hasText: /^Save/ }).click();
  return dlPromise;
}

async function imageCount(pdfPath: string, pageIndex: number): Promise<number> {
  const bytes = fs.readFileSync(pdfPath);
  return h.page.evaluate(
    async ({ b64, pageIndex }) => {
      // oxlint-disable-next-line typescript/no-implied-eval
      const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const mod = (await importer(
        "/src/lib/sourceImages.ts",
      )) as typeof import("../../src/lib/sourceImages");
      const images = await mod.extractPageImages(bytes.buffer);
      return images[pageIndex]?.length ?? 0;
    },
    { b64: bytes.toString("base64"), pageIndex },
  );
}

async function firstPageText(pdfPath: string): Promise<string> {
  const bytes = fs.readFileSync(pdfPath);
  return h.page.evaluate(async (b64) => {
    // oxlint-disable-next-line typescript/no-implied-eval
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
