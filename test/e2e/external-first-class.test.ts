// First-class external pages: verifies that pages added via "+ From
// PDF" are editable, support insertions, and round-trip through save
// the same way primary-source pages do.
//
// The pre-Phase-1 behaviour was that external pages were display-only
// — they could be reordered or deleted but not edited. After the
// Phase 1-7 refactor, external pages go through the same `loadSource`
// pipeline as the primary file, so every editing affordance works on
// them. These tests cover the four representative actions:
//
//   1. Insert text directly on an external page → save → text persists.
//   2. Insert image directly on an external page → save → image persists.
//   3. Cross-source text drag (primary → external) → save → text on
//      the external slot's saved page only.
//   4. Drag an image native to the external page → save → image moved.
//
// Each test loads the PRIMARY fixture first, then triggers "+ From
// PDF" to append the external fixture's pages. The save should walk
// the slots[] in display order and pull pages from BOTH sources.

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
  // Tall viewport so the primary page + both external pages all
  // co-render without scrolling — drag/click hit-tests don't currently
  // auto-scroll.
  h = await setupBrowser({ viewport: { width: 1400, height: 3500 } });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

const STEPS = 16;
async function dragBetween(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
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
  await h.page.waitForTimeout(800);
}

async function pageBox(pageIndex: number) {
  const box = await h.page.locator(`[data-page-index="${pageIndex}"]`).boundingBox();
  if (!box) throw new Error(`page ${pageIndex} not in DOM`);
  return box;
}

async function saveAndDownload(name: string): Promise<string> {
  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const out = path.join(SCREENSHOTS, name);
  await dl.saveAs(out);
  return out;
}

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

/** Load primary, then add the external fixture and wait for the
 *  combined slot count to settle. */
async function loadPrimaryThenExternal(expectedTotal: number): Promise<void> {
  await loadFixture(h.page, FIXTURE.withImages, { expectedPages: 1 });
  // "+ From PDF" lives in the sidebar.
  await h.page
    .locator('input[type="file"][accept="application/pdf"][multiple]')
    .setInputFiles(FIXTURE.externalSource);
  // Wait for slots to extend to expectedTotal.
  const DEADLINE = Date.now() + 25_000;
  while (Date.now() < DEADLINE) {
    const count = await h.page.locator("[data-page-index]").count();
    if (count >= expectedTotal) break;
    await h.page.waitForTimeout(200);
  }
  // Beat for fonts/glyphs/images extraction on the external doc.
  await h.page.waitForTimeout(800);
  const total = await h.page.locator("[data-page-index]").count();
  expect(total, `expected ${expectedTotal} pages, got ${total}`).toBe(expectedTotal);
}

