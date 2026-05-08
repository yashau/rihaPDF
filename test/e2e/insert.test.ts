// End-to-end insert: drop a text box and an image, save, reload —
// assert the saved PDF carries both. Driven by the synthetic image
// fixture so we exercise the case where the source PDF already has
// images (counts must add up to original + 1).

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  FIXTURE,
  SCREENSHOTS,
  captureImageCount,
  extractTextByPage,
  loadFixture,
  saveAndDownload,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

const SENTINEL = "INSERTED_TEXT_42";
// 1×1 red PNG used as the dropped image — kept tiny so the diff stays
// small but distinguishable from the fixture's existing reds/blues.
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

describe("inserting net-new content", () => {
  test("insert text + image, save, reload — both persist", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    const before = await captureImageCount(h.page, FIXTURE.withImages);

    // Drop the image fixture into a temp file the file-input can read.
    const tmpPng = path.join(SCREENSHOTS, "insert-pixel.png");
    fs.writeFileSync(tmpPng, RED_PIXEL_PNG);

    // Click "+ Text" → drop on page → type sentinel → Enter.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.3);
    await h.page.waitForTimeout(200);
    const insertedTextInput = h.page.locator('[data-editor][contenteditable="true"]').first();
    await insertedTextInput.fill(SENTINEL);
    await insertedTextInput.press("Control+Enter");
    await h.page.waitForTimeout(200);

    // Click "+ Image" → upload tmp PNG → click on page to place.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Image/ })
      .click();
    await h.page.locator('input[type="file"][accept*="image"]').setInputFiles(tmpPng);
    await h.page.waitForTimeout(400);
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.6, pageBox!.y + pageBox!.height * 0.6);
    await h.page.waitForTimeout(300);

    // The inserted-image overlay should be carrying a real data: URL
    // for its background — not just a placeholder rectangle. Catch
    // regressions like the URL.revokeObjectURL race we hit when the
    // overlay was wiring up an Object URL.
    const overlayBg = await h.page
      .locator("[data-image-insert-id]")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(overlayBg, "inserted-image overlay must paint a backgroundImage").toMatch(
      /url\(.*data:image\/(png|jpeg);base64,/,
    );
    await h.page.locator('[data-page-index="0"]').screenshot({
      path: path.join(SCREENSHOTS, "insert-overlay.png"),
    });

    // Save + reload.
    const saved = await saveAndDownload(h.page, "insert.pdf");

    await loadFixture(h.page, saved);

    // Verify text + image count via the app's own modules.
    const text = await extractTextByPage(h.page, saved);
    const imageCount = await captureImageCount(h.page, saved);
    expect(text[0]).toContain(SENTINEL);
    expect(imageCount).toBe(before + 1);
  });
});
