import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { FIXTURE, loadFixture, setupBrowser, tearDown, type Harness } from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("source font detection", () => {
  test("mixed Thaana agenda number line keeps the source Faruma font", async () => {
    await loadFixture(h, FIXTURE.maldivian, { expectedPages: 3 });

    const target = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="0"]');
      if (!host) return null;
      for (const el of host.querySelectorAll<HTMLElement>("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.replace(/\s+/g, "").includes("އޖ/2026/1/14")) {
          return {
            id: el.dataset.runId,
            family: el.dataset.fontFamily,
            base: el.dataset.baseFont,
            text,
          };
        }
      }
      return null;
    });

    expect(target, "couldn't find the agenda number line").not.toBeNull();
    expect(target!.family).toBe("Faruma");
    expect(target!.base).toContain("Faruma");

    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    const editor = h.page.locator("input[data-editor]").first();
    await expect.poll(() => editor.inputValue()).toBe(target!.text);
    const editorFamily = await editor.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(editorFamily).toMatch(/Faruma/i);
  });
});
