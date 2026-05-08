import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import {
  FIXTURE,
  loadFixture,
  saveAndDownload,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

type Box = { x: number; y: number; width: number; height: number };

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
};

type TextLine = {
  y: number;
  xMin: number;
  xMax: number;
  text: string;
};

beforeAll(async () => {
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

async function resizeFromHandle(handleName: "bl" | "br", dx: number, dy: number) {
  const handle = h.page.locator(`[data-resize-handle="${handleName}"]`).first();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await h.page.mouse.move(startX, startY);
  await h.page.mouse.down();
  await h.page.mouse.move(startX + dx, startY + dy, { steps: 10 });
  await h.page.mouse.up();
  await h.page.waitForTimeout(150);
}

function screenBoxToPdf(box: Box, pageBox: Box, pageSize: { width: number; height: number }) {
  return {
    x: ((box.x - pageBox.x) / pageBox.width) * pageSize.width,
    y: pageSize.height - ((box.y - pageBox.y + box.height) / pageBox.height) * pageSize.height,
    width: (box.width / pageBox.width) * pageSize.width,
    height: (box.height / pageBox.height) * pageSize.height,
  };
}

async function savedTextItems(
  pdfPath: string,
  pageIndex = 0,
): Promise<{
  pageSize: { width: number; height: number };
  items: TextItem[];
}> {
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  return h.page.evaluate(
    async ({ b64, pageIndex }) => {
      // oxlint-disable-next-line typescript/no-implied-eval
      const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
      const pdfMod = (await importer(
        "/src/pdf/render/pdf.ts",
      )) as typeof import("../../src/pdf/render/pdf");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfMod.loadPdf(bytes.buffer);
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      type ExtractableTextItem = {
        str: string;
        transform: number[];
        width: number;
      };
      return {
        pageSize: { width: viewport.width, height: viewport.height },
        items: content.items.flatMap((item) => {
          if (!("str" in item) || !("transform" in item) || !("width" in item)) return [];
          const textItem = item as ExtractableTextItem;
          return [
            {
              str: textItem.str,
              x: textItem.transform[4],
              y: textItem.transform[5],
              width: textItem.width,
            },
          ];
        }),
      };
    },
    { b64, pageIndex },
  );
}

function linesInsideBox(items: TextItem[], box: Box, tolerance = 3): TextLine[] {
  const rows: TextItem[][] = [];
  for (const item of items) {
    if (item.str.trim().length === 0) continue;
    const xCenter = item.x + item.width / 2;
    if (xCenter < box.x - tolerance || xCenter > box.x + box.width + tolerance) continue;
    if (item.y < box.y - tolerance || item.y > box.y + box.height + tolerance) continue;
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= tolerance);
    if (row) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows
    .map((row) => ({
      y: row.reduce((sum, item) => sum + item.y, 0) / row.length,
      xMin: Math.min(...row.map((item) => item.x)),
      xMax: Math.max(...row.map((item) => item.x + item.width)),
      text: row.map((item) => item.str).join(""),
    }))
    .sort((a, b) => b.y - a.y);
}

async function editorVisualLines(): Promise<Array<{ xMin: number; xMax: number; width: number }>> {
  return h.page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('[data-editor][contenteditable="true"]');
    if (!editor) throw new Error("editor not found");
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent || node.textContent.trim().length === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...Array.from(range.getClientRects()));
      range.detach();
    }
    const rows: DOMRect[][] = [];
    for (const rect of rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const row = rows.find((candidate) => Math.abs(candidate[0].top - rect.top) <= 3);
      if (row) {
        row.push(rect);
      } else {
        rows.push([rect]);
      }
    }
    return rows
      .map((row) => {
        const xMin = Math.min(...row.map((rect) => rect.left));
        const xMax = Math.max(...row.map((rect) => rect.right));
        const top = row.reduce((sum, rect) => sum + rect.top, 0) / row.length;
        return { xMin, xMax, width: xMax - xMin, top };
      })
      .sort((a, b) => a.top - b.top)
      .map(({ xMin, xMax, width }) => ({ xMin, xMax, width }));
  });
}

