import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "fs";
import {
  FIXTURE,
  RENDER_SCALE,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("text editor caret placement", () => {
  test("clicking the Maldivian 6.2 line opens a collapsed caret at the source PDF position", async () => {
    const fixtureBytes = fs.readFileSync(FIXTURE.maldivian).toString("base64");
    const target = await h.page.evaluate(
      async ({ b64, scale }) => {
        // oxlint-disable-next-line typescript/no-implied-eval
        const importer = new Function("p", "return import(p)") as (
          p: string,
        ) => Promise<typeof import("../../src/lib/loadSource")>;
        const { loadSource } = await importer("/src/lib/loadSource.ts");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], "maldivian.pdf", { type: "application/pdf" });
        const source = await loadSource(file, scale, "caret-test");
        const pageIndex = 1;
        const run = source.pages[pageIndex].textRuns.find((r) => r.text.startsWith("6.2"));
        if (!run?.caretPositions) throw new Error("6.2 source run not found");
        const caretOffset = run.text.indexOf("އަޙްމަދު");
        const beforeCandidates = run.caretPositions.filter((p) => p.offset === caretOffset);
        const before =
          beforeCandidates.length > 0
            ? beforeCandidates.reduce((min, p) => (p.x < min.x ? p : min), beforeCandidates[0])
            : null;
        const after = run.caretPositions.find((p) => p.offset === caretOffset + 1);
        if (!before || !after) throw new Error("target source caret candidates not found");
        return {
          pageIndex,
          runId: run.id,
          caretOffset,
          // Click inside the glyph, closer to the leading edge than
          // the following edge. This catches real source-glyph hit
          // testing without landing on an ambiguous bidi/space boundary.
          sourceX: before.x + (after.x - before.x) * 0.4,
          sourceY: run.baselineY - run.height / 2,
          text: run.text,
        };
      },
      { b64: fixtureBytes, scale: RENDER_SCALE },
    );

    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: target.pageIndex + 1 });

    const run = h.page.locator(
      `[data-page-index="${target.pageIndex}"] [data-run-id="${target.runId}"]`,
    );
    await run.waitFor({ state: "visible" });
    await run.scrollIntoViewIfNeeded();

    const click = await h.page.evaluate((target) => {
      const pageEl = document.querySelector<HTMLElement>(`[data-page-index="${target.pageIndex}"]`);
      if (!pageEl) throw new Error("target page not found");
      const rect = pageEl.getBoundingClientRect();
      const viewWidth = Number(pageEl.dataset.viewWidth);
      const displayScale = rect.width / viewWidth;
      return {
        x: rect.left + target.sourceX * displayScale,
        y: rect.top + target.sourceY * displayScale,
      };
    }, target);
    await h.page.mouse.click(click.x, click.y);

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

    expect(selection.value).toBe(target.text);
    expect(selection.start).toBe(selection.end);
    expect(selection.start).toBe(target.caretOffset);

    await h.page.keyboard.type("X");
    const edited = await editor.inputValue();
    expect(edited).not.toBe("X");
    expect(edited.length).toBe(target.text.length + 1);
    expect(edited).toContain("X");
  });
});
