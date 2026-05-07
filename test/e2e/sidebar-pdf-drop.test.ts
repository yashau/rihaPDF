import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "fs";
import path from "path";
import {
  FIXTURE,
  extractTextByPage,
  loadFixture,
  saveAndDownload,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  h = await setupBrowser({ viewport: { width: 1300, height: 1900 } });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

async function dataTransferForFile(filePath: string, type: string) {
  const base64 = fs.readFileSync(filePath).toString("base64");
  const filename = path.basename(filePath);
  return h.page.evaluateHandle(
    ({ base64, filename, type }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], filename, { type }));
      return dt;
    },
    { base64, filename, type },
  );
}

async function dispatchSidebarFileDrag(
  type: "dragover" | "drop",
  dataTransfer: Awaited<ReturnType<typeof dataTransferForFile>>,
  clientY: number,
) {
  const sidebar = h.page.locator('[data-testid="page-sidebar"]');
  const box = await sidebar.boundingBox();
  expect(box, "sidebar should be visible").not.toBeNull();
  await sidebar.dispatchEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: box!.x + box!.width / 2,
    clientY,
    dataTransfer,
  });
}

describe("sidebar PDF drop insertion", () => {
  test("dragging a PDF over a gap shows a marker and drops pages at that index", async () => {
    await loadFixture(h.page, FIXTURE.withImagesMultipage, { expectedPages: 2 });

    const secondThumb = h.page.locator("[data-sidebar-slot-index='1']");
    const secondBox = await secondThumb.boundingBox();
    expect(secondBox, "second sidebar thumbnail should be visible").not.toBeNull();
    const gapAboveSecond = secondBox!.y + 2;

    const dt = await dataTransferForFile(FIXTURE.externalSource, "application/pdf");
    await dispatchSidebarFileDrag("dragover", dt, gapAboveSecond);
    await h.page.locator('[data-testid="pdf-drop-marker"]').waitFor({ state: "visible" });
    await dispatchSidebarFileDrag("drop", dt, gapAboveSecond);

    await h.page.waitForFunction(
      () => document.querySelectorAll("[id^='page-slot-']").length === 4,
      undefined,
      { timeout: 20_000 },
    );

    const saved = await saveAndDownload(h.page, "sidebar-drop-insert.pdf");
    const text = await extractTextByPage(h.page, saved);
    expect(text.length).toBe(4);
    expect(text[0]).toContain("CROSS_PAGE_FIXTURE_P1");
    expect(text[1]).toContain("EXTERNAL_FIXTURE_P1");
    expect(text[2]).toContain("EXTERNAL_FIXTURE_P2");
    expect(text[3]).toContain("CROSS_PAGE_FIXTURE_P2");
  });

  test("non-PDF file drops do not show a marker or add pages", async () => {
    await loadFixture(h.page, FIXTURE.withImages, { expectedPages: 1 });

    const tmpTxt = path.join(path.dirname(FIXTURE.withImages), "not-a-pdf.txt");
    fs.writeFileSync(tmpTxt, "not a pdf");
    try {
      const firstThumb = h.page.locator("[data-sidebar-slot-index='0']");
      const firstBox = await firstThumb.boundingBox();
      expect(firstBox, "first sidebar thumbnail should be visible").not.toBeNull();
      const dt = await dataTransferForFile(tmpTxt, "text/plain");
      await dispatchSidebarFileDrag("dragover", dt, firstBox!.y + firstBox!.height / 2);
      expect(await h.page.locator('[data-testid="pdf-drop-marker"]').count()).toBe(0);
      await dispatchSidebarFileDrag("drop", dt, firstBox!.y + firstBox!.height / 2);
      await h.page.waitForTimeout(300);
      expect(await h.page.locator("[id^='page-slot-']").count()).toBe(1);
    } finally {
      fs.rmSync(tmpTxt, { force: true });
    }
  });

  test("PDF file drags autoscroll the sidebar near its bottom edge", async () => {
    await loadFixture(h.page, FIXTURE.withImages, { expectedPages: 1 });

    const blankButton = h.page.locator("aside button").filter({ hasText: /^Blank$/ });
    for (let i = 0; i < 8; i++) {
      await blankButton.click();
      await h.page.waitForTimeout(30);
    }

    const sidebar = h.page.locator('[data-testid="page-sidebar"]');
    await sidebar.evaluate((el) => {
      el.scrollTop = 0;
    });
    const before = await sidebar.evaluate((el) => el.scrollTop);
    const box = await sidebar.boundingBox();
    expect(box, "sidebar should be visible").not.toBeNull();

    const dt = await dataTransferForFile(FIXTURE.externalSource, "application/pdf");
    await dispatchSidebarFileDrag("dragover", dt, box!.y + box!.height - 4);
    await h.page.waitForTimeout(450);

    const after = await sidebar.evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThan(before + 20);
  });
});