async function openLargestSourceTextBox(): Promise<number> {
  const { index, pageIndex } = await h.page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-run-id]")).map(
      (el, index) => {
        const rect = el.getBoundingClientRect();
        const pageEl = el.closest<HTMLElement>("[data-page-index]");
        return {
          index,
          pageIndex: Number(pageEl?.dataset.pageIndex ?? 0),
          area: rect.width * rect.height,
          width: rect.width,
          height: rect.height,
        };
      },
    );
    candidates.sort((a, b) => b.area - a.area);
    const candidate = candidates.find((item) => item.width > 180 && item.height > 30);
    return candidate ?? { index: 0, pageIndex: 0, area: 0, width: 0, height: 0 };
  });
  await h.page.locator("[data-run-id]").nth(index).click();
  await h.page.locator('[data-editor][contenteditable="true"]').first().waitFor({
    state: "visible",
  });
  return pageIndex;
}

describe("resized text boxes", () => {
  test("RTL source paragraph reflows when resized smaller and saves to the resized bounds", async () => {
    await loadFixture(h.page, FIXTURE.maldivian);
    const sourcePageIndex = await openLargestSourceTextBox();

    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    const before = await editor.boundingBox();
    expect(before).not.toBeNull();
    const beforeRight = before!.x + before!.width;

    await resizeFromHandle("bl", 130, 110);

    const resized = await editor.boundingBox();
    expect(resized).not.toBeNull();
    expect(resized!.width).toBeLessThan(before!.width - 90);
    expect(resized!.height).toBeGreaterThan(before!.height + 80);
    expect(resized!.x + resized!.width).toBeCloseTo(beforeRight, 1);
    const activeLines = await editorVisualLines();
    expect(activeLines.length).toBeGreaterThanOrEqual(4);
    for (const line of activeLines.slice(0, -1).slice(0, 3)) {
      expect(
        line.width,
        "active editor should reflow to broad rows after resize-down",
      ).toBeGreaterThan(resized!.width * 0.72);
    }

    const pageScreenBox = await h.page
      .locator(`[data-page-index="${sourcePageIndex}"]`)
      .boundingBox();
    expect(pageScreenBox).not.toBeNull();
    await editor.press("Control+Enter");
    const saved = await saveAndDownload(h.page, "source-textbox-resize.pdf", { timeout: 15_000 });
    const { pageSize, items } = await savedTextItems(saved, sourcePageIndex);
    const pdfBox = screenBoxToPdf(resized!, pageScreenBox!, pageSize);
    const lines = linesInsideBox(items, pdfBox);

    expect(lines.length).toBeGreaterThanOrEqual(4);
    const nonLast = lines.slice(0, -1);
    expect(nonLast.length).toBeGreaterThanOrEqual(3);
    const edgeTolerance = 12;
    for (const line of nonLast.slice(0, 3)) {
      expect(
        Math.abs(line.xMin - pdfBox.x),
        `line should reach resized box left edge: ${line.text}`,
      ).toBeLessThanOrEqual(edgeTolerance);
      expect(
        Math.abs(line.xMax - (pdfBox.x + pdfBox.width)),
        `line should reach resized box right edge: ${line.text}`,
      ).toBeLessThanOrEqual(edgeTolerance);
    }
  });

  test("inserted resized text saves using the resized width and height", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageScreenBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageScreenBox).not.toBeNull();
    await h.page.mouse.click(
      pageScreenBox!.x + pageScreenBox!.width * 0.25,
      pageScreenBox!.y + pageScreenBox!.height * 0.25,
    );

    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.fill("Resize save should wrap this inserted text into multiple visible lines.");
    const before = await editor.boundingBox();
    expect(before).not.toBeNull();

    await resizeFromHandle("br", 75, 70);

    const resized = await editor.boundingBox();
    expect(resized).not.toBeNull();
    expect(resized!.width).toBeGreaterThan(before!.width + 50);
    expect(resized!.height).toBeGreaterThan(before!.height + 45);
    expect(resized!.x).toBeCloseTo(before!.x, 1);
    expect(resized!.y).toBeCloseTo(before!.y, 1);

    await editor.press("Control+Enter");
    const saved = await saveAndDownload(h.page, "inserted-textbox-resize.pdf");
    const { pageSize, items } = await savedTextItems(saved);
    const pdfBox = screenBoxToPdf(resized!, pageScreenBox!, pageSize);
    const lines = linesInsideBox(items, pdfBox);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line.y).toBeGreaterThanOrEqual(pdfBox.y - 1);
      expect(line.y).toBeLessThanOrEqual(pdfBox.y + pdfBox.height + 1);
      expect(line.xMin).toBeGreaterThanOrEqual(pdfBox.x - 1);
      expect(line.xMax).toBeLessThanOrEqual(pdfBox.x + pdfBox.width + 1);
    }
  });
});
