// Cross-page move scenarios: drag a piece of content from page 1 onto
// page 2, save, reload, and assert the saved PDF has the content on
// page 2 (and not on page 1). Covers all four movable kinds:
//
//   1. Existing text run  — drawn by source-PDF Tj ops; save strips on
//      origin and emits drawText on target.
//   2. Existing source image XObject — save strips the q…Q block on
//      origin and replicates the XObject ref into the target page's
//      resources before emitting q cm Do Q.
//   3. Inserted text — net-new text the user typed on page 1; save just
//      writes the drawText to whichever page the user dropped it on.
//   4. Inserted image — net-new image; save embeds once, draws on the
//      target page only.
//
// The tests share a tall-viewport browser so both pages of the synthetic
// 2-page fixture are visible at once, since drag handling has no auto-
// scroll yet — the cross-page commit relies on findPageAtPoint matching
// the cursor's clientY against `[data-page-index]` bounding rects.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
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
  // Tall viewport so page 1 + page 2 + scrollbar all fit. Two A4 pages
  // at scale 1.5 is ~2530px; add header + gap + slack.
  h = await setupBrowser({ viewport: { width: 1400, height: 2900 } });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

/** Drag from `from` to `to` in client coords. Step the move so React's
 *  per-frame re-render commits intermediate positions — Playwright's
 *  default 1-step mouse.move() can fall below DRAG_THRESHOLD_PX. */
async function dragBetween(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  const STEPS = 16;
  await h.page.mouse.move(fromX, fromY);
  await h.page.mouse.down();
  for (let i = 1; i <= STEPS; i++) {
    await h.page.mouse.move(
      fromX + ((toX - fromX) * i) / STEPS,
      fromY + ((toY - fromY) * i) / STEPS,
    );
    await h.page.waitForTimeout(15);
  }
  await h.page.mouse.up();
  // App.tsx debounces preview rebuilds 150ms; wait for that to settle.
  await h.page.waitForTimeout(800);
}

async function pageBox(pageIndex: number) {
  const box = await h.page.locator(`[data-page-index="${pageIndex}"]`).boundingBox();
  if (!box) throw new Error(`page ${pageIndex} not in DOM`);
  return box;
}

/** Save → wait for download → return path. */
async function saveAndDownload(name: string): Promise<string> {
  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const out = path.join(SCREENSHOTS, name);
  await dl.saveAs(out);
  return out;
}

/** Per-page text content via pdf.js. Index-aligned with page numbers
 *  (returned[0] = page 1 text). */
async function extractTextByPage(pdfPath: string): Promise<string[]> {
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  return h.page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const pdfMod = (await importer("/src/lib/pdf.ts")) as typeof import("../../src/lib/pdf");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfMod.loadPdf(bytes.buffer);
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const content = await p.getTextContent();
      out.push(
        content.items
          .filter((it) => "str" in it)
          .map((it) => (it as { str: string }).str)
          .join(" "),
      );
    }
    return out;
  }, b64);
}

/** Per-page image counts via the app's own sourceImages module. */
async function extractImageCountsByPage(pdfPath: string): Promise<number[]> {
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  return h.page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const mod = (await importer(
      "/src/lib/sourceImages.ts",
    )) as typeof import("../../src/lib/sourceImages");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const all = await mod.extractPageImages(bytes.buffer);
    return all.map((p) => p.length);
  }, b64);
}

