import { describe, test, expect } from "vitest";
import { FIXTURE, loadFixture, setupBrowser, tearDown, type Harness } from "../helpers/browser";

async function openHighlightColorPicker(h: Harness) {
  await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
  await h.page.locator('button[aria-label="Highlight"]').click();
  const trigger = h.page.locator('button[aria-label="Highlight color"]');
  await trigger.click();
  const popover = h.page.locator('[role="dialog"][aria-labelledby]').first();
  expect(await popover.isVisible(), "color picker popover should be visible").toBe(true);
  const popoverRect = await popover.boundingBox();
  const triggerRect = await trigger.boundingBox();
  const viewport = h.page.viewportSize();
  expect(popoverRect, "color picker popover should be measurable").not.toBeNull();
  expect(triggerRect, "color picker trigger should be measurable").not.toBeNull();
  expect(viewport, "test browser should have a viewport").not.toBeNull();
  return { popoverRect: popoverRect!, triggerRect: triggerRect!, viewport: viewport! };
}

describe("color picker positioning", () => {
  test("mobile annotation color picker flips above the bottom toolbar", async () => {
    const h = await setupBrowser({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      const { popoverRect, triggerRect, viewport } = await openHighlightColorPicker(h);
      expect(
        popoverRect.y,
        "popover should not overflow above the viewport",
      ).toBeGreaterThanOrEqual(0);
      expect(
        popoverRect.y + popoverRect.height,
        "popover should not overflow below the mobile viewport",
      ).toBeLessThanOrEqual(viewport.height);
      expect(
        popoverRect.y + popoverRect.height,
        "mobile bottom-toolbar picker should open above its trigger",
      ).toBeLessThanOrEqual(triggerRect.y);
    } finally {
      await tearDown(h);
    }
  }, 60_000);

  test("desktop annotation color picker remains inside the viewport", async () => {
    const h = await setupBrowser({ viewport: { width: 1400, height: 900 } });
    try {
      const { popoverRect, triggerRect, viewport } = await openHighlightColorPicker(h);
      expect(
        popoverRect.y,
        "popover should not overflow above the viewport",
      ).toBeGreaterThanOrEqual(0);
      expect(
        popoverRect.y + popoverRect.height,
        "popover should not overflow below the desktop viewport",
      ).toBeLessThanOrEqual(viewport.height);
      expect(popoverRect.y, "desktop header picker should open below its trigger").toBeGreaterThan(
        triggerRect.y,
      );
    } finally {
      await tearDown(h);
    }
  }, 60_000);
});
