import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { FIXTURE, loadFixture, setupBrowser, tearDown, type Harness } from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("text editor caret placement", () => {
  test("clicking a source run opens a collapsed caret at the click position", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    const run = h.page.locator('[data-page-index="0"] [data-run-id]').first();
    await run.waitFor({ state: "visible" });
    const original = (await run.textContent()) ?? "";
    expect(original.length).toBeGreaterThan(8);

    const box = await run.boundingBox();
    if (!box) throw new Error("source run has no bounding box");
    await h.page.mouse.click(box.x + box.width * 0.52, box.y + box.height / 2);

    const editor = h.page.locator("input[data-editor]").first();
    await editor.waitFor({ state: "visible" });
    const selection = await editor.evaluate((el) => {
      const input = el as HTMLInputElement;
      return {
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
    });

    expect(selection.value).toBe(original);
    expect(selection.start).toBe(selection.end);
    expect(selection.start).toBeGreaterThan(0);
    expect(selection.start).toBeLessThan(original.length);

    await h.page.keyboard.type("X");
    const edited = await editor.inputValue();
    expect(edited).not.toBe("X");
    expect(edited.length).toBe(original.length + 1);
    expect(edited).toContain("X");
  });
});
