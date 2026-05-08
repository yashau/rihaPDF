// Italic toggle on the formatting toolbar must produce a real italic
// slant in the saved PDF, not just a CSS preview. Bundled Dhivehi TTFs
// don't carry an italic variant file, so the save path synthesizes
// italic via a shear `cm` matrix `[1 0 s 1 -s·y 0]` wrapped around
// the drawText. This test drops a text box, switches to Faruma (a
// custom TTF — the shear path), toggles italic, saves, and confirms
// the saved content stream contains the expected shear `cm` op.
//
// Negative case: a parallel run with italic OFF on the same family
// must NOT contain a shear cm — otherwise we'd be slanting all text
// unconditionally.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import {
  FIXTURE,
  SCREENSHOTS,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";
import { parseContentStream } from "../../src/pdf/content/contentStream";
import { getPageContentBytes } from "../../src/pdf/content/pageContent";

let h: Harness;

const SENTINEL = "ITALIC_PROBE_xyz";

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

/** Walk every page's content stream in the saved PDF and report any
 *  `cm` op whose operands look like a shear-about-baseline matrix
 *  `[1, 0, s, 1, e, 0]` with |s| in (0.05, 0.5). */
async function findShearCmOps(
  savedPath: string,
): Promise<Array<{ pageIndex: number; operands: number[] }>> {
  const bytes = fs.readFileSync(savedPath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out: Array<{ pageIndex: number; operands: number[] }> = [];
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const contentBytes = getPageContentBytes(doc.context, page.node);
    const ops = parseContentStream(contentBytes);
    for (const op of ops) {
      if (op.op !== "cm") continue;
      if (op.operands.length !== 6) continue;
      const nums = op.operands.map((t) => (t.kind === "number" ? t.value : NaN));
      if (nums.some((n) => Number.isNaN(n))) continue;
      const [a, b, c, d, , f] = nums;
      const isShear =
        Math.abs(a - 1) < 1e-6 &&
        Math.abs(b) < 1e-6 &&
        Math.abs(d - 1) < 1e-6 &&
        Math.abs(f) < 1e-6 &&
        Math.abs(c) > 0.05 &&
        Math.abs(c) < 0.5;
      if (isShear) out.push({ pageIndex: i, operands: nums });
    }
  }
  return out;
}

async function dropTextWithStyle(
  savedName: string,
  options: { italic: boolean; family?: string },
): Promise<string> {
  await loadFixture(h.page, FIXTURE.withImages);

  await h.page
    .locator("button")
    .filter({ hasText: /^\+ Text$/ })
    .click();
  const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
  expect(pageBox).not.toBeNull();
  await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.5);
  await h.page.waitForTimeout(200);

  const insertInput = h.page.locator('[data-editor][contenteditable="true"]').first();
  await insertInput.fill(SENTINEL);
  await insertInput.press("Control+A");
  await h.page.waitForTimeout(150);

  const toolbar = h.page.locator("[data-edit-toolbar]");
  if (options.family) {
    await toolbar.locator("select").selectOption(options.family);
    await h.page.waitForTimeout(120);
  }
  if (options.italic) {
    await insertInput.press("Control+A");
    await toolbar.locator('button[aria-label="Italic"]').click();
    await h.page.waitForTimeout(120);
  }

  // Click outside (page edge) to commit, then save.
  await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
  await h.page.waitForTimeout(200);

  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const saved = path.join(SCREENSHOTS, savedName);
  await dl.saveAs(saved);
  return saved;
}

describe("italic in saved PDFs", () => {
  test("italic + Faruma synthesizes a shear cm; non-italic does not", async () => {
    const italicSaved = await dropTextWithStyle("italic-on.pdf", {
      italic: true,
      family: "Faruma",
    });
    const italicShears = await findShearCmOps(italicSaved);
    expect(
      italicShears.length,
      `expected ≥1 shear cm op when italic is on; got 0. (saved: ${italicSaved})`,
    ).toBeGreaterThanOrEqual(1);
    expect(italicShears[0].operands[2]).toBeCloseTo(0.21, 5);

    const plainSaved = await dropTextWithStyle("italic-off.pdf", {
      italic: false,
      family: "Faruma",
    });
    const plainShears = await findShearCmOps(plainSaved);
    expect(
      plainShears.length,
      `expected 0 shear cm ops when italic is off; got ${plainShears.length}.`,
    ).toBe(0);
  }, 20_000);
});
