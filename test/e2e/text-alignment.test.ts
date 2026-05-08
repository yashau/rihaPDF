import { afterAll, beforeAll, describe, expect, test } from "vitest";
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

function screenBoxToPdf(box: Box, pageBox: Box, pageSize: { width: number; height: number }) {
  return {
    x: ((box.x - pageBox.x) / pageBox.width) * pageSize.width,
    y: pageSize.height - ((box.y - pageBox.y + box.height) / pageBox.height) * pageSize.height,
    width: (box.width / pageBox.width) * pageSize.width,
    height: (box.height / pageBox.height) * pageSize.height,
  };
}

async function resizeFromHandle(handleName: "br", dx: number, dy: number) {
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

async function savedTextItems(
  pdfPath: string,
): Promise<{ pageSize: { width: number; height: number }; items: TextItem[] }> {
  const fs = await import("fs");
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  return h.page.evaluate(async (b64) => {
    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const pdfMod = (await importer(
      "/src/pdf/render/pdf.ts",
    )) as typeof import("../../src/pdf/render/pdf");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfMod.loadPdf(bytes.buffer);
    const page = await doc.getPage(1);
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
  }, b64);
}

function linesInsideBox(items: TextItem[], box: Box, tolerance = 4): TextLine[] {
  const rows: TextItem[][] = [];
  for (const item of items) {
    if (item.str.trim().length === 0) continue;
    const xCenter = item.x + item.width / 2;
    if (xCenter < box.x - tolerance || xCenter > box.x + box.width + tolerance) continue;
    if (item.y < box.y - tolerance || item.y > box.y + box.height + tolerance) continue;
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= tolerance);
    if (row) row.push(item);
    else rows.push([item]);
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

describe("text alignment toolbar", () => {
  test("inserted text center alignment is preserved in the saved PDF", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(
      pageBox!.x + pageBox!.width * 0.25,
      pageBox!.y + pageBox!.height * 0.25,
    );

    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.fill("CENTER_ALIGN");
    await h.page.locator('[data-edit-toolbar] button[aria-label="Align center"]').click();
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();
    await editor.press("Control+Enter");

    const saved = await saveAndDownload(h.page, "inserted-center-align.pdf");
    const { pageSize, items } = await savedTextItems(saved);
    const pdfBox = screenBoxToPdf(editorBox!, pageBox!, pageSize);
    const target = items.find((item) => item.str.includes("CENTER_ALIGN"));
    expect(target, "saved inserted text not found").toBeTruthy();
    const textCenter = target!.x + target!.width / 2;
    expect(Math.abs(textCenter - (pdfBox.x + pdfBox.width / 2))).toBeLessThanOrEqual(8);
  });

  test("inserted text explicit justify uses the box width on save", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(
      pageBox!.x + pageBox!.width * 0.2,
      pageBox!.y + pageBox!.height * 0.25,
    );

    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.fill("one two three four five six seven eight nine ten eleven twelve");
    await resizeFromHandle("br", 130, 80);
    await h.page.locator('[data-edit-toolbar] button[aria-label="Justify"]').click();
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();
    await editor.press("Control+Enter");

    const saved = await saveAndDownload(h.page, "inserted-justify-align.pdf");
    const { pageSize, items } = await savedTextItems(saved);
    const pdfBox = screenBoxToPdf(editorBox!, pageBox!, pageSize);
    const lines = linesInsideBox(items, pdfBox);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const first = lines[0];
    expect(Math.abs(first.xMin - pdfBox.x), first.text).toBeLessThanOrEqual(10);
    expect(Math.abs(first.xMax - (pdfBox.x + pdfBox.width)), first.text).toBeLessThanOrEqual(10);
  });

  test("source text right alignment is preserved in the saved PDF", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const sourceRunId = await h.page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("[data-run-id]")) {
        const text = el.textContent ?? "";
        if (text.trim().length > 0 && !text.includes("\n")) return el.dataset.runId ?? null;
      }
      return null;
    });
    expect(sourceRunId, "single-line source run not found").toBeTruthy();
    await h.page.locator(`[data-run-id="${sourceRunId}"]`).click();
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    await editor.press("Control+A");
    await h.page.keyboard.insertText("SRC_RIGHT_ALIGN");
    await resizeFromHandle("br", 120, 20);
    await h.page.locator('[data-edit-toolbar] button[aria-label="Align right"]').click();
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await editor.press("Control+Enter");

    const saved = await saveAndDownload(h.page, "source-right-align.pdf");
    const { pageSize, items } = await savedTextItems(saved);
    const pdfBox = screenBoxToPdf(editorBox!, pageBox!, pageSize);
    const target = items.find((item) => item.str.includes("SRC_RIGHT_ALIGN"));
    expect(target, "saved source text not found").toBeTruthy();
    expect(Math.abs(target!.x + target!.width - (pdfBox.x + pdfBox.width))).toBeLessThanOrEqual(8);
  });
});
