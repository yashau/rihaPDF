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
  loadFixture,
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

    const before = await captureImageCount(FIXTURE.withImages);

    // Drop the image fixture into a temp file the file-input can read.
    const tmpPng = path.join(SCREENSHOTS, "insert-pixel.png");
    fs.writeFileSync(tmpPng, RED_PIXEL_PNG);

    // Click "+ Text" → drop on page → type sentinel → Enter.
    await h.page.locator("button").filter({ hasText: /^\+ Text$/ }).click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(
      pageBox!.x + pageBox!.width * 0.3,
      pageBox!.y + pageBox!.height * 0.3,
    );
    await h.page.waitForTimeout(200);
    const insertedTextInput = h.page
      .locator("[data-text-insert-id] input")
      .first();
    await insertedTextInput.fill(SENTINEL);
    await insertedTextInput.press("Enter");
    await h.page.waitForTimeout(200);

    // Click "+ Image" → upload tmp PNG → click on page to place.
    await h.page.locator("button").filter({ hasText: /^\+ Image/ }).click();
    await h.page
      .locator('input[type="file"][accept*="image"]')
      .setInputFiles(tmpPng);
    await h.page.waitForTimeout(400);
    await h.page.mouse.click(
      pageBox!.x + pageBox!.width * 0.6,
      pageBox!.y + pageBox!.height * 0.6,
    );
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
    await h.page
      .locator('[data-page-index="0"]')
      .screenshot({
        path: path.join(SCREENSHOTS, "insert-overlay.png"),
      });

    // Save + reload.
    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator("button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "insert.pdf");
    await dl.saveAs(saved);

    await loadFixture(h.page, saved);

    // Verify text + image count via the app's own modules.
    const checks = await h.page.evaluate(async (b64) => {
      const importer = new Function("p", "return import(p)") as (
        p: string,
      ) => Promise<unknown>;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const sourceImages = (await importer("/src/lib/sourceImages.ts")) as
        typeof import("../../src/lib/sourceImages");
      const pdfMod = (await importer("/src/lib/pdf.ts")) as
        typeof import("../../src/lib/pdf");
      const imagesByPage = await sourceImages.extractPageImages(bytes.buffer);
      const doc = await pdfMod.loadPdf(bytes.buffer.slice(0));
      const p = await doc.getPage(1);
      const content = await p.getTextContent();
      const text = content.items
        .filter((it) => "str" in it)
        .map((it) => (it as { str: string }).str)
        .join(" ");
      return {
        page1ImageCount: imagesByPage[0]?.length ?? 0,
        page1Text: text,
      };
    }, fs.readFileSync(saved).toString("base64"));

    expect(checks.page1Text).toContain(SENTINEL);
    expect(checks.page1ImageCount).toBe(before + 1);
  });
});

async function captureImageCount(pdfPath: string): Promise<number> {
  const bytes = fs.readFileSync(pdfPath);
  return h.page.evaluate(async (b64) => {
    const importer = new Function("p", "return import(p)") as (
      p: string,
    ) => Promise<unknown>;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const mod = (await importer("/src/lib/sourceImages.ts")) as
      typeof import("../../src/lib/sourceImages");
    const images = await mod.extractPageImages(bytes.buffer);
    return images[0]?.length ?? 0;
  }, bytes.toString("base64"));
}
