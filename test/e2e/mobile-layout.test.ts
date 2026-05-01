// Mobile (390×844) layout smoke test. Verifies that at a phone-sized
// viewport:
//   - The app does NOT overflow horizontally.
//   - The mobile header subtree is the visible one (`sm:hidden`).
//   - All header buttons (Open, Save, Select, +T, +I) are reachable.
//   - The sidebar is hidden on mobile (no thumbnail rail eating
//     horizontal width).
//   - The page canvas fits within the viewport's content width.
//
// Counterpart of mobile-edit.test.ts which exercises the touch
// interactions; this file is purely structural.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import {
  FIXTURE,
  SCREENSHOTS,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("mobile layout (390×844)", () => {
  test("no horizontal overflow on initial paint", async () => {
    const overflow = await h.page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      bodyW: document.body.scrollWidth,
      viewportW: window.innerWidth,
    }));
    // Allow 1px slack for sub-pixel rounding.
    expect(overflow.docW).toBeLessThanOrEqual(overflow.viewportW + 1);
    expect(overflow.bodyW).toBeLessThanOrEqual(overflow.viewportW + 1);
  });

  test("mobile header is rendered (and only one header at a time)", async () => {
    // App switches headers conditionally based on `useIsMobile()` —
    // exactly ONE <header> exists in the DOM at any time. The mobile
    // header is the visible one at this viewport.
    const headers = await h.page.locator("header").all();
    expect(headers.length).toBe(1);
    expect(await headers[0].isVisible()).toBe(true);
    // Mobile header has its tool buttons rendered icon-only with
    // aria-labels — desktop header has different markup. A reliable
    // way to assert "this is the mobile header": the icon-only Add
    // text button.
    const iconBtn = h.page.locator("button[aria-label='Add text']");
    expect(await iconBtn.isVisible(), "mobile-only icon button should be present").toBe(true);
  });

  test("Open / Save / Select / +Text / +Image are all reachable", async () => {
    // Mobile tool buttons are icon-only — locate by aria-label.
    for (const label of ["Open PDF", "Select tool", "Add text", "Add image"]) {
      const btn = h.page.locator(`button[aria-label="${label}"]`);
      expect(await btn.isVisible(), `button "${label}" should be visible`).toBe(true);
    }
    // Save button label includes a count suffix so match by prefix.
    const saveBtn = h.page.locator("button[aria-label^='Save']");
    expect(await saveBtn.first().isVisible(), "Save button should be visible").toBe(true);
  });

  test("loading a PDF: page canvas fits viewport width, sidebar hidden", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    // Sidebar isn't rendered (its container has `hidden sm:block`); we
    // assert no thumbnail rail is in the visible layout.
    const sidebarThumbs = await h.page.locator("aside").count();
    // PageSidebar uses <aside>, but it's wrapped in `hidden sm:block`
    // — at this viewport that wrapper resolves to display:none, so
    // either the aside isn't visible OR isn't there. Either is fine.
    if (sidebarThumbs > 0) {
      const visible = await h.page.locator("aside").first().isVisible();
      expect(visible).toBe(false);
    }
    // Page canvas (rendered inside the inner natural-size container)
    // — its bounding rect is the displayed size after the fit-to-
    // width transform. It must not exceed the viewport's content
    // width (innerWidth - main padding).
    const pageRect = await h.page.locator("[data-page-index='0']").boundingBox();
    expect(pageRect, "page slot 0 should be in DOM").not.toBeNull();
    expect(pageRect!.width).toBeLessThanOrEqual(390);
    // And the displayScale should actually be < 1 (fit kicked in)
    // — natural Letter width is ~612 × 1.5 = 918 CSS px, way wider
    // than 390.
    const naturalW = await h.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-page-index='0']");
      return el ? parseFloat(el.dataset.viewWidth ?? "0") : 0;
    });
    expect(naturalW).toBeGreaterThan(390);
    expect(pageRect!.width).toBeLessThan(naturalW);
  });
});
