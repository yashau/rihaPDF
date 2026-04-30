// User-reported regression: paragraph lines on page 2 of the
// Maldivian fixture have parens / slashes / digits that need to
// appear inside the edit box when the line is opened — and after
// commit, the original glyphs (including the punctuation) must be
// gone from the canvas. This catches the case where the run-builder
// previously dropped small punctuation Tj's into a separate run
// that the editor never reached.

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
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("paragraph edit boxes carry adjacent punctuation", () => {
  test("opening the 6.1 line-2 run shows the parens, slash, and digits", async () => {
    await loadFixture(h.page, FIXTURE.maldivian);
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    // The 14/2019 line carries: digits, parens, slash. The Thaana
    // text is unique enough to lock the right run by partial match.
    const target = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="1"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.includes("14/2019") || text.includes("14") && text.includes("2019")) {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute("data-run-id")!,
            cx: r.x + r.width / 2,
            cy: r.y + r.height / 2,
            text,
          };
        }
      }
      return null;
    });
    expect(
      target,
      "couldn't find a run carrying the 14/2019 line on page 2",
    ).not.toBeNull();

    // Click to open the editor.
    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    await h.page.waitForTimeout(300);
    const editorValue = await h.page
      .locator("input[data-editor]")
      .first()
      .inputValue();

    // The edit box must show every visible piece of the line.
    expect(editorValue).toContain("14");
    expect(editorValue).toContain("2019");
    expect(editorValue, `edit box content: "${editorValue}"`).toMatch(/[()]/);
    expect(editorValue, `edit box content: "${editorValue}"`).toMatch(/\//);
  });
});
