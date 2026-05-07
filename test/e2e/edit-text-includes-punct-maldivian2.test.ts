// Same regression coverage as edit-text-includes-punct.test.ts but on
// maldivian2.pdf — when a run carrying mixed text + punctuation +
// digits is opened in the editor, the input must show every visible
// piece of the run (no punctuation dropped into a separate, unreached
// run by the run-builder).
//
// maldivian2 page 1 carries the registration URL
//   https://forms.office.com/r/Bx2mdhMvuj
// which combines colon, slashes, dots, mixed case ASCII, and digits —
// a strong cross-section of punctuation in one run. We open it and
// expect the editor to expose the whole URL.

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

describe("paragraph edit boxes carry adjacent punctuation (maldivian2)", () => {
  test("opening the registration-URL run shows colon, slashes, dots, digits", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: 14 });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const target = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="1"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.includes("forms.office.com")) {
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
      "couldn't find a run carrying the registration URL on page 2 of maldivian2.pdf",
    ).not.toBeNull();

    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    await h.page.waitForFunction(
      () =>
        document
          .querySelector<HTMLElement>('[data-editor][contenteditable="true"]')
          ?.getAttribute("data-text-visible") === "true",
    );
    const editorValue = await editor.evaluate((el) =>
      (el as HTMLElement).innerText.replace(/\n$/u, ""),
    );

    expect(editorValue, `edit box content: "${editorValue}"`).toContain("https");
    expect(editorValue, `edit box content: "${editorValue}"`).toContain("forms.office.com");
    expect(editorValue, `edit box content: "${editorValue}"`).toMatch(/:\/\//);
    expect(editorValue, `edit box content: "${editorValue}"`).toContain("Bx2mdhMvuj");
  });

  test("opening the page-2 table cell p2-r5 does not merge neighbouring cells or rows", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: 14 });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const target = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="1"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text === "57-T/IU/2026/15") {
          return {
            id: el.getAttribute("data-run-id")!,
            text,
          };
        }
      }
      return null;
    });
    expect(target, "couldn't find the p2-r5 table cell").not.toBeNull();

    await h.page.locator(`[data-run-id="${target!.id}"]`).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          view: window,
        }),
      );
    });
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    const editorValue = await editor.evaluate((el) =>
      (el as HTMLElement).innerText.replace(/\n$/u, ""),
    );

    expect(editorValue).toBe("57-T/IU/2026/15");
    expect(editorValue).not.toContain("އިޢުލާން");
    expect(editorValue).not.toContain("1.1");
    expect(editorValue).not.toContain("1.2");
  });
});
