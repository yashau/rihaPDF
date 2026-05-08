import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import fs from "fs";
import {
  APP_URL,
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

beforeEach(async () => {
  await h.page.goto(APP_URL, { waitUntil: "networkidle" });
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
        const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
        const { loadSource } = (await importer(
          "/src/pdf/source/loadSource.ts",
        )) as typeof import("../../src/pdf/source/loadSource");
        const { buildSourceTextBlocks } = (await importer(
          "/src/pdf/text/textBlocks.ts",
        )) as typeof import("../../src/pdf/text/textBlocks");
        const { displayTextForEditor } = (await importer(
          "/src/components/PdfPage/rtlDisplayText.ts",
        )) as typeof import("../../src/components/PdfPage/rtlDisplayText");
        const { sourceEditorText } = (await importer(
          "/src/components/PdfPage/sourceEditorText.ts",
        )) as typeof import("../../src/components/PdfPage/sourceEditorText");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], "maldivian.pdf", { type: "application/pdf" });
        const source = await loadSource(file, scale, "caret-test");
        const pageIndex = 1;
        const run = source.pages[pageIndex].textRuns.find((r) => r.text.startsWith("6.2"));
        if (!run?.caretPositions) throw new Error("6.2 source run not found");
        const block = buildSourceTextBlocks(
          source.pages[pageIndex].textRuns,
          source.pages[pageIndex].pageNumber,
        ).find((b) => b.sourceRunIds.includes(run.id));
        if (!block) throw new Error("6.2 source paragraph block not found");
        const targetWord = "އަޙްމަދު";
        const caretOffset = run.text.indexOf(targetWord);
        const editorText = sourceEditorText(displayTextForEditor(block.text, true), block, true);
        const blockCaretOffset = editorText.indexOf(targetWord);
        if (blockCaretOffset < 0) throw new Error("target word not found inside paragraph block");
        const beforeCandidates = run.caretPositions.filter((p) => p.offset === caretOffset);
        const before =
          beforeCandidates.length > 0
            ? beforeCandidates.reduce((min, p) => (p.x < min.x ? p : min), beforeCandidates[0])
            : null;
        const after = run.caretPositions.find((p) => p.offset === caretOffset + 1);
        if (!before || !after) throw new Error("target source caret candidates not found");
        return {
          pageIndex,
          runId: block.id,
          caretOffset: blockCaretOffset,
          // Click inside the glyph, closer to the leading edge than
          // the following edge. This catches real source-glyph hit
          // testing without landing on an ambiguous bidi/space boundary.
          sourceX: before.x + (after.x - before.x) * 0.4,
          sourceY: run.baselineY - run.height / 2,
          text: editorText,
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

    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    const selection = await editor.evaluate((el) => {
      const root = el as HTMLElement;
      const selection = window.getSelection();
      const offsetFor = (node: Node | null, nodeOffset: number | null) => {
        if (!node || nodeOffset === null) return null;
        const range = document.createRange();
        range.selectNodeContents(root);
        range.setEnd(node, nodeOffset);
        return range
          .toString()
          .replace(/[\u2066-\u2069]/gu, "")
          .replace(/\n$/u, "").length;
      };
      return {
        value: root.innerText
          .replace(/[\u2066-\u2069]/gu, "")
          .replace(/\n{2,}/gu, "\n")
          .replace(/\n$/u, ""),
        start: offsetFor(selection?.anchorNode ?? null, selection?.anchorOffset ?? null),
        end: offsetFor(selection?.focusNode ?? null, selection?.focusOffset ?? null),
      };
    });

    expect(selection.value).toBe(target.text.replace(/\n{2,}/gu, "\n"));
    expect(selection.start).toBe(selection.end);
    expect(Math.abs((selection.start ?? -1) - target.caretOffset)).toBeLessThanOrEqual(6);

    await h.page.keyboard.type("X");
    const edited = await editor.evaluate((el) =>
      (el as HTMLElement).innerText
        .replace(/[\u2066-\u2069]/gu, "")
        .replace(/\n{2,}/gu, "\n")
        .replace(/\n$/u, ""),
    );
    expect(edited).not.toBe("X");
    expect(edited.length).toBe(target.text.length + 1);
    expect(edited).toContain("X");
    expect(Math.abs(edited.indexOf("X") - target.caretOffset)).toBeLessThanOrEqual(6);
  });

  test("clicking trailing blank space in a paragraph places the caret at the line end", async () => {
    const fixtureBytes = fs.readFileSync(FIXTURE.maldivian).toString("base64");
    const target = await h.page.evaluate(
      async ({ b64, scale }) => {
        // oxlint-disable-next-line typescript/no-implied-eval
        const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
        const { loadSource } = (await importer(
          "/src/pdf/source/loadSource.ts",
        )) as typeof import("../../src/pdf/source/loadSource");
        const { buildSourceTextBlocks } = (await importer(
          "/src/pdf/text/textBlocks.ts",
        )) as typeof import("../../src/pdf/text/textBlocks");
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], "maldivian.pdf", { type: "application/pdf" });
        const source = await loadSource(file, scale, "trailing-caret-test");
        const pageIndex = 1;
        const run = source.pages[pageIndex].textRuns.find((r) => r.text.startsWith("6.2"));
        if (!run) throw new Error("6.2 source run not found");
        const block = buildSourceTextBlocks(
          source.pages[pageIndex].textRuns,
          source.pages[pageIndex].pageNumber,
        ).find((b) => b.sourceRunIds.includes(run.id));
        if (!block) throw new Error("6.2 source paragraph block not found");
        return { pageIndex, runId: block.id };
      },
      { b64: fixtureBytes, scale: RENDER_SCALE },
    );
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator(`[data-page-index="${target.pageIndex}"]`).scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const run = h.page.locator(
      `[data-page-index="${target.pageIndex}"] [data-run-id="${target.runId}"]`,
    );
    await run.waitFor({ state: "visible" });
    const runBox = await run.boundingBox();
    expect(runBox, "couldn't find the Maldivian 6.2 paragraph").not.toBeNull();
    await h.page.mouse.click(runBox!.x + runBox!.width * 0.5, runBox!.y + runBox!.height * 0.15);

    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    await h.page.waitForFunction(
      () =>
        document
          .querySelector<HTMLElement>('[data-editor][contenteditable="true"]')
          ?.getAttribute("data-text-visible") === "true",
    );
    await editor.evaluate((el) => {
      const root = el as HTMLElement;
      root.scrollTop = root.scrollHeight;
    });

    const before = await editor.evaluate((el) =>
      (el as HTMLElement).innerText.replace(/[\u2066-\u2069]/gu, "").replace(/\n$/u, ""),
    );
    const click = await editor.evaluate((el) => {
      const normalize = (text: string) => text.replace(/[\u2066-\u2069]/gu, "").replace(/\n$/u, "");
      const root = el as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(root);
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      range.detach();
      if (rects.length === 0) throw new Error("paragraph editor text rect not found");
      const rootRect = root.getBoundingClientRect();
      const rootText = normalize(root.innerText);
      const finalTop = Math.max(...rects.map((rect) => rect.top));
      const finalLineRects = rects.filter((rect) => Math.abs(rect.top - finalTop) <= 2);
      const textLeft = Math.min(...finalLineRects.map((rect) => rect.left));
      const lineTop = Math.min(...finalLineRects.map((rect) => rect.top));
      const lineBottom = Math.max(...finalLineRects.map((rect) => rect.bottom));
      return {
        x: Math.max(rootRect.left + 4, textLeft - 2),
        y: (lineTop + lineBottom) / 2,
        expectedOffset: rootText.length,
      };
    });

    await h.page.mouse.click(click.x, click.y);
    await h.page.keyboard.type("X");
    const edited = await editor.evaluate((el) =>
      (el as HTMLElement).innerText.replace(/[\u2066-\u2069]/gu, "").replace(/\n$/u, ""),
    );

    expect(edited).toBe(
      `${before.slice(0, click.expectedOffset)}X${before.slice(click.expectedOffset)}`,
    );
  });
});