describe("cross-page move", () => {
  test("existing text run: drag from page 1 to page 2 — saved PDF has the text on page 2 only", async () => {
    await loadFixture(h.page, FIXTURE.withImagesMultipage, { expectedPages: 2 });

    // Find the page-1 label by its text content.
    const runId = await h.page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-page-index="0"] [data-run-id]')) {
        if ((el.textContent || "").includes("CROSS_PAGE_FIXTURE_P1")) {
          return el.getAttribute("data-run-id");
        }
      }
      return null;
    });
    expect(runId, "page-1 label run not found").not.toBeNull();

    const runBox = await h.page.locator(`[data-run-id="${runId}"]`).boundingBox();
    expect(runBox).not.toBeNull();
    const fromX = runBox!.x + runBox!.width / 2;
    const fromY = runBox!.y + runBox!.height / 2;

    // Drop near the top of page 2 (well inside the bounding rect so
    // findPageAtPoint definitely picks page-index=1).
    const p2 = await pageBox(1);
    const toX = p2.x + 200;
    const toY = p2.y + 100;

    await dragBetween(fromX, fromY, toX, toY);

    const saved = await saveAndDownload("cross-page-text-run.pdf");
    const text = await extractTextByPage(saved);
    expect(text.length).toBe(2);
    expect(text[0], "page 1 should no longer contain the moved label").not.toContain(
      "CROSS_PAGE_FIXTURE_P1",
    );
    expect(text[1], "page 2 should now contain the moved label").toContain("CROSS_PAGE_FIXTURE_P1");
  });

  test("existing image: drag from page 1 to page 2 — saved PDF has the image on page 2", async () => {
    await loadFixture(h.page, FIXTURE.withImagesMultipage, { expectedPages: 2 });

    const before = await extractImageCountsByPage(FIXTURE.withImagesMultipage);
    expect(before, "fixture should be 1 image per page").toEqual([1, 1]);

    // The page-1 image is the first overlay rendered inside page 1.
    const imgId = await h.page.evaluate(() => {
      const el = document.querySelector('[data-page-index="0"] [data-image-id]');
      return el?.getAttribute("data-image-id") ?? null;
    });
    expect(imgId, "page-1 image overlay not found").not.toBeNull();

    const imgBox = await h.page.locator(`[data-image-id="${imgId}"]`).boundingBox();
    expect(imgBox).not.toBeNull();
    const fromX = imgBox!.x + imgBox!.width / 2;
    const fromY = imgBox!.y + imgBox!.height / 2;

    const p2 = await pageBox(1);
    const toX = p2.x + 250;
    const toY = p2.y + 200;

    await dragBetween(fromX, fromY, toX, toY);

    const saved = await saveAndDownload("cross-page-image.pdf");
    const counts = await extractImageCountsByPage(saved);
    expect(counts.length).toBe(2);
    expect(counts[0], "page 1 should be empty after the image moved off").toBe(0);
    expect(counts[1], "page 2 should hold both its native image and the moved one").toBe(2);
  });

  test("inserted text: drop on page 1, drag to page 2 — saved PDF has the text on page 2 only", async () => {
    await loadFixture(h.page, FIXTURE.withImagesMultipage, { expectedPages: 2 });

    const SENTINEL = "INSERTED_CROSSPAGE_42";

    // Drop a fresh text box in the middle of page 1.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const p1 = await pageBox(0);
    await h.page.mouse.click(p1.x + p1.width * 0.4, p1.y + p1.height * 0.5);
    await h.page.waitForTimeout(200);
    const input = h.page.locator("[data-text-insert-id] input").first();
    await input.fill(SENTINEL);
    await input.press("Enter");
    await h.page.waitForTimeout(300);

    // Now drag the inserted text box onto page 2.
    const insBox = await h.page.locator("[data-text-insert-id]").first().boundingBox();
    expect(insBox).not.toBeNull();
    const fromX = insBox!.x + insBox!.width / 2;
    const fromY = insBox!.y + insBox!.height / 2;
    const p2 = await pageBox(1);
    const toX = p2.x + 200;
    const toY = p2.y + 300;
    await dragBetween(fromX, fromY, toX, toY);

    const saved = await saveAndDownload("cross-page-inserted-text.pdf");
    const text = await extractTextByPage(saved);
    expect(text.length).toBe(2);
    expect(text[0], "page 1 must not carry the inserted text").not.toContain(SENTINEL);
    expect(text[1], "page 2 must now carry the inserted text").toContain(SENTINEL);
  });

  test("inserted image: drop on page 1, drag to page 2 — saved PDF has the image on page 2", async () => {
    await loadFixture(h.page, FIXTURE.withImagesMultipage, { expectedPages: 2 });

    const before = await extractImageCountsByPage(FIXTURE.withImagesMultipage);
    expect(before).toEqual([1, 1]);

    // 1×1 red PNG written to disk so the file-input can pick it up.
    const tmpPng = path.join(SCREENSHOTS, "cross-page-pixel.png");
    fs.writeFileSync(
      tmpPng,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAFUlEQVR4nGP8z8AARMQDxlGNAxoAAH7vAv9OUszhAAAAAElFTkSuQmCC",
        "base64",
      ),
    );

    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Image/ })
      .click();
    await h.page.locator('input[type="file"][accept*="image"]').setInputFiles(tmpPng);
    await h.page.waitForTimeout(400);
    const p1 = await pageBox(0);
    await h.page.mouse.click(p1.x + p1.width * 0.5, p1.y + p1.height * 0.4);
    await h.page.waitForTimeout(300);

    // Drag the inserted-image overlay onto page 2.
    const insBox = await h.page.locator("[data-image-insert-id]").first().boundingBox();
    expect(insBox, "inserted image overlay should be on page 1").not.toBeNull();
    const fromX = insBox!.x + insBox!.width / 2;
    const fromY = insBox!.y + insBox!.height / 2;
    const p2 = await pageBox(1);
    const toX = p2.x + 250;
    const toY = p2.y + 350;
    await dragBetween(fromX, fromY, toX, toY);

    const saved = await saveAndDownload("cross-page-inserted-image.pdf");
    const counts = await extractImageCountsByPage(saved);
    expect(counts.length).toBe(2);
    expect(counts[0], "page 1 image count should be unchanged (its native image stayed)").toBe(1);
    expect(counts[1], "page 2 should now have its native image + the inserted one").toBe(2);
  });
});
