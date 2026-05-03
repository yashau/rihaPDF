// Regression: changing the font of a source-PDF run on a doc whose
// text lives inside Form XObjects (Cloudflare-style invoice PDFs).
// Two issues the user hit:
//
//   1. After picking a font in the toolbar's <select>, clicking
//      anywhere on the page didn't dismiss the editor — the input's
//      onBlur had already fired (and been suppressed) when focus
//      moved to the <select>, so a subsequent body click triggered no
//      event on the input. Only Enter would commit.
//
//   2. The preview-strip pipeline silently no-ops on text rendered
//      via Form XObjects (`findTextShows()` only sees the page's
//      top-level Tj/TJ ops). After commit, the original glyphs
//      remained on the page canvas underneath the new HTML overlay,
//      so the user saw a duplicate of the text in the new format.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import { SCREENSHOTS, loadFixture, setupBrowser, tearDown, type Harness } from "../helpers/browser";

const PDF = path.resolve(__dirname, "..", "..", "daa5dfab-210f-5e3d-9d4d-bb85d574c357.pdf");

let h: Harness;
beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});
afterAll(async () => {
  if (h) await tearDown(h);
});

describe("font change on Form-XObject text", () => {
  test("click-outside commits + no duplicate glyphs after commit", async () => {
    if (!fs.existsSync(PDF)) {
      // Fixture is user-supplied; skip if absent.
      return;
    }
    await loadFixture(h.page, PDF);

    const target = await h.page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-page-index="0"] [data-run-id]')) {
        const t = (el.textContent ?? "").trim();
        if (t.length >= 3) {
          return { id: el.getAttribute("data-run-id")!, text: t };
        }
      }
      return null;
    });
    expect(target).not.toBeNull();

    const sel = `[data-run-id="${target!.id}"]`;
    await h.page.locator(sel).click();
    await h.page.waitForTimeout(300);

    // Use the toolbar font picker like a real user — open it, then pick.
    const fontInfo = await h.page.evaluate(() => {
      const s = document.querySelector<HTMLSelectElement>("[data-edit-toolbar] select");
      if (!s) return null;
      return {
        current: s.value,
        next: Array.from(s.options).find((o) => o.value !== s.value)?.value ?? null,
      };
    });
    expect(fontInfo?.next).toBeTruthy();
    await h.page.locator("[data-edit-toolbar] select").click();
    await h.page.locator("[data-edit-toolbar] select").selectOption(fontInfo!.next);
    await h.page.waitForTimeout(150);

    // Issue 1: click outside the toolbar/editor must commit.
    expect(await h.page.locator("input[data-editor]").count()).toBe(1);
    await h.page.mouse.click(40, 40);
    await h.page.waitForTimeout(300);
    expect(
      await h.page.locator("input[data-editor]").count(),
      "click-outside should dismiss the editor after using the font picker",
    ).toBe(0);

    // Wait long enough for the preview-strip rebuild to settle.
    await h.page.waitForTimeout(800);

    // Issue 2: no visible duplicate. The wrapper span has a white
    // background masking whatever the strip couldn't reach.
    const overlayBg = await h.page.evaluate(({ runId }) => {
      const el = document.querySelector(`[data-run-id="${runId}"]`);
      if (!el) return null;
      return getComputedStyle(el).backgroundColor;
    }, { runId: target!.id });
    expect(
      overlayBg,
      "edited overlay must have an opaque background to mask un-strippable canvas glyphs",
    ).toMatch(/rgb\(255,\s*255,\s*255\)/);

    // Diagnostic screenshot.
    const r = await h.page.locator(sel).boundingBox();
    if (r) {
      await h.page.screenshot({
        path: `${SCREENSHOTS}/edit-format-form-xobject.png`,
        clip: {
          x: Math.max(0, r.x - 80),
          y: Math.max(0, r.y - 30),
          width: r.width + 200,
          height: r.height + 80,
        },
      });
    }
  });
});
