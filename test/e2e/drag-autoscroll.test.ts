import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { FIXTURE, loadFixture, setupBrowser, tearDown, type Harness } from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  h = await setupBrowser({ viewport: { width: 1000, height: 700 } });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("drag auto-scroll", () => {
  test("bottom edge uses the visible viewport, not the scroll container layout bottom", async () => {
    await loadFixture(h, FIXTURE.withImagesMultipage, { expectedPages: 2 });

    await h.page.evaluate(() => {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: { offsetTop: 0, height: 520 },
      });
    });

    const image = h.page.locator("[data-image-id]").first();
    const box = await image.boundingBox();
    expect(box, "source image should be rendered").not.toBeNull();
    if (!box) return;

    const startX = box.x + box.width / 2;
    const startY = box.y + 20;
    const before = await h.page.locator("main").evaluate((el) => el.scrollTop);

    await h.page.mouse.move(startX, startY);
    await h.page.mouse.down();
    await h.page.mouse.move(startX, 500, { steps: 8 });
    await h.page.waitForTimeout(700);

    const during = await h.page.locator("main").evaluate((el) => el.scrollTop);
    await h.page.mouse.up();

    expect(during).toBeGreaterThan(before + 100);
  });
});