describe("first-class external pages", () => {
  test("data-source-key is wired and primary slot is identified", async () => {
    await loadPrimaryThenExternal(3);
    const sourceKeys = await h.page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-page-index]")).map(
        (el) => el.dataset.sourceKey ?? null,
      ),
    );
    // First slot is the primary, then two slots from the external
    // source — the latter two share the same external sourceKey, and
    // both differ from the primary's "primary" sentinel.
    expect(sourceKeys.length).toBe(3);
    expect(sourceKeys[0]).toBe("primary");
    expect(sourceKeys[1]).not.toBe("primary");
    expect(sourceKeys[2]).toBe(sourceKeys[1]);
  });

  test("inserted text on an external page is editable + survives save", async () => {
    await loadPrimaryThenExternal(3);

    const SENTINEL = "INSERTED_ON_EXTERNAL_42";

    // Drop a text box on slot 1 (= external page 1).
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const ext1 = await pageBox(1);
    await h.page.mouse.click(ext1.x + ext1.width * 0.3, ext1.y + ext1.height * 0.4);
    await h.page.waitForTimeout(200);
    const input = h.page.locator("[data-text-insert-id] input").first();
    await input.fill(SENTINEL);
    await input.press("Enter");
    await h.page.waitForTimeout(300);

    const saved = await saveAndDownload("ext-insert-text.pdf");
    const text = await extractTextByPage(saved);
    expect(text.length).toBe(3);
    // Saved page index 1 = slot 1 = external page 1 (label + sentinel).
    expect(text[1]).toContain("EXTERNAL_FIXTURE_P1");
    expect(text[1]).toContain(SENTINEL);
    // Other pages must NOT have the sentinel.
    expect(text[0]).not.toContain(SENTINEL);
    expect(text[2]).not.toContain(SENTINEL);
  });

  test("inserted image on an external page survives save", async () => {
    await loadPrimaryThenExternal(3);

    const beforeCounts = await extractImageCountsByPage(FIXTURE.externalSource);
    expect(beforeCounts).toEqual([0, 1]);

    // 1×1 PNG to use as the inserted image.
    const tmpPng = path.join(SCREENSHOTS, "ext-pixel.png");
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
    // Drop on slot 1 (external page 1, currently has zero images).
    const ext1 = await pageBox(1);
    await h.page.mouse.click(ext1.x + ext1.width * 0.5, ext1.y + ext1.height * 0.5);
    await h.page.waitForTimeout(300);

    const saved = await saveAndDownload("ext-insert-image.pdf");
    const counts = await extractImageCountsByPage(saved);
    expect(counts.length).toBe(3);
    // Slot 0 = primary (2 images preserved).
    expect(counts[0], "primary page image count").toBe(2);
    // Slot 1 = external p1 (was 0 images, now has the inserted one).
    expect(counts[1], "external page 1 image count after insert").toBe(1);
    // Slot 2 = external p2 (kept its native image).
    expect(counts[2]).toBe(1);
  });

  test("cross-source: drag inserted text from primary → external; save lands it on external", async () => {
    await loadPrimaryThenExternal(3);

    const SENTINEL = "CROSSSOURCE_TEXT_99";

    // Drop a text box on the PRIMARY (slot 0).
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const p0 = await pageBox(0);
    await h.page.mouse.click(p0.x + p0.width * 0.4, p0.y + p0.height * 0.5);
    await h.page.waitForTimeout(200);
    const input = h.page.locator("[data-text-insert-id] input").first();
    await input.fill(SENTINEL);
    await input.press("Enter");
    await h.page.waitForTimeout(300);

    // Drag the overlay onto slot 2 (external page 2).
    const insBox = await h.page.locator("[data-text-insert-id]").first().boundingBox();
    expect(insBox).not.toBeNull();
    const fromX = insBox!.x + insBox!.width / 2;
    const fromY = insBox!.y + insBox!.height / 2;
    const ext2 = await pageBox(2);
    const toX = ext2.x + 200;
    const toY = ext2.y + 250;
    await dragBetween(fromX, fromY, toX, toY);

    const saved = await saveAndDownload("ext-cross-source-text.pdf");
    const text = await extractTextByPage(saved);
    expect(text.length).toBe(3);
    expect(text[0], "primary should not carry the sentinel after the drag").not.toContain(SENTINEL);
    expect(text[1], "external page 1 should not carry the sentinel").not.toContain(SENTINEL);
    expect(text[2], "external page 2 should hold the dropped sentinel").toContain(SENTINEL);
  });

  test("editing an existing run on an external page replaces it in the saved file", async () => {
    await loadPrimaryThenExternal(3);

    // Find the editable run on external page 1 by its known text.
    const runId = await h.page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-page-index="1"] [data-run-id]')) {
        if ((el.textContent || "").includes("EXT_EDIT_ME_RUN")) {
          return el.getAttribute("data-run-id");
        }
      }
      return null;
    });
    expect(runId, "editable run on external page 1 not found").not.toBeNull();

    // Double-click to open the editor, type a replacement, press Enter.
    const runBox = await h.page.locator(`[data-run-id="${runId}"]`).boundingBox();
    expect(runBox).not.toBeNull();
    await h.page.mouse.dblclick(runBox!.x + runBox!.width / 2, runBox!.y + runBox!.height / 2);
    await h.page.waitForTimeout(300);
    // EditField marks its <input> with `data-editor` so we can find it
    // unambiguously even when the toolbar's font-size <input> is in the
    // same DOM subtree.
    const editInput = h.page.locator("input[data-editor]").first();
    await editInput.waitFor({ state: "attached", timeout: 5000 });
    await editInput.fill("EDITED_EXT_RUN");
    await editInput.press("Enter");
    await h.page.waitForTimeout(400);

    const saved = await saveAndDownload("ext-edit-run.pdf");
    const text = await extractTextByPage(saved);
    expect(text.length).toBe(3);
    // The original run text should be gone from external page 1, and
    // the replacement should be there. Saved page 1 = slot 1.
    expect(text[1]).toContain("EDITED_EXT_RUN");
    expect(text[1]).not.toContain("EXT_EDIT_ME_RUN");
  });
});
