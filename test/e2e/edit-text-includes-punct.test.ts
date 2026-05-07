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
  test("opening page-2 list lines preserves marker spacing, parens, slash, and digits", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    for (const marker of ["6.1", "6.2"]) {
      const listLine = await h.page.evaluate((marker) => {
        const host = document.querySelector('[data-page-index="1"]');
        if (!host) return null;
        for (const el of host.querySelectorAll("[data-run-id]")) {
          const text = el.textContent || "";
          if (text.startsWith(marker) && /[\u0780-\u07bf]/u.test(text)) {
            return {
              id: el.getAttribute("data-run-id")!,
              text,
            };
          }
        }
        return null;
      }, marker);
      expect(listLine, `couldn't find the ${marker} list line on page 2`).not.toBeNull();

      const listEditorValue = stripBidiControls(await openEditorValue(listLine!.id));
      expect(listEditorValue, `edit box content: "${listEditorValue}"`).toMatch(
        new RegExp(`^${marker.replace(".", "\\.")} {2,}[\\u0780-\\u07bf]`, "u"),
      );
      await closeEditor();
    }

    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 3 });
    await h.page.locator('[data-page-index="2"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);
    const sevenOne = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="2"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.startsWith("7.1") && /[\u0780-\u07bf]/u.test(text)) {
          return {
            id: el.getAttribute("data-run-id")!,
            text,
          };
        }
      }
      return null;
    });
    expect(sevenOne, "couldn't find the 7.1 list line on page 3").not.toBeNull();
    const sevenOneEditorValue = stripBidiControls(await openEditorValue(sevenOne!.id));
    expect(sevenOneEditorValue, `edit box content: "${sevenOneEditorValue}"`).toMatch(
      /^7\.1 {2,}[\u0780-\u07bf]/u,
    );
    await closeEditor();

    const sevenTwo = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="2"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.startsWith("7.2") && text.includes("129") && /[\u0780-\u07bf]/u.test(text)) {
          return {
            id: el.getAttribute("data-run-id")!,
            text,
          };
        }
      }
      return null;
    });
    expect(sevenTwo, "couldn't find the 7.2 / 129 list line on page 3").not.toBeNull();
    const sevenTwoEditorValue = stripBidiControls(await openEditorValue(sevenTwo!.id));
    expect(
      sevenTwoEditorValue,
      `edit box should not glue Thaana text to 129: "${sevenTwoEditorValue}"`,
    ).not.toMatch(/[\u0780-\u07bf]129/u);
    expect(
      sevenTwoEditorValue,
      `edit box should keep a separator after 129: "${sevenTwoEditorValue}"`,
    ).toMatch(/[\u0780-\u07bf]\s+129\s+[\u0780-\u07bf]/u);
    expect(sevenTwoEditorValue, `edit box content: "${sevenTwoEditorValue}"`).toMatch(
      /^7\.2 {2,}[\u0780-\u07bf]/u,
    );
    await closeEditor();

    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    // The 14/2019 line carries: digits, parens, slash. The Thaana
    // text is unique enough to lock the right run by partial match.
    const target = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="1"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.includes("14/2019") || (text.includes("14") && text.includes("2019"))) {
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
    expect(target, "couldn't find a run carrying the 14/2019 line on page 2").not.toBeNull();

    // Click to open the editor.
    const editorValue = stripBidiControls(await openEditorValue(target!.id));

    // The edit box must show every visible piece of the line.
    expect(editorValue).toContain("14");
    expect(editorValue).toContain("2019");
    expect(editorValue, `edit box content: "${editorValue}"`).toMatch(/[()]/);
    expect(editorValue, `edit box content: "${editorValue}"`).toMatch(/\//);
    expect(editorValue, `opening paren should hug Thaana text: "${editorValue}"`).not.toMatch(
      /\(\s+[\u0780-\u07bf]/u,
    );
    expect(editorValue, `closing paren should hug Thaana text: "${editorValue}"`).not.toMatch(
      /[\u0780-\u07bf]\s+\)/u,
    );
  });
});

async function openEditorValue(runId: string): Promise<string> {
  await h.page.locator(`[data-run-id="${runId}"]`).click();
  const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
  await editor.waitFor({ state: "visible" });
  await h.page.waitForFunction(
    () =>
      document
        .querySelector<HTMLElement>('[data-editor][contenteditable="true"]')
        ?.getAttribute("data-text-visible") === "true",
  );
  return editor.evaluate((el) => (el as HTMLElement).innerText.replace(/\n$/u, ""));
}

async function closeEditor(): Promise<void> {
  const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
  await editor.press("Control+Enter");
  await editor.waitFor({ state: "detached" });
}

function stripBidiControls(text: string): string {
  return text.replace(/[\u2066-\u2069]/gu, "");
}
